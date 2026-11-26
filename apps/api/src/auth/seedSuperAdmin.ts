import { getConfig } from "../config.js";
import { users } from "../models/collections.js";
import { hashPassword } from "./password.js";

/**
 * Optional bootstrap: creates the first super admin only when both
 * SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are set in env.
 * Afterwards credentials live only in Mongo (`tbl_users`).
 */
export async function seedSuperAdmin(): Promise<"created" | "skipped" | "exists"> {
  const cfg = getConfig();
  const email = cfg.SUPER_ADMIN_EMAIL?.toLowerCase();
  const password = cfg.SUPER_ADMIN_PASSWORD;

  // Backfill legacy docs without role/active
  await users().updateMany(
    { role: { $exists: false } },
    { $set: { role: "user", active: true } },
  );

  if (!email || !password) {
    return "skipped";
  }

  const existing = await users().findOne({ email });
  const now = new Date();

  if (!existing) {
    await users().insertOne({
      email,
      passwordHash: await hashPassword(password),
      role: "super_admin",
      active: true,
      createdAt: now,
      updatedAt: now,
    } as never);
    return "created";
  }

  if (existing.role !== "super_admin" || existing.active === false) {
    await users().updateOne(
      { _id: existing._id },
      {
        $set: {
          role: "super_admin",
          active: true,
          updatedAt: now,
        },
      },
    );
  }

  return "exists";
}
