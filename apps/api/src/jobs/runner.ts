import { ObjectId } from "mongodb";
import type { JobTriggeredBy, JobType } from "@imap-organizer/shared";
import { mirrorMessageOrganization } from "../imap/mirrorOrg.js";
import { syncMailbox } from "../imap/sync.js";
import {
  classifyMessageWithPi,
} from "../llm/classify.js";
import { slugify } from "../util/slug.js";
import { withTimeout } from "../util/timeout.js";
import {
  folders,
  jobs,
  messages,
  type FolderDoc,
} from "../models/collections.js";

let loopTimer: ReturnType<typeof setInterval> | null = null;
let busy = false;

const CLASSIFY_TIMEOUT_MS = 120_000;
const IMAP_MIRROR_TIMEOUT_MS = 60_000;

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
    await onProgress({
      current: i,
      total,
      message: `Classifying ${i + 1}/${total}: ${msg.subject.slice(0, 60) || "(no subject)"}`,
    });
    try {
      const result = await withTimeout(
        classifyMessageWithPi({
          folders: folderPayload,
          message: {
            subject: msg.subject,
            from: msg.from,
            date: msg.date.toISOString(),
            bodyText: msg.bodyText,
          },
        }),
        CLASSIFY_TIMEOUT_MS,
        `Pi classify msg ${msg._id.toHexString()}`,
      );

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

      const folderDoc =
        activeFolders.find((f) => f._id.equals(folderId)) ??
        (await folders().findOne({ _id: folderId }));
      if (!folderDoc) throw new Error("Folder missing after classify");

      let imapFolder = msg.imapFolder;
      let imapUid = msg.imapUid;
      let reason = result.reason || "";
      try {
        const mirrored = await withTimeout(
          mirrorMessageOrganization({
            message: msg,
            folder: folderDoc,
          }),
          IMAP_MIRROR_TIMEOUT_MS,
          `IMAP mirror msg ${msg._id.toHexString()}`,
        );
        if (mirrored) {
          imapFolder = mirrored.imapFolder;
          imapUid = mirrored.imapUid;
          folderDoc.imapPath = mirrored.imapPath;
        }
      } catch (imapErr) {
        const imapMsg =
          imapErr instanceof Error ? imapErr.message : String(imapErr);
        reason = `${reason} (IMAP mirror failed: ${imapMsg})`.trim();
      }

      await messages().updateOne(
        { _id: msg._id },
        {
          $set: {
            folderId,
            imapFolder,
            imapUid,
            classification: {
              folderId,
              reason,
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
      const reviewFolder =
        activeFolders.find((f) => f._id.equals(reviewId)) ??
        (await folders().findOne({ _id: reviewId }));

      let imapFolder = msg.imapFolder;
      let imapUid = msg.imapUid;
      if (reviewFolder) {
        try {
          const mirrored = await mirrorMessageOrganization({
            message: msg,
            folder: reviewFolder,
          });
          if (mirrored) {
            imapFolder = mirrored.imapFolder;
            imapUid = mirrored.imapUid;
          }
        } catch {
          /* keep local assignment even if IMAP mirror of review folder fails */
        }
      }

      await messages().updateOne(
        { _id: msg._id },
        {
          $set: {
            folderId: reviewId,
            imapFolder,
            imapUid,
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

/** Mark abandoned running jobs as failed so the queue can continue after restart. */
export async function recoverStuckJobs(maxAgeMs = 15 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const res = await jobs().updateMany(
    {
      status: "running",
      startedAt: { $lt: cutoff },
    },
    {
      $set: {
        status: "failed",
        finishedAt: new Date(),
        error: "Job abandoned (stuck running; recovered on API startup)",
      },
    },
  );
  return res.modifiedCount;
}

export function startJobLoop(intervalMs = 2000): void {
  if (loopTimer) return;
  loopTimer = setInterval(() => {
    void processNextJob();
  }, intervalMs);
}
