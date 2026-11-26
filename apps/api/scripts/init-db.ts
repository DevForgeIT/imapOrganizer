/**
 * Initialize MongoDB for first use:
 * - connects and ensures indexes
 * - creates (or updates) the official super_admin with default credentials
 *
 * Usage (from repo root):
 *   npm run init-db
 *
 * Default login (fixed):
 *   Email:    admin@imap-organizer.local
 *   Password: Password1!
 */
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, connectDb } from "../src/db.js";
import { users } from "../src/models/collections.js";
import { hashPassword } from "../src/auth/password.js";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../.env") });

/** Credenziali ufficiali di primo accesso (non configurabili via env). */
const DEFAULT_EMAIL = "admin@imap-organizer.local";
const DEFAULT_PASSWORD = "Password1!";

try {
  console.log("Connessione a MongoDB…");
  await connectDb();
  console.log("Indici OK.");

  const now = new Date();
  const existing = await users().findOne({ email: DEFAULT_EMAIL });
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  if (!existing) {
    await users().insertOne({
      email: DEFAULT_EMAIL,
      passwordHash,
      role: "super_admin",
      active: true,
      createdAt: now,
      updatedAt: now,
    } as never);
    console.log(`Creato super_admin: ${DEFAULT_EMAIL}`);
  } else {
    await users().updateOne(
      { _id: existing._id },
      {
        $set: {
          passwordHash,
          role: "super_admin",
          active: true,
          updatedAt: now,
        },
      },
    );
    console.log(`Aggiornato super_admin esistente: ${DEFAULT_EMAIL}`);
  }

  await users().updateMany(
    { role: { $exists: false } },
    { $set: { role: "user", active: true } },
  );

  const total = await users().countDocuments();
  console.log("");
  console.log("Database pronto.");
  console.log(`Utenti in tbl_users: ${total}`);
  console.log("");
  console.log("Login:");
  console.log(`  URL:      http://localhost:3000/login`);
  console.log(`  Email:    ${DEFAULT_EMAIL}`);
  console.log(`  Password: ${DEFAULT_PASSWORD}`);
  console.log("");
  console.log(
    "Poi crea altri utenti da http://localhost:3000/admin/users (solo super_admin).",
  );
  console.log(
    "Consiglio: cambia la password dell'admin dopo il primo accesso.",
  );
} catch (err) {
  console.error("init-db fallito:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closeDb();
}
