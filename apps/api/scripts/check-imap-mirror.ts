import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeDb, connectDb } from "../src/db.js";
import { folders, messages } from "../src/models/collections.js";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../.env") });

await connectDb();

const allFolders = await folders()
  .find({})
  .project({ name: 1, slug: 1, source: 1, imapPath: 1, active: 1 })
  .toArray();

console.log("=== Cartelle app ===");
for (const f of allFolders) {
  console.log(
    `- ${f.name} (${f.source}) imapPath=${f.imapPath ?? "(non ancora su IMAP)"}`,
  );
}

const withPath = allFolders.filter((f) => f.imapPath).length;
const total = allFolders.length;
console.log(`\nCon imapPath: ${withPath}/${total}`);

const imapFail = await messages().countDocuments({
  "classification.reason": /IMAP mirror failed/i,
});
const sampleFail = await messages()
  .find({ "classification.reason": /IMAP mirror failed/i })
  .project({ subject: 1, "classification.reason": 1, imapFolder: 1 })
  .limit(5)
  .toArray();

console.log(`\nMessaggi con mirror IMAP fallito: ${imapFail}`);
for (const m of sampleFail) {
  console.log(`- ${m.subject?.slice(0, 50)} | ${m.classification?.reason}`);
}

const byImapFolder = await messages()
  .aggregate<{ _id: string; n: number }>([
    { $group: { _id: "$imapFolder", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ])
  .toArray();
console.log("\nMessaggi per imapFolder (dove stanno sul server secondo Mongo):");
for (const row of byImapFolder) {
  console.log(`- ${row._id}: ${row.n}`);
}

await closeDb();
