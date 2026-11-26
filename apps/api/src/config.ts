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
