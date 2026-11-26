import type { ImapFlow } from "imapflow";
import { getConfig } from "../config.js";
import { withImap, type ImapConnOpts } from "./client.js";

export function isImapWriteEnabled(): boolean {
  return getConfig().IMAP_WRITE_ENABLED;
}

/** Safe IMAP mailbox leaf name from org folder name. */
export function imapPathForFolderName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Generale";
}

async function ensureMailboxExists(
  client: ImapFlow,
  path: string,
): Promise<string> {
  const list = await client.list();
  const found = list.find(
    (m) => m.path === path || m.path.toLowerCase() === path.toLowerCase(),
  );
  if (found) return found.path;
  const created = await client.mailboxCreate(path);
  return created.path || path;
}

/**
 * Ensure destination folder exists on IMAP, then MOVE the message there.
 * Returns updated imapFolder + imapUid (UID may change after MOVE).
 */
export async function moveMessageToImapFolder(input: {
  conn: ImapConnOpts;
  sourceFolder: string;
  imapUid: number;
  destFolderName: string;
}): Promise<{ imapFolder: string; imapUid: number }> {
  if (!isImapWriteEnabled()) {
    throw new Error(
      "IMAP write disabled. Set IMAP_WRITE_ENABLED=true to organize on the server.",
    );
  }
  if (!Number.isFinite(input.imapUid) || input.imapUid <= 0) {
    throw new Error("Invalid IMAP UID");
  }

  const source = input.sourceFolder?.trim() || "INBOX";
  const dest = imapPathForFolderName(input.destFolderName);

  if (source === dest || source.toLowerCase() === dest.toLowerCase()) {
    return { imapFolder: source, imapUid: input.imapUid };
  }

  return withImap(input.conn, async (client) => {
    const destPath = await ensureMailboxExists(client, dest);
    const lock = await client.getMailboxLock(source, { readOnly: false });
    try {
      const moved = await client.messageMove(input.imapUid, destPath, {
        uid: true,
      });
      if (!moved) {
        // Already gone from source — treat as moved if not findable
        return { imapFolder: destPath, imapUid: input.imapUid };
      }

      let newUid = input.imapUid;
      const uidMap = (moved as { uidMap?: Map<number, number> }).uidMap;
      if (uidMap && typeof uidMap.get === "function") {
        const mapped = uidMap.get(input.imapUid);
        if (typeof mapped === "number") newUid = mapped;
      }

      return { imapFolder: destPath, imapUid: newUid };
    } finally {
      lock.release();
    }
  });
}

/** Create IMAP mailbox for an org folder (no message move). */
export async function ensureImapFolder(input: {
  conn: ImapConnOpts;
  folderName: string;
}): Promise<string> {
  if (!isImapWriteEnabled()) {
    throw new Error(
      "IMAP write disabled. Set IMAP_WRITE_ENABLED=true to create folders on the server.",
    );
  }
  const dest = imapPathForFolderName(input.folderName);
  return withImap(input.conn, async (client) => ensureMailboxExists(client, dest));
}
