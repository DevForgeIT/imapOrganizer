import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { folders, mailboxes, messages } from "../models/collections.js";
import { slugify } from "../util/slug.js";

const createSchema = z.object({
  mailboxId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  active: z.boolean().optional(),
});

function toDto(doc: {
  _id: ObjectId;
  mailboxId: ObjectId;
  name: string;
  slug: string;
  source: "user" | "system";
  description: string;
  active: boolean;
}) {
  return {
    id: doc._id.toHexString(),
    mailboxId: doc.mailboxId.toHexString(),
    name: doc.name,
    slug: doc.slug,
    source: doc.source,
    description: doc.description,
    active: doc.active,
  };
}

export async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/folders", async (req, reply) => {
    const q = req.query as { mailboxId?: string };
    if (!q.mailboxId || !ObjectId.isValid(q.mailboxId)) {
      return reply.code(400).send({ error: "mailboxId required" });
    }
    const mailboxId = new ObjectId(q.mailboxId);
    const box = await mailboxes().findOne({
      _id: mailboxId,
      userId: req.userId!,
    });
    if (!box) return reply.code(404).send({ error: "Mailbox not found" });
    const list = await folders()
      .find({ mailboxId, userId: req.userId! })
      .sort({ name: 1 })
      .toArray();

    const counts = await messages().aggregate<{ _id: ObjectId | null; n: number }>([
      { $match: { mailboxId, userId: req.userId! } },
      { $group: { _id: "$folderId", n: { $sum: 1 } } },
    ]).toArray();
    const countMap = new Map(
      counts.map((c) => [c._id ? c._id.toHexString() : "null", c.n]),
    );

    return list.map((doc) => ({
      ...toDto(doc),
      messageCount: countMap.get(doc._id.toHexString()) ?? 0,
    }));
  });

  app.post("/folders", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid folder payload" });
    }
    if (!ObjectId.isValid(parsed.data.mailboxId)) {
      return reply.code(400).send({ error: "Invalid mailboxId" });
    }
    const mailboxId = new ObjectId(parsed.data.mailboxId);
    const box = await mailboxes().findOne({
      _id: mailboxId,
      userId: req.userId!,
    });
    if (!box) return reply.code(404).send({ error: "Mailbox not found" });

    let slug = slugify(parsed.data.name);
    let n = 2;
    while (await folders().findOne({ mailboxId, slug })) {
      slug = `${slugify(parsed.data.name)}-${n}`;
      n += 1;
    }

    const now = new Date();
    const result = await folders().insertOne({
      userId: req.userId!,
      mailboxId,
      name: parsed.data.name,
      slug,
      source: "user",
      description: parsed.data.description,
      active: true,
      createdAt: now,
      updatedAt: now,
    } as never);
    const doc = await folders().findOne({ _id: result.insertedId });
    return reply.code(201).send(toDto(doc!));
  });

  app.patch("/folders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid folder payload" });
    }
    const folder = await folders().findOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!folder) return reply.code(404).send({ error: "Not found" });

    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (folder.source === "user") {
      if (parsed.data.name !== undefined) {
        $set.name = parsed.data.name;
        $set.slug = slugify(parsed.data.name);
      }
      if (parsed.data.description !== undefined) {
        $set.description = parsed.data.description;
      }
      if (parsed.data.active !== undefined) $set.active = parsed.data.active;
    } else {
      if (parsed.data.description !== undefined) {
        $set.description = parsed.data.description;
      }
      if (parsed.data.active !== undefined) $set.active = parsed.data.active;
    }

    await folders().updateOne({ _id: folder._id }, { $set });
    const updated = await folders().findOne({ _id: folder._id });
    return toDto(updated!);
  });

  app.delete("/folders/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const folder = await folders().findOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!folder) return reply.code(404).send({ error: "Not found" });

    if (folder.source === "system") {
      await folders().updateOne(
        { _id: folder._id },
        { $set: { active: false, updatedAt: new Date() } },
      );
      return { ok: true, deactivated: true };
    }

    await folders().deleteOne({ _id: folder._id });
    await messages().updateMany(
      { folderId: folder._id },
      { $set: { folderId: null, updatedAt: new Date() } },
    );
    return { ok: true };
  });
}
