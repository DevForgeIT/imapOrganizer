import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ObjectId } from "mongodb";
import { closeDb, connectDb } from "../src/db.js";
import { jobs, messages } from "../src/models/collections.js";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../.env") });

const id = process.argv[2];
await connectDb();
if (id && ObjectId.isValid(id)) {
  const job = await jobs().findOne({ _id: new ObjectId(id) });
  console.log(JSON.stringify(job, null, 2));
} else {
  const recent = await jobs()
    .find({})
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();
  console.log(
    recent.map((j) => ({
      id: j._id.toHexString(),
      type: j.type,
      status: j.status,
      progress: j.progress,
      error: j.error,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
    })),
  );
  const uncat = await messages().countDocuments({ folderId: null });
  console.log("messages still folderId=null:", uncat);
}
await closeDb();
