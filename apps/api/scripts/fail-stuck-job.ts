import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ObjectId } from "mongodb";
import { closeDb, connectDb } from "../src/db.js";
import { jobs } from "../src/models/collections.js";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../.env") });

const id = process.argv[2];
await connectDb();
if (id && ObjectId.isValid(id)) {
  const res = await jobs().updateOne(
    { _id: new ObjectId(id), status: "running" },
    {
      $set: {
        status: "failed",
        finishedAt: new Date(),
        error: "Manually recovered: stuck running",
      },
    },
  );
  console.log("updated", res.modifiedCount);
} else {
  const res = await jobs().updateMany(
    { status: "running" },
    {
      $set: {
        status: "failed",
        finishedAt: new Date(),
        error: "Manually recovered: stuck running",
      },
    },
  );
  console.log("updated running jobs", res.modifiedCount);
}
await closeDb();
