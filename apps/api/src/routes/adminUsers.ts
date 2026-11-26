import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { hashPassword } from "../auth/password.js";
import { requireSuperAdmin } from "../auth/plugin.js";
import { users } from "../models/collections.js";

const createSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8),
  role: z.enum(["user", "super_admin"]).default("user"),
});

const patchSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()).optional(),
  password: z.string().min(8).optional(),
  role: z.enum(["user", "super_admin"]).optional(),
  active: z.boolean().optional(),
});

function toPublic(u: {
  _id: ObjectId;
  email: string;
  role?: string;
  active?: boolean;
  createdAt?: Date | string;
}) {
  const created =
    u.createdAt instanceof Date
      ? u.createdAt
      : u.createdAt
        ? new Date(u.createdAt)
        : u._id.getTimestamp();
  return {
    id: u._id.toHexString(),
    email: u.email,
    role: (u.role === "super_admin" ? "super_admin" : "user") as
      | "super_admin"
      | "user",
    active: u.active !== false,
    createdAt: created.toISOString(),
  };
}

export async function adminUserRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireSuperAdmin);

  app.get("/admin/users", async () => {
    const list = await users().find({}).sort({ createdAt: -1 }).toArray();
    return list.map(toPublic);
  });

  app.post("/admin/users", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid user payload",
        details: parsed.error.flatten(),
      });
    }
    const { email, password, role } = parsed.data;
    const existing = await users().findOne({ email });
    if (existing) {
      return reply.code(409).send({ error: "Email already registered" });
    }
    const now = new Date();
    const result = await users().insertOne({
      email,
      passwordHash: await hashPassword(password),
      role,
      active: true,
      createdAt: now,
      updatedAt: now,
    } as never);
    const doc = await users().findOne({ _id: result.insertedId });
    return reply.code(201).send(toPublic(doc!));
  });

  app.patch("/admin/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) {
      return reply.code(400).send({ error: "Invalid id" });
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid user payload",
        details: parsed.error.flatten(),
      });
    }

    const target = await users().findOne({ _id: new ObjectId(id) });
    if (!target) return reply.code(404).send({ error: "Not found" });

    const data = parsed.data;
    if (data.email && data.email !== target.email) {
      const clash = await users().findOne({ email: data.email });
      if (clash) {
        return reply.code(409).send({ error: "Email already registered" });
      }
    }

    // Prevent locking yourself out: cannot demote/deactivate self
    if (req.userId && target._id.equals(req.userId)) {
      if (data.role === "user") {
        return reply
          .code(400)
          .send({ error: "Non puoi rimuovere il tuo ruolo super_admin" });
      }
      if (data.active === false) {
        return reply.code(400).send({ error: "Non puoi disattivare te stesso" });
      }
    }

    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.email !== undefined) $set.email = data.email;
    if (data.role !== undefined) $set.role = data.role;
    if (data.active !== undefined) $set.active = data.active;
    if (data.password !== undefined) {
      $set.passwordHash = await hashPassword(data.password);
    }

    await users().updateOne({ _id: target._id }, { $set });
    const updated = await users().findOne({ _id: target._id });
    return toPublic(updated!);
  });

  app.delete("/admin/users/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) {
      return reply.code(400).send({ error: "Invalid id" });
    }
    const target = await users().findOne({ _id: new ObjectId(id) });
    if (!target) return reply.code(404).send({ error: "Not found" });

    if (req.userId && target._id.equals(req.userId)) {
      return reply.code(400).send({ error: "Non puoi cancellare te stesso" });
    }

    await users().deleteOne({ _id: target._id });
    return { ok: true };
  });
}
