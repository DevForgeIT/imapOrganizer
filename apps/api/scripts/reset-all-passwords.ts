import "dotenv/config";
import { connectDb, closeDb } from "../src/db.js";
import { users } from "../src/models/collections.js";
import { hashPassword } from "../src/auth/password.js";

const password = process.env.NEW_PASSWORD || "Password1!";

await connectDb();
const hash = await hashPassword(password);
const result = await users().updateMany(
  {},
  { $set: { passwordHash: hash, updatedAt: new Date() } },
);
console.log(
  `Updated ${result.modifiedCount} user password(s) → ${JSON.stringify(password)}`,
);
await closeDb();
