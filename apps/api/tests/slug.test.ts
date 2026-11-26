import { describe, it, expect } from "vitest";
import { slugify } from "../src/util/slug.js";

describe("slugify", () => {
  it("normalizes names", () => {
    expect(slugify("Fatture Clienti")).toBe("fatture-clienti");
    expect(slugify("  Hello!! ")).toBe("hello");
  });
});
