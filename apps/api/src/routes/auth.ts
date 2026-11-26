import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { verifyPassword } from "../auth/password.js";
import { signToken } from "../auth/jwt.js";
import {
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
} from "../auth/plugin.js";
import { users } from "../models/collections.js";

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

export async function authRoutes(app: FastifyInstance): Promise<void> {
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
    return toPublic(user);
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
