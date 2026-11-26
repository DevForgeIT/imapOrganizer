import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { encryptImapPassword } from "../crypto/imapSecret.js";
import { decryptImapPassword } from "../crypto/imapSecret.js";
import { testImapConnection } from "../imap/client.js";
import { enqueueJob } from "../jobs/runner.js";
import {
  jobs,
  mailboxes,
  messages,
  type MailboxDoc,
} from "../models/collections.js";

const createSchema = z.object({
  label: z.string().min(1),
  host: z.string().min(1),
  port: z.coerce.number().int().positive(),
  tls: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1),
});

const patchSchema = createSchema.partial();

function toPublic(doc: MailboxDoc) {
  return {
    id: doc._id.toHexString(),
    label: doc.label,
    host: doc.host,
    port: doc.port,
    tls: doc.tls,
    username: doc.username,
    lastSyncAt: doc.lastSyncAt ? doc.lastSyncAt.toISOString() : null,
    active: doc.active,
  };
}

export async function mailboxRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/mailboxes", async (req) => {
    const list = await mailboxes()
      .find({ userId: req.userId! })
      .sort({ createdAt: -1 })
      .toArray();
    return list.map(toPublic);
  });

  app.get("/mailboxes/:id/org-stats", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const mailboxId = new ObjectId(id);
    const box = await mailboxes().findOne({
      _id: mailboxId,
      userId: req.userId!,
    });
    if (!box) return reply.code(404).send({ error: "Not found" });
    const total = await messages().countDocuments({
      mailboxId,
      userId: req.userId!,
    });
    const uncategorized = await messages().countDocuments({
      mailboxId,
      userId: req.userId!,
      folderId: null,
    });
    return {
      total,
      uncategorized,
      classified: total - uncategorized,
    };
  });

  app.post("/mailboxes", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid mailbox payload",
        details: parsed.error.flatten(),
      });
    }
    const now = new Date();
    const data = parsed.data;
    const result = await mailboxes().insertOne({
      userId: req.userId!,
      label: data.label,
      host: data.host,
      port: data.port,
      tls: data.tls,
      username: data.username,
      passwordEnc: encryptImapPassword(data.password),
      lastSyncAt: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    } as never);
    const doc = await mailboxes().findOne({ _id: result.insertedId });
    return reply.code(201).send(toPublic(doc!));
  });

  app.patch("/mailboxes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid mailbox payload",
        details: parsed.error.flatten(),
      });
    }
    const box = await mailboxes().findOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!box) return reply.code(404).send({ error: "Not found" });

    const $set: Record<string, unknown> = { updatedAt: new Date() };
    const d = parsed.data;
    if (d.label !== undefined) $set.label = d.label;
    if (d.host !== undefined) $set.host = d.host;
    if (d.port !== undefined) $set.port = d.port;
    if (d.tls !== undefined) $set.tls = d.tls;
    if (d.username !== undefined) $set.username = d.username;
    if (d.password !== undefined) $set.passwordEnc = encryptImapPassword(d.password);

    await mailboxes().updateOne({ _id: box._id }, { $set });
    const updated = await mailboxes().findOne({ _id: box._id });
    return toPublic(updated!);
  });

  app.delete("/mailboxes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const res = await mailboxes().deleteOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!res.deletedCount) return reply.code(404).send({ error: "Not found" });
    return { ok: true };
  });

  app.post("/mailboxes/:id/test", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const box = await mailboxes().findOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!box) return reply.code(404).send({ error: "Not found" });
    const result = await testImapConnection({
      host: box.host,
      port: box.port,
      tls: box.tls,
      username: box.username,
      password: decryptImapPassword(box.passwordEnc),
    });
    if (!result.ok) {
      return reply.code(502).send({ error: result.error });
    }
    return { ok: true };
  });

  app.post("/mailboxes/:id/sync", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const box = await mailboxes().findOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!box) return reply.code(404).send({ error: "Not found" });
    const jobId = await enqueueJob({
      userId: req.userId!,
      mailboxId: box._id,
      type: "sync",
      triggeredBy: "manual",
    });
    // Sync always followed by classify (job loop runs them sequentially).
    let classifyJobId = (
      await jobs().findOne({
        mailboxId: box._id,
        type: "classify",
        status: { $in: ["queued", "running"] },
      })
    )?._id;
    if (!classifyJobId) {
      classifyJobId = await enqueueJob({
        userId: req.userId!,
        mailboxId: box._id,
        type: "classify",
        triggeredBy: "manual",
      });
    }
    return reply.code(202).send({
      jobId: jobId.toHexString(),
      classifyJobId: classifyJobId.toHexString(),
    });
  });

  app.post("/mailboxes/:id/classify", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const box = await mailboxes().findOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!box) return reply.code(404).send({ error: "Not found" });
    const jobId = await enqueueJob({
      userId: req.userId!,
      mailboxId: box._id,
      type: "classify",
      triggeredBy: "manual",
    });
    return reply.code(202).send({ jobId: jobId.toHexString() });
  });
}
