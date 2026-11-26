export const API_PREFIX = "/api";

export type FolderSource = "user" | "system";
export type JobType = "sync" | "classify";
export type JobStatus = "queued" | "running" | "completed" | "failed";
export type JobTriggeredBy = "manual" | "cron";
export type UserRole = "super_admin" | "user";

export interface UserPublic {
  id: string;
  email: string;
  role: UserRole;
}

export interface MailboxPublic {
  id: string;
  label: string;
  host: string;
  port: number;
  tls: boolean;
  username: string;
  lastSyncAt: string | null;
  active: boolean;
}

export interface FolderDto {
  id: string;
  mailboxId: string;
  name: string;
  slug: string;
  source: FolderSource;
  description: string;
  active: boolean;
  messageCount?: number;
}

export interface MessageListItem {
  id: string;
  mailboxId: string;
  folderId: string | null;
  folderName?: string | null;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface MessageDetail extends MessageListItem {
  to: string;
  cc: string;
  bodyText: string;
  imapFolder: string;
  classification: {
    folderId: string | null;
    reason: string;
    model?: string;
    at: string;
  } | null;
}

export interface MailboxOrgStats {
  total: number;
  uncategorized: number;
  classified: number;
}

export interface JobDto {
  id: string;
  mailboxId: string;
  type: JobType;
  status: JobStatus;
  triggeredBy: JobTriggeredBy;
  progress: { current: number; total: number; message?: string };
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ClassifyResultJson {
  folderSlug?: string;
  newFolder?: { name: string; description: string };
  uncategorized?: boolean;
  reason: string;
}
