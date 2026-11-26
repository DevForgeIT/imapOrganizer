import type { Collection, Db, ObjectId } from "mongodb";
import type {
  FolderSource,
  JobStatus,
  JobTriggeredBy,
  JobType,
  UserRole,
} from "@imap-organizer/shared";
import { getDb } from "../db.js";

export const COL = {
  users: "tbl_users",
  mailboxes: "tbl_mailboxes",
  folders: "tbl_folders",
  messages: "tbl_messages",
  jobs: "tbl_jobs",
} as const;

export interface UserDoc {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MailboxDoc {
  _id: ObjectId;
  userId: ObjectId;
  label: string;
  host: string;
  port: number;
  tls: boolean;
  username: string;
  passwordEnc: string;
  lastSyncAt: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface FolderDoc {
  _id: ObjectId;
  userId: ObjectId;
  mailboxId: ObjectId;
  name: string;
  slug: string;
  source: FolderSource;
  description: string;
  /** IMAP mailbox path once mirrored (Phase 2 write). */
  imapPath?: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageDoc {
  _id: ObjectId;
  userId: ObjectId;
  mailboxId: ObjectId;
  imapUid: number;
  imapFolder: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: Date;
  snippet: string;
  bodyText: string;
  folderId: ObjectId | null;
  classification: {
    folderId: ObjectId | null;
    reason: string;
    model?: string;
    at: Date;
  } | null;
  syncHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobDoc {
  _id: ObjectId;
  userId: ObjectId;
  mailboxId: ObjectId;
  type: JobType;
  status: JobStatus;
  triggeredBy: JobTriggeredBy;
  progress: { current: number; total: number; message?: string };
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

export function users(): Collection<UserDoc> {
  return getDb().collection(COL.users);
}
export function mailboxes(): Collection<MailboxDoc> {
  return getDb().collection(COL.mailboxes);
}
export function folders(): Collection<FolderDoc> {
  return getDb().collection(COL.folders);
}
export function messages(): Collection<MessageDoc> {
  return getDb().collection(COL.messages);
}
export function jobs(): Collection<JobDoc> {
  return getDb().collection(COL.jobs);
}

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection(COL.users).createIndex({ email: 1 }, { unique: true });
  await db
    .collection(COL.messages)
    .createIndex({ mailboxId: 1, imapUid: 1, imapFolder: 1 }, { unique: true });
  await db.collection(COL.messages).createIndex({ mailboxId: 1, folderId: 1 });
  await db.collection(COL.messages).createIndex({ userId: 1, date: -1 });
  await db
    .collection(COL.folders)
    .createIndex({ mailboxId: 1, slug: 1 }, { unique: true });
  await db.collection(COL.jobs).createIndex({ mailboxId: 1, status: 1 });
  await db.collection(COL.mailboxes).createIndex({ userId: 1 });
}
