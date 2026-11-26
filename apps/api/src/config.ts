import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  IMAP_SECRET: z.string().min(32),
  WEB_ORIGIN: z.string().url(),
  PI_AUTH_PATH: z.string().optional().default(""),
  CRON_INTERVAL_MS: z.coerce.number().default(300_000),
  IMAP_WRITE_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  COOKIE_NAME: z.string().default("io_session"),
  // Optional bootstrap only — day-to-day auth uses tbl_users in Mongo.
  SUPER_ADMIN_EMAIL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().email().optional(),
  ),
  SUPER_ADMIN_PASSWORD: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(8).optional(),
  ),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid config: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}
