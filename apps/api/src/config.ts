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
  /** Enable SPID login (Demo/production IdP). Default off until configured. */
  SPID_ENABLED: z
    .string()
    .optional()
    .default("false")
    .transform((v) => v === "true" || v === "1"),
  /**
   * Public base URL of the API as seen by the IdP (HTTPS tunnel in local Demo).
   * Used to build entityID / ACS when not overridden.
   */
  SPID_BASE_URL: z.string().url().optional().default("http://localhost:4000"),
  /** Override SP entityID (default: `${SPID_BASE_URL}/auth/spid/metadata`). */
  SPID_ENTITY_ID: z.string().optional().default(""),
  /** Override AssertionConsumerService URL (default: `${SPID_BASE_URL}/auth/spid/acs`). */
  SPID_ACS_URL: z.string().optional().default(""),
  /**
   * Path to IdP SAML metadata XML (Demo SPID or production).
   * Relative to apps/api cwd, or absolute.
   */
  SPID_IDP_METADATA_PATH: z
    .string()
    .optional()
    .default("spid/idp-metadata.xml"),
  SPID_SP_KEY_PATH: z.string().optional().default("spid/sp-key.pem"),
  SPID_SP_CERT_PATH: z.string().optional().default("spid/sp-cert.pem"),
  /** SPID AuthnContext class ref (L1 for Demo; L2/L3 when required). */
  SPID_AUTHN_CONTEXT: z
    .string()
    .optional()
    .default("https://www.spid.gov.it/SpidL1"),
  /** Organization block required by Demo/Validator SP metadata checks. */
  SPID_ORG_NAME: z.string().optional().default("IMAP Organizer"),
  SPID_ORG_DISPLAY_NAME: z.string().optional().default("IMAP Organizer"),
  SPID_ORG_URL: z.string().optional().default(""),
  SPID_CONTACT_EMAIL: z
    .string()
    .email()
    .optional()
    .default("spid@example.com"),
  /** Private SP demo: VAT (IT…) or leave empty and use SPID_FISCAL_CODE. */
  SPID_VAT_NUMBER: z.string().optional().default("IT12345678901"),
  SPID_FISCAL_CODE: z.string().optional().default(""),
  /** Billing / CessionarioCommittente (Demo private SP). */
  SPID_BILLING_ADDRESS: z.string().optional().default("Via Roma 1"),
  SPID_BILLING_CAP: z.string().optional().default("00100"),
  SPID_BILLING_CITY: z.string().optional().default("Roma"),
  SPID_BILLING_PROVINCE: z.string().optional().default("RM"),
  SPID_BILLING_COUNTRY: z.string().optional().default("IT"),
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
