import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { getConfig } from "../config.js";
import { decryptImapPassword } from "../crypto/imapSecret.js";
import { deleteMessageOnImap } from "../imap/deleteMessage.js";
import { folders, mailboxes, messages } from "../models/collections.js";

const patchMessageSchema = z.object({
  folderId: z.string().min(1),
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/messages", async (req, reply) => {
    const q = req.query as {
      mailboxId?: string;
      folderId?: string;
      q?: string;
      page?: string;
      limit?: string;
    };
    if (!q.mailboxId || !ObjectId.isValid(q.mailboxId)) {
      return reply.code(400).send({ error: "mailboxId required" });
    }
    const mailboxId = new ObjectId(q.mailboxId);
    const box = await mailboxes().findOne({
      _id: mailboxId,
      userId: req.userId!,
    });
    if (!box) return reply.code(404).send({ error: "Mailbox not found" });

    const filter: Record<string, unknown> = {
      mailboxId,
      userId: req.userId!,
    };
    if (q.folderId === "uncategorized") {
      filter.folderId = null;
    } else if (q.folderId && ObjectId.isValid(q.folderId)) {
      filter.folderId = new ObjectId(q.folderId);
    }
    if (q.q?.trim()) {
      const rx = new RegExp(escapeRegex(q.q.trim()), "i");
      filter.$or = [{ subject: rx }, { from: rx }];
    }

    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50) || 50));
    const skip = (page - 1) * limit;

    const [items, total, folderDocs] = await Promise.all([
      messages()
        .find(filter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      messages().countDocuments(filter),
      folders().find({ mailboxId, userId: req.userId! }).toArray(),
    ]);
    const folderNames = new Map(
      folderDocs.map((f) => [f._id.toHexString(), f.name]),
    );

    return {
      total,
      page,
      limit,
      items: items.map((m) => {
        const folderId = m.folderId ? m.folderId.toHexString() : null;
        return {
          id: m._id.toHexString(),
          mailboxId: m.mailboxId.toHexString(),
          folderId,
          folderName: folderId ? (folderNames.get(folderId) ?? null) : null,
          subject: m.subject,
          from: m.from,
          date: m.date.toISOString(),
          snippet: m.snippet,
        };
      }),
    };
  });

  app.get("/messages/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const m = await messages().findOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!m) return reply.code(404).send({ error: "Not found" });
    const folderId = m.folderId ? m.folderId.toHexString() : null;
    let folderName: string | null = null;
    if (m.folderId) {
      const f = await folders().findOne({ _id: m.folderId });
      folderName = f?.name ?? null;
    }
    return {
      id: m._id.toHexString(),
      mailboxId: m.mailboxId.toHexString(),
      folderId,
      folderName,
      subject: m.subject,
      from: m.from,
      to: m.to,
      cc: m.cc,
      date: m.date.toISOString(),
      snippet: m.snippet,
      bodyText: m.bodyText,
      imapFolder: m.imapFolder,
      classification: m.classification
        ? {
            folderId: m.classification.folderId
              ? m.classification.folderId.toHexString()
              : null,
            reason: m.classification.reason,
            model: m.classification.model,
            at: m.classification.at.toISOString(),
          }
        : null,
    };
  });

  /** Move message to another organization folder (Mongo). */
  app.patch("/messages/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    const parsed = patchMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "folderId required" });
    }
    if (!ObjectId.isValid(parsed.data.folderId)) {
      return reply.code(400).send({ error: "Invalid folderId" });
    }

    const m = await messages().findOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!m) return reply.code(404).send({ error: "Not found" });

    const folder = await folders().findOne({
      _id: new ObjectId(parsed.data.folderId),
      mailboxId: m.mailboxId,
      userId: req.userId!,
      active: true,
    });
    if (!folder) return reply.code(404).send({ error: "Folder not found" });

    const now = new Date();
    await messages().updateOne(
      { _id: m._id },
      {
        $set: {
          folderId: folder._id,
          classification: {
            folderId: folder._id,
            reason: `Spostato manualmente in «${folder.name}»`,
            at: now,
          },
          updatedAt: now,
        },
      },
    );

    return {
      id: m._id.toHexString(),
      mailboxId: m.mailboxId.toHexString(),
      folderId: folder._id.toHexString(),
      folderName: folder.name,
      subject: m.subject,
      from: m.from,
      date: m.date.toISOString(),
      snippet: m.snippet,
    };
  });

  /** Real delete: IMAP first, then Mongo. */
  app.delete("/messages/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ObjectId.isValid(id)) return reply.code(400).send({ error: "Invalid id" });
    if (!getConfig().IMAP_WRITE_ENABLED) {
      return reply.code(403).send({
        error:
          "Eliminazione IMAP disabilitata. Imposta IMAP_WRITE_ENABLED=true nell'API.",
      });
    }

    const m = await messages().findOne({
      _id: new ObjectId(id),
      userId: req.userId!,
    });
    if (!m) return reply.code(404).send({ error: "Not found" });

    const box = await mailboxes().findOne({
      _id: m.mailboxId,
      userId: req.userId!,
    });
    if (!box) return reply.code(404).send({ error: "Mailbox not found" });

    try {
      const password = decryptImapPassword(box.passwordEnc);
      await deleteMessageOnImap({
        conn: {
          host: box.host,
          port: box.port,
          tls: box.tls,
          username: box.username,
          password,
        },
        imapFolder: m.imapFolder,
        imapUid: m.imapUid,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({
        error: `Eliminazione IMAP fallita: ${message}`,
      });
    }

    await messages().deleteOne({ _id: m._id, userId: req.userId! });
    return reply.code(204).send();
  });
}
