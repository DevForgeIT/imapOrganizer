import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { simpleParser } from "mailparser";
import { getConfig } from "../config.js";
import { decryptImapPassword } from "../crypto/imapSecret.js";
import { mailboxes, messages, type MailboxDoc } from "../models/collections.js";
import { withImap } from "./client.js";

export function truncateBody(text: string, max = 8192): string {
  if (text.length <= max) return text;
  return text.slice(0, max);
}

export function makeSnippet(text: string, max = 280): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

export function syncHash(parts: {
  subject: string;
  from: string;
  date: string;
  bodyText: string;
}): string {
  return createHash("sha256")
    .update(
      `${parts.subject}\n${parts.from}\n${parts.date}\n${parts.bodyText}`,
      "utf8",
    )
    .digest("hex");
}

function addressText(
  value: unknown,
): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === "string") return v;
        if (v && typeof v === "object" && "address" in v) {
          const a = v as { name?: string; address?: string };
          return a.name ? `${a.name} <${a.address}>` : (a.address ?? "");
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object" && value && "text" in value) {
    return String((value as { text: string }).text);
  }
  return String(value);
}

export async function syncMailbox(
  mailboxId: ObjectId,
  onProgress: (p: {
    current: number;
    total: number;
    message?: string;
  }) => Promise<void>,
): Promise<{ upserted: number }> {
  // Sync remains fetch-only. CREATE/MOVE/DELETE happen via organize/delete helpers
  // when IMAP_WRITE_ENABLED=true.
  void getConfig().IMAP_WRITE_ENABLED;

  const box = await mailboxes().findOne({ _id: mailboxId });
  if (!box) throw new Error("Mailbox not found");

  const password = decryptImapPassword(box.passwordEnc);
  let upserted = 0;

  await withImap(
    {
      host: box.host,
      port: box.port,
      tls: box.tls,
      username: box.username,
      password,
    },
    async (client) => {
      const lock = await client.getMailboxLock("INBOX", { readOnly: true });
      try {
        const exists = client.mailbox && "exists" in client.mailbox
          ? Number(client.mailbox.exists)
          : 0;
        await onProgress({
          current: 0,
          total: exists,
          message: "Fetching INBOX",
        });

        let current = 0;
        for await (const msg of client.fetch("1:*", {
          uid: true,
          envelope: true,
          source: true,
        })) {
          current += 1;
          const parsed = await simpleParser(msg.source!);
          const subject = parsed.subject ?? msg.envelope?.subject ?? "(no subject)";
          const from = addressText(parsed.from) || addressText(msg.envelope?.from);
          const to = addressText(parsed.to);
          const cc = addressText(parsed.cc);
          const date = parsed.date ?? msg.envelope?.date ?? new Date();
          const rawText =
            parsed.text?.trim() ||
            (parsed.html
              ? parsed.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
              : "");
          const bodyText = truncateBody(rawText);
          const snippet = makeSnippet(bodyText);
          const hash = syncHash({
            subject,
            from,
            date: date.toISOString(),
            bodyText,
          });

          const now = new Date();
          await messages().updateOne(
            {
              mailboxId: box._id,
              imapUid: msg.uid,
              imapFolder: "INBOX",
            },
            {
              $set: {
                userId: box.userId,
                mailboxId: box._id,
                imapUid: msg.uid,
                imapFolder: "INBOX",
                subject,
                from,
                to,
                cc,
                date,
                snippet,
                bodyText,
                syncHash: hash,
                updatedAt: now,
              },
              $setOnInsert: {
                folderId: null,
                classification: null,
                createdAt: now,
              },
            },
            { upsert: true },
          );
          upserted += 1;
          if (current % 10 === 0 || current === exists) {
            await onProgress({
              current,
              total: exists,
              message: `Synced ${current}/${exists}`,
            });
          }
        }
      } finally {
        lock.release();
      }
    },
  );

  await mailboxes().updateOne(
    { _id: box._id },
    { $set: { lastSyncAt: new Date(), updatedAt: new Date() } },
  );

  return { upserted };
}

export function mailboxConn(box: MailboxDoc): {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
} {
  return {
    host: box.host,
    port: box.port,
    tls: box.tls,
    username: box.username,
    password: decryptImapPassword(box.passwordEnc),
  };
}
