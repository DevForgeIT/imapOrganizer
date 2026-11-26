import { users } from "../models/collections.js";

/**
 * Light startup maintenance only.
 * Super admin is created by `npm run init-db` (default credentials), not via env.
 */
export async function seedSuperAdmin(): Promise<"skipped"> {
  // Backfill legacy docs without role/active
  await users().updateMany(
    { role: { $exists: false } },
    { $set: { role: "user", active: true } },
  );
  return "skipped";
}
