import { MongoClient, type Db } from "mongodb";
import { getConfig } from "./config.js";
import { ensureIndexes } from "./models/collections.js";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(): Promise<Db> {
  if (db) return db;
  const uri = getConfig().MONGODB_URI;
  client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  await ensureIndexes(db);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error("Database not connected");
  return db;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
