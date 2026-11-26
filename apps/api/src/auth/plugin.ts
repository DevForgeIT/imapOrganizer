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
    const token = req.cookies?.[name];
    if (!token) return;
    const sub = await verifyToken(token);
    if (sub && ObjectId.isValid(sub)) {
      req.userId = new ObjectId(sub);
    }
  });
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

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const cfg = getConfig();
  reply.setCookie(cfg.COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false,
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  const cfg = getConfig();
  reply.clearCookie(cfg.COOKIE_NAME, { path: "/" });
}
