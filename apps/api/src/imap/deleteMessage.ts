import { getConfig } from "../config.js";
import { withImap, type ImapConnOpts } from "./client.js";

/**
 * Permanently delete one message on the IMAP server (\\Deleted + EXPUNGE).
 * Requires IMAP_WRITE_ENABLED=true.
 * If the UID is already gone on the server, succeeds (idempotent).
 */
export async function deleteMessageOnImap(input: {
  conn: ImapConnOpts;
  imapFolder: string;
  imapUid: number;
}): Promise<void> {
  if (!getConfig().IMAP_WRITE_ENABLED) {
    throw new Error(
      "IMAP write disabled. Set IMAP_WRITE_ENABLED=true to delete on the server.",
    );
  }
  if (!Number.isFinite(input.imapUid) || input.imapUid <= 0) {
    throw new Error("Invalid IMAP UID");
  }
  const path = input.imapFolder?.trim() || "INBOX";

  await withImap(input.conn, async (client) => {
    const lock = await client.getMailboxLock(path, { readOnly: false });
    try {
      // false = range empty / already gone — treat as success
      await client.messageDelete(input.imapUid, { uid: true });
    } finally {
      lock.release();
    }
  });
}
