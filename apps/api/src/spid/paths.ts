import path from "node:path";

/** Resolve path relative to process cwd (apps/api in Docker / npm scripts). */
export function resolveApiPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(process.cwd(), p);
}

export function certToPem(bodyOrPem: string): string {
  const trimmed = bodyOrPem.trim();
  if (trimmed.includes("BEGIN CERTIFICATE")) return trimmed;
  const body = trimmed.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [body];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}
