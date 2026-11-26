import { describe, it, expect } from "vitest";
import {
  makeSnippet,
  syncHash,
  truncateBody,
} from "../src/imap/sync.js";

describe("sync helpers", () => {
  it("truncates body", () => {
    expect(truncateBody("a".repeat(10), 5)).toHaveLength(5);
  });

  it("makes snippet", () => {
    expect(makeSnippet("hello   world", 100)).toBe("hello world");
  });

  it("hashes stably", () => {
    const a = syncHash({
      subject: "s",
      from: "f",
      date: "d",
      bodyText: "b",
    });
    const b = syncHash({
      subject: "s",
      from: "f",
      date: "d",
      bodyText: "b",
    });
    expect(a).toBe(b);
  });
});
