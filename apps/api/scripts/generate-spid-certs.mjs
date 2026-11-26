import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import selfsigned from "selfsigned";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, "..", "spid");
fs.mkdirSync(dir, { recursive: true });

const attrs = [
  { name: "commonName", value: "IMAPOrganizer SP Demo" },
  { name: "organizationName", value: "IMAPOrganizer" },
  { name: "countryName", value: "IT" },
];

const pems = await selfsigned.generate(attrs, {
  days: 3650,
  keySize: 2048,
  algorithm: "sha256",
});

fs.writeFileSync(path.join(dir, "sp-key.pem"), pems.private);
fs.writeFileSync(path.join(dir, "sp-cert.pem"), pems.cert);
console.log("Wrote", path.join(dir, "sp-key.pem"));
console.log("Wrote", path.join(dir, "sp-cert.pem"));
