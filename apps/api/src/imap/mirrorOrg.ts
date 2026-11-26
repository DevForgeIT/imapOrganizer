import { ObjectId } from "mongodb";
import { decryptImapPassword } from "../crypto/imapSecret.js";
import {
  folders,
  mailboxes,
  type FolderDoc,
  type MessageDoc,
} from "../models/collections.js";
import { isImapWriteEnabled, moveMessageToImapFolder } from "./organize.js";

export async function mailboxConnOpts(mailboxId: ObjectId) {
  const box = await mailboxes().findOne({ _id: mailboxId });
  if (!box) throw new Error("Mailbox not found");
  return {
    host: box.host,
    port: box.port,
    tls: box.tls,
    username: box.username,
    password: decryptImapPassword(box.passwordEnc),
  };
}

/**
 * If IMAP_WRITE_ENABLED, MOVE the message into the org folder on the server
 * and persist imapPath on the folder + updated imapFolder/uid on the message fields.
 * When write is disabled, returns null (Mongo-only organization).
 */
export async function mirrorMessageOrganization(input: {
  message: MessageDoc;
  folder: FolderDoc;
}): Promise<{ imapFolder: string; imapUid: number; imapPath: string } | null> {
  if (!isImapWriteEnabled()) return null;

  const destName = input.folder.imapPath || input.folder.name;
  const conn = await mailboxConnOpts(input.message.mailboxId);
  const moved = await moveMessageToImapFolder({
    conn,
    sourceFolder: input.message.imapFolder,
    imapUid: input.message.imapUid,
    destFolderName: destName,
  });

  if (!input.folder.imapPath || input.folder.imapPath !== moved.imapFolder) {
    await folders().updateOne(
      { _id: input.folder._id },
      { $set: { imapPath: moved.imapFolder, updatedAt: new Date() } },
    );
  }

  return {
    imapFolder: moved.imapFolder,
    imapUid: moved.imapUid,
    imapPath: moved.imapFolder,
  };
}
