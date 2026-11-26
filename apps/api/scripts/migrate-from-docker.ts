import "dotenv/config";
import { MongoClient } from "mongodb";
import { hashPassword } from "../src/auth/password.js";

const SOURCE = "mongodb://127.0.0.1:27018/imap_organizer";
const TARGET = process.env.MONGODB_URI;
if (!TARGET) throw new Error("MONGODB_URI missing");

const COLLECTIONS = [
  "tbl_users",
  "tbl_mailboxes",
  "tbl_folders",
  "tbl_messages",
  "tbl_jobs",
] as const;

const password = process.env.SUPER_ADMIN_PASSWORD || "Pa$$word";

const src = new MongoClient(SOURCE);
const dst = new MongoClient(TARGET);

await src.connect();
await dst.connect();

const srcDb = src.db();
const dstDb = dst.db();

console.log(`Source: imap_organizer@27018`);
console.log(`Target: ${dstDb.databaseName}@27017`);

for (const name of COLLECTIONS) {
  const docs = await srcDb.collection(name).find({}).toArray();
  if (docs.length === 0) {
    console.log(`${name}: nothing to migrate`);
    continue;
  }

  let upserted = 0;
  for (const doc of docs) {
    if (name === "tbl_users" && typeof doc.email === "string") {
      const {
        _id: _ignored,
        createdAt: srcCreatedAt,
        ...rest
      } = doc as {
        _id: unknown;
        createdAt?: Date;
        email: string;
        [k: string]: unknown;
      };
      await dstDb.collection(name).updateOne(
        { email: doc.email },
        {
          $set: {
            ...rest,
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: srcCreatedAt ?? new Date() },
        },
        { upsert: true },
      );
    } else {
      await dstDb.collection(name).replaceOne({ _id: doc._id }, doc, {
        upsert: true,
      });
    }
    upserted += 1;
  }
  console.log(`${name}: migrated ${upserted} doc(s)`);
}

const hash = await hashPassword(password);
const pwdResult = await dstDb.collection("tbl_users").updateMany(
  {},
  {
    $set: {
      passwordHash: hash,
      active: true,
      updatedAt: new Date(),
    },
    $setOnInsert: {},
  },
);

// Ensure role defaults
await dstDb.collection("tbl_users").updateMany(
  { role: { $exists: false } },
  { $set: { role: "user" } },
);

const adminEmail = (
  process.env.SUPER_ADMIN_EMAIL || "admin@imap-organizer.local"
).toLowerCase();
await dstDb.collection("tbl_users").updateOne(
  { email: adminEmail },
  {
    $set: {
      role: "super_admin",
      active: true,
      passwordHash: hash,
      updatedAt: new Date(),
    },
    $setOnInsert: {
      email: adminEmail,
      createdAt: new Date(),
    },
  },
  { upsert: true },
);

const users = await dstDb
  .collection("tbl_users")
  .find({}, { projection: { email: 1, role: 1 } })
  .toArray();

console.log(`Passwords reset for ${pwdResult.modifiedCount} user(s) → ${JSON.stringify(password)}`);
console.log(
  "Users now in email_organizer.tbl_users:",
  users.map((u) => `${u.email} (${u.role ?? "user"})`).join(", "),
);

await src.close();
await dst.close();
