import { describe, it, expect } from "vitest";
import {
  ensureFolderAssignment,
  parseClassifyResponse,
} from "../src/llm/classify.js";

describe("parseClassifyResponse", () => {
  it("parses raw JSON", () => {
    const r = parseClassifyResponse(
      '{"folderSlug":"invoices","reason":"looks like invoice"}',
    );
    expect(r.folderSlug).toBe("invoices");
    expect(r.uncategorized).toBeUndefined();
  });

  it("converts uncategorized into Generale newFolder", () => {
    const r = parseClassifyResponse(
      '```json\n{"uncategorized":true,"reason":"unclear"}\n```',
    );
    expect(r.uncategorized).toBeUndefined();
    expect(r.newFolder?.name).toBe("Generale");
    expect(r.reason).toContain("unclear");
  });

  it("throws on invalid", () => {
    expect(() => parseClassifyResponse("no json here")).toThrow();
  });
});

describe("ensureFolderAssignment", () => {
  it("keeps folderSlug", () => {
    const r = ensureFolderAssignment({
      folderSlug: "fatture",
      reason: "ok",
    });
    expect(r.folderSlug).toBe("fatture");
  });

  it("fills Generale when empty", () => {
    const r = ensureFolderAssignment({ reason: "none" });
    expect(r.newFolder?.name).toBe("Generale");
  });
});
