import "dotenv/config";
import { connectDb, closeDb } from "../src/db.js";
import { messages, folders, mailboxes } from "../src/models/collections.js";

await connectDb();
const boxes = await mailboxes().find({}).toArray();
for (const b of boxes) {
  const total = await messages().countDocuments({ mailboxId: b._id });
  const uncat = await messages().countDocuments({
    mailboxId: b._id,
    folderId: null,
  });
  const folds = await folders().find({ mailboxId: b._id }).toArray();
  console.log({
    label: b.label,
    id: b._id.toHexString(),
    messages: total,
    uncategorized: uncat,
    folders: folds.map((f) => `${f.name}(${f.source})`),
  });
}
await closeDb();
