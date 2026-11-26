import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { getConfig } from "../config.js";
import { verifyToken } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    userId: ObjectId | null;
  }
}

export async function authPlugin(app: FastifyInstance): Promise<void> {
  // Fastify requires a non-undefined default so later assignment sticks.
  app.decorateRequest("userId", null);

  app.addHook("onRequest", async (req) => {
    const name = getConfig().COOKIE_NAME;
    const bearer = bearerToken(req.headers.authorization);
    const token = bearer ?? req.cookies?.[name];
    if (!token) return;
    const sub = await verifyToken(token);
    if (sub && ObjectId.isValid(sub)) {
      req.userId = new ObjectId(sub);
    }
  });
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.userId) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

export async function requireSuperAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!req.userId) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
  const { users } = await import("../models/collections.js");
  const user = await users().findOne({ _id: req.userId });
  if (!user || user.role !== "super_admin" || user.active === false) {
    return reply.code(403).send({ error: "Forbidden" });
  }
}

function sessionCookieOptions(reply: FastifyReply): {
  httpOnly: true;
  path: string;
  sameSite: "lax" | "none";
  secure: boolean;
  maxAge: number;
} {
  const cfg = getConfig();
  // WEB on localhost + API on Cloudflare tunnel = cross-site: Lax cookies
  // set on ACS are stored but not sent on fetch(..., credentials) → /auth/me 401.
  const crossSite = isCrossSiteWebApi(cfg);
  const secure =
    crossSite ||
    reply.request.protocol === "https" ||
    cfg.SPID_BASE_URL.startsWith("https://");
  return {
    httpOnly: true,
    path: "/",
    sameSite: crossSite ? "none" : "lax",
    secure,
    maxAge: 60 * 60 * 24 * 7,
  };
}

export function isCrossSiteWebApi(
  cfg: ReturnType<typeof getConfig> = getConfig(),
): boolean {
  try {
    const webHost = new URL(cfg.WEB_ORIGIN).hostname;
    const apiHost = new URL(cfg.SPID_BASE_URL).hostname;
    const local = (h: string) => h === "localhost" || h === "127.0.0.1";
    if (local(webHost) && local(apiHost)) return false;
    return webHost !== apiHost;
  } catch {
    return false;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const cfg = getConfig();
  reply.setCookie(cfg.COOKIE_NAME, token, sessionCookieOptions(reply));
}

export function clearSessionCookie(reply: FastifyReply): void {
  const cfg = getConfig();
  reply.clearCookie(cfg.COOKIE_NAME, sessionCookieOptions(reply));
}
