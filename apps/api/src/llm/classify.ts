import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ClassifyResultJson } from "@imap-organizer/shared";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getConfig } from "../config.js";

// Pi coding agent: credentials from apps/pi/auth.json in this repo.

const resultSchema = z.object({
  folderSlug: z.string().optional(),
  newFolder: z
    .object({
      name: z.string().min(1),
      description: z.string().default(""),
    })
    .optional(),
  uncategorized: z.boolean().optional(),
  reason: z.string().default(""),
});

const SYSTEM_PROMPT = `You are an email classification engine for IMAP Organizer.
Your only job is to assign each email to a folder based on its content.

Rules:
- Reply with ONLY one JSON object. No markdown fences. No extra text.
- EVERY email MUST be assigned to a folder. Never leave mail uncategorized.
- Prefer an existing folder with source=user when it fits (user folders have priority).
- Otherwise prefer an existing folderSlug (user or system) when it fits.
- If none of the existing folders fit, you MUST create a newFolder with a clear short name and description.
- Never return uncategorized. If unsure, still create a sensible newFolder (e.g. topic, sender domain, or "Generale").
- Keep reason short (one sentence).
- Language of folder names/descriptions may be Italian or English; match the mailbox language when creating newFolder.

Valid JSON shapes:
{"folderSlug":"<existing-slug>","reason":"..."}
{"newFolder":{"name":"...","description":"..."},"reason":"..."}`;

export function buildClassifyPrompt(input: {
  folders: {
    name: string;
    slug: string;
    description: string;
    source: string;
  }[];
  message: {
    subject: string;
    from: string;
    date: string;
    bodyText: string;
  };
}): string {
  const userFolders = input.folders.filter((f) => f.source === "user");
  const systemFolders = input.folders.filter((f) => f.source !== "user");
  const fmt = (f: (typeof input.folders)[number]) =>
    `- slug=${f.slug} | name=${f.name} | source=${f.source} | description=${f.description}`;

  const folderList = [
    userFolders.length
      ? `User folders (PRIORITY — prefer these):\n${userFolders.map(fmt).join("\n")}`
      : "User folders (PRIORITY): (none)",
    systemFolders.length
      ? `System folders:\n${systemFolders.map(fmt).join("\n")}`
      : "System folders: (none)",
  ].join("\n\n");

  return `Classify this email. You MUST assign a folderSlug or create a newFolder.

${folderList || "(no folders yet — you must create a newFolder)"}

Email:
From: ${input.message.from}
Date: ${input.message.date}
Subject: ${input.message.subject}
Body:
${input.message.bodyText.slice(0, 6000)}

Return ONLY the JSON object.`;
}

/** Guarantee a concrete folder assignment (never uncategorized). */
export function ensureFolderAssignment(
  result: ClassifyResultJson,
): ClassifyResultJson {
  if (result.folderSlug || result.newFolder) {
    const { uncategorized: _drop, ...rest } = result;
    return rest;
  }
  return {
    newFolder: {
      name: "Generale",
      description:
        "Cartella di ripiego per messaggi senza una categoria più specifica",
    },
    reason: result.reason || "Assigned to Generale (no folder decision)",
  };
}

export function parseClassifyResponse(text: string): ClassifyResultJson {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty response from Pi classifier");
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const brace = candidate.match(/\{[\s\S]*\}/);
  if (!brace) throw new Error(`No JSON object in classifier response: ${trimmed.slice(0, 200)}`);
  const raw = JSON.parse(brace[0]) as unknown;
  const parsed = resultSchema.parse(raw);
  if (parsed.uncategorized && !parsed.folderSlug && !parsed.newFolder) {
    return ensureFolderAssignment({
      reason: parsed.reason || "Was unsure; created Generale",
    });
  }
  return ensureFolderAssignment(parsed);
}

/** Default: <repo>/apps/pi/auth.json (stable relative to this module). */
export function resolvePiAuthPath(): string {
  const cfg = getConfig().PI_AUTH_PATH?.trim();
  if (cfg) return resolve(cfg);

  // apps/api/src/llm -> apps/pi/auth.json
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../../pi/auth.json");
}

export function resolvePiAgentDir(): string {
  return dirname(resolvePiAuthPath());
}

export async function classifyMessageWithPi(input: {
  folders: {
    name: string;
    slug: string;
    description: string;
    source: string;
  }[];
  message: {
    subject: string;
    from: string;
    date: string;
    bodyText: string;
  };
}): Promise<ClassifyResultJson> {
  const authPath = resolvePiAuthPath();
  if (!existsSync(authPath)) {
    throw new Error(
      `Pi auth.json not found at ${authPath}. Place credentials in apps/pi/auth.json`,
    );
  }

  const agentDir = resolvePiAgentDir();

  const modelRuntime = await ModelRuntime.create({
    authPath,
  });

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir,
    systemPromptOverride: () => SYSTEM_PROMPT,
    appendSystemPromptOverride: () => [],
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    noTools: "all",
    modelRuntime,
    resourceLoader,
  });

  try {
    await session.prompt(buildClassifyPrompt(input));
    const text = session.getLastAssistantText() ?? "";
    return parseClassifyResponse(text);
  } finally {
    session.dispose();
  }
}
