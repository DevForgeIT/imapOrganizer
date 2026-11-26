import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyPassword } from "../auth/password.js";
import { signToken } from "../auth/jwt.js";
import {
  clearSessionCookie,
  isCrossSiteWebApi,
  requireAuth,
  setSessionCookie,
} from "../auth/plugin.js";
import { getConfig } from "../config.js";
import { users } from "../models/collections.js";
import { mapSpidProfile } from "../spid/attributes.js";
import {
  getSpidAuthorizeForm,
  getSpMetadataXml,
  validateSpidResponse,
} from "../spid/client.js";
import { findOrCreateSpidUser } from "../spid/provision.js";

const credsSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8),
});

function toPublic(user: {
  _id: { toHexString(): string };
  email: string;
  role?: string;
}) {
  return {
    id: user._id.toHexString(),
    email: user.email,
    role: (user.role === "super_admin" ? "super_admin" : "user") as
      | "super_admin"
      | "user",
  };
}

function webLoginRedirect(error?: string): string {
  const base = getConfig().WEB_ORIGIN.replace(/\/$/, "");
  if (!error) return `${base}/mailboxes`;
  const q = new URLSearchParams({ spid_error: error });
  return `${base}/login?${q.toString()}`;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Public flags for the login UI (no auth). */
  app.get("/auth/features", async () => {
    const cfg = getConfig();
    const base = cfg.SPID_BASE_URL.replace(/\/$/, "");
    return {
      spidEnabled: cfg.SPID_ENABLED,
      localLoginEnabled: true,
      spidLoginPath: "/auth/spid/login",
      spidMetadataUrl: `${base}/auth/spid/metadata`,
    };
  });

  /** SP metadata XML — register this URL (or download) on Demo SPID. */
  app.get("/auth/spid/metadata", async (_req, reply) => {
    const cfg = getConfig();
    if (!cfg.SPID_ENABLED) {
      return reply.code(404).send({ error: "SPID login is disabled" });
    }
    try {
      const xml = getSpMetadataXml();
      return reply
        .type("application/samlmetadata+xml")
        .header("Content-Disposition", 'inline; filename="metadata.xml"')
        .send(xml);
    } catch (err) {
      app.log.error({ err }, "SPID metadata generation failed");
      return reply.code(500).send({
        error: err instanceof Error ? err.message : "SPID metadata failed",
      });
    }
  });

  /** Start SPID SSO (HTTP-POST AuthnRequest firmata). */
  app.get("/auth/spid/login", async (_req, reply) => {
    const cfg = getConfig();
    if (!cfg.SPID_ENABLED) {
      return reply.code(404).send({ error: "SPID login is disabled" });
    }
    try {
      // SPID: RelayState opaco obbligatorio sul binding POST.
      const formHtml = await getSpidAuthorizeForm(
        randomUUID().replace(/-/g, ""),
      );
      return reply.type("text/html; charset=utf-8").send(formHtml);
    } catch (err) {
      app.log.error({ err }, "SPID login start failed");
      return reply.redirect(
        webLoginRedirect(
          err instanceof Error ? err.message : "SPID login failed",
        ),
      );
    }
  });

  /** Single Logout endpoint (declared in SP metadata; Demo/QAD require SLO). */
  app.all("/auth/spid/slo", async (_req, reply) => {
    clearSessionCookie(reply);
    return reply.redirect(webLoginRedirect());
  });

  /** Assertion Consumer Service (HTTP-POST from IdP). */
  app.post("/auth/spid/acs", async (req, reply) => {
    const cfg = getConfig();
    if (!cfg.SPID_ENABLED) {
      return reply.code(404).send({ error: "SPID login is disabled" });
    }
    try {
      const body = req.body as Record<string, string>;
      if (!body?.SAMLResponse) {
        return reply.redirect(webLoginRedirect("Missing SAMLResponse"));
      }
      const profile = await validateSpidResponse(body);
      const identity = mapSpidProfile(profile as Record<string, unknown>);
      const user = await findOrCreateSpidUser(identity);
      const token = await signToken(user._id.toHexString());
      const web = cfg.WEB_ORIGIN.replace(/\/$/, "");
      const next =
        user.role === "super_admin" ? `${web}/admin/users` : `${web}/mailboxes`;

      // localhost web + tunnel API: cookies are third-party and Chrome drops them.
      // Hand the JWT to the web app via hash fragment (not sent as Referer).
      if (isCrossSiteWebApi(cfg)) {
        const hash = new URLSearchParams({
          token,
          next,
        }).toString();
        return reply.redirect(`${web}/spid/callback#${hash}`);
      }

      setSessionCookie(reply, token);
      return reply.redirect(next);
    } catch (err) {
      app.log.error({ err }, "SPID ACS failed");
      return reply.redirect(
        webLoginRedirect(
          err instanceof Error ? err.message : "SPID authentication failed",
        ),
      );
    }
  });

  app.post("/auth/register", async (_req, reply) => {
    return reply.code(403).send({
      error: "Registration disabled. Ask a super admin to create your account.",
    });
  });

  app.post("/auth/login", async (req, reply) => {
    const parsed = credsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid email or password" });
    }
    const { email, password } = parsed.data;
    const user = await users().findOne({ email });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }
    if (user.active === false) {
      return reply.code(403).send({ error: "Account disabled" });
    }
    const token = await signToken(user._id.toHexString());
    setSessionCookie(reply, token);
    return { ...toPublic(user), token };
  });

  app.post("/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (req, reply) => {
    if (!req.userId) return;
    const user = await users().findOne({ _id: req.userId });
    if (!user || user.active === false) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return toPublic(user);
  });
}
