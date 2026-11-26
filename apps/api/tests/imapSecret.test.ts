import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.IMAP_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/imap_organizer_test";
  process.env.JWT_SECRET = "test-jwt-secret-16";
  process.env.WEB_ORIGIN = "http://localhost:3000";
});

describe("imapSecret", () => {
  it("round-trips password", async () => {
    const { resetConfigCache } = await import("../src/config.js");
    resetConfigCache();
    const { encryptImapPassword, decryptImapPassword } = await import(
      "../src/crypto/imapSecret.js"
    );
    const enc = encryptImapPassword("s3cret!");
    expect(enc).not.toContain("s3cret!");
    expect(decryptImapPassword(enc)).toBe("s3cret!");
  });
});
