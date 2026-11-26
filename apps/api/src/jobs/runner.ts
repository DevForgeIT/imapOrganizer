import { ObjectId } from "mongodb";
import type { JobTriggeredBy, JobType } from "@imap-organizer/shared";
import { syncMailbox } from "../imap/sync.js";
import {
  classifyMessageWithPi,
} from "../llm/classify.js";
import { slugify } from "../util/slug.js";
import {
  folders,
  jobs,
  messages,
  type FolderDoc,
} from "../models/collections.js";

let loopTimer: ReturnType<typeof setInterval> | null = null;
let busy = false;

export async function enqueueJob(input: {
  userId: ObjectId;
  mailboxId: ObjectId;
  type: JobType;
  triggeredBy: JobTriggeredBy;
}): Promise<ObjectId> {
  const result = await jobs().insertOne({
    userId: input.userId,
    mailboxId: input.mailboxId,
    type: input.type,
    status: "queued",
    triggeredBy: input.triggeredBy,
    progress: { current: 0, total: 0 },
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date(),
  } as never);
  return result.insertedId;
}

async function uniqueSystemSlug(
  mailboxId: ObjectId,
  baseName: string,
): Promise<string> {
  let base = slugify(baseName) || "generale";
  let candidate = base;
  let n = 2;
  while (await folders().findOne({ mailboxId, slug: candidate })) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

async function createSystemFolder(input: {
  userId: ObjectId;
  mailboxId: ObjectId;
  name: string;
  description: string;
  activeFolders: FolderDoc[];
  folderPayload: {
    name: string;
    slug: string;
    description: string;
    source: string;
  }[];
}): Promise<ObjectId> {
  const now = new Date();
  const slug = await uniqueSystemSlug(input.mailboxId, input.name);
  const existing = input.activeFolders.find((f) => f.slug === slug);
  if (existing) return existing._id;

  const doc: Omit<FolderDoc, "_id"> = {
    userId: input.userId,
    mailboxId: input.mailboxId,
    name: input.name.trim() || "Generale",
    slug,
    source: "system",
    description: input.description || "",
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  const inserted = await folders().insertOne(doc as never);
  const created: FolderDoc = { _id: inserted.insertedId, ...doc };
  input.activeFolders.push(created);
  input.folderPayload.push({
    name: created.name,
    slug: created.slug,
    description: created.description,
    source: created.source,
  });
  return inserted.insertedId;
}

async function ensureReviewFolder(
  userId: ObjectId,
  mailboxId: ObjectId,
  activeFolders: FolderDoc[],
  folderPayload: {
    name: string;
    slug: string;
    description: string;
    source: string;
  }[],
): Promise<ObjectId> {
  const existing = activeFolders.find((f) => f.slug === "da-rivedere");
  if (existing) return existing._id;
  return createSystemFolder({
    userId,
    mailboxId,
    name: "Da rivedere",
    description:
      "Messaggi dove la classificazione automatica non è riuscita; da assegnare manualmente",
    activeFolders,
    folderPayload,
  });
}

export async function classifyMailbox(
  mailboxId: ObjectId,
  onProgress: (p: {
    current: number;
    total: number;
    message?: string;
  }) => Promise<void>,
): Promise<{ classified: number }> {
  const activeFolders = await folders()
    .find({ mailboxId, active: true })
    .toArray();
  // Prefer user folders first in the prompt payload order.
  activeFolders.sort((a, b) => {
    if (a.source === b.source) return a.name.localeCompare(b.name);
    return a.source === "user" ? -1 : 1;
  });
  const folderPayload = activeFolders.map((f) => ({
    name: f.name,
    slug: f.slug,
    description: f.description,
    source: f.source,
  }));

  const unclassified = await messages()
    .find({ mailboxId, folderId: null })
    .toArray();

  let classified = 0;
  const total = unclassified.length;
  await onProgress({ current: 0, total, message: "Classifying" });

  for (let i = 0; i < unclassified.length; i++) {
    const msg = unclassified[i]!;
    try {
      const result = await classifyMessageWithPi({
        folders: folderPayload,
        message: {
          subject: msg.subject,
          from: msg.from,
          date: msg.date.toISOString(),
          bodyText: msg.bodyText,
        },
      });

      let folderId: ObjectId | null = null;

      if (result.folderSlug) {
        const found = activeFolders.find((f) => f.slug === result.folderSlug);
        folderId = found?._id ?? null;
        // Slug suggested but missing → create that folder instead of leaving null.
        if (!folderId) {
          folderId = await createSystemFolder({
            userId: msg.userId,
            mailboxId,
            name: result.folderSlug,
            description: result.reason || "",
            activeFolders,
            folderPayload,
          });
        }
      }

      if (!folderId) {
        const nf = result.newFolder ?? {
          name: "Generale",
          description:
            "Cartella di ripiego per messaggi senza una categoria più specifica",
        };
        folderId = await createSystemFolder({
          userId: msg.userId,
          mailboxId,
          name: nf.name,
          description: nf.description || "",
          activeFolders,
          folderPayload,
        });
      }

      await messages().updateOne(
        { _id: msg._id },
        {
          $set: {
            folderId,
            classification: {
              folderId,
              reason: result.reason || "",
              at: new Date(),
            },
            updatedAt: new Date(),
          },
        },
      );
      classified += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const reviewId = await ensureReviewFolder(
        msg.userId,
        mailboxId,
        activeFolders,
        folderPayload,
      );
      await messages().updateOne(
        { _id: msg._id },
        {
          $set: {
            folderId: reviewId,
            classification: {
              folderId: reviewId,
              reason: `classify failed → Da rivedere: ${reason}`,
              at: new Date(),
            },
            updatedAt: new Date(),
          },
        },
      );
      classified += 1;
    }

    await onProgress({
      current: i + 1,
      total,
      message: `Classified ${i + 1}/${total}`,
    });
  }

  return { classified };
}

export async function processNextJob(): Promise<boolean> {
  if (busy) return false;
  const job = await jobs().findOneAndUpdate(
    { status: "queued" },
    {
      $set: {
        status: "running",
        startedAt: new Date(),
        progress: { current: 0, total: 0, message: "Starting" },
      },
    },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );

  if (!job) return false;

  busy = true;
  try {
    const onProgress = async (p: {
      current: number;
      total: number;
      message?: string;
    }) => {
      await jobs().updateOne({ _id: job._id }, { $set: { progress: p } });
    };

    if (job.type === "sync") {
      await syncMailbox(job.mailboxId, onProgress);
      // After a successful sync, enqueue Pi classification for new/unclassified mail.
      const alreadyQueued = await jobs().findOne({
        mailboxId: job.mailboxId,
        type: "classify",
        status: { $in: ["queued", "running"] },
      });
      if (!alreadyQueued) {
        await enqueueJob({
          userId: job.userId,
          mailboxId: job.mailboxId,
          type: "classify",
          triggeredBy: job.triggeredBy,
        });
      }
    } else if (job.type === "classify") {
      await classifyMailbox(job.mailboxId, onProgress);
    }

    await jobs().updateOne(
      { _id: job._id },
      {
        $set: {
          status: "completed",
          finishedAt: new Date(),
          error: null,
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await jobs().updateOne(
      { _id: job._id },
      {
        $set: {
          status: "failed",
          finishedAt: new Date(),
          error: message,
        },
      },
    );
  } finally {
    busy = false;
  }
  return true;
}

export function startJobLoop(intervalMs = 2000): void {
  if (loopTimer) return;
  loopTimer = setInterval(() => {
    void processNextJob();
  }, intervalMs);
}
