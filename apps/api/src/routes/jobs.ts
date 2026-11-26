import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { requireAuth } from "../auth/plugin.js";
import { jobs, type JobDoc } from "../models/collections.js";

function toDto(doc: JobDoc) {
  return {
    id: doc._id.toHexString(),
    mailboxId: doc.mailboxId.toHexString(),
    type: doc.type,
    status: doc.status,
    triggeredBy: doc.triggeredBy,
    progress: doc.progress,
    error: doc.error,
    createdAt: doc.createdAt.toISOString(),
    finishedAt: doc.finishedAt ? doc.finishedAt.toISOString() : null,
  };
}

export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const job = await jobs().findOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!job) return reply.code(404).send({ error: "Not found" });
    return toDto(job);
  });

  app.get("/jobs", async (req) => {
    const q = req.query as { mailboxId?: string; status?: string };
    const filter: Record<string, unknown> = { userId: req.userId! };
    if (q.mailboxId && ObjectId.isValid(q.mailboxId)) {
      filter.mailboxId = new ObjectId(q.mailboxId);
    }
    if (q.status) filter.status = q.status;
    const list = await jobs()
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
    return list.map(toDto);
  });
}
