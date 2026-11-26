import { describe, it, expect } from "vitest";
import {
  mapSpidProfile,
  pickAttr,
} from "../src/spid/attributes.js";

describe("pickAttr", () => {
  it("reads first matching key (case-insensitive / URI suffix)", () => {
    expect(pickAttr({ email: "a@b.it" }, ["email"])).toBe("a@b.it");
    expect(
      pickAttr(
        { "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress": "x@y.it" },
        ["email", "emailaddress"],
      ),
    ).toBe("x@y.it");
    expect(
      pickAttr({ fiscalNumber: ["TINIT-ABC"] }, ["fiscalNumber"]),
    ).toBe("TINIT-ABC");
  });
});

describe("mapSpidProfile", () => {
  it("maps email + fiscal number into login identity", () => {
    const mapped = mapSpidProfile({
      email: "cesare@example.it",
      fiscalNumber: "TINIT-CSRGGL44L13H501E",
      name: "Gaio Giulio",
      familyName: "Cesare",
      spidCode: "DEMO123",
    });
    expect(mapped.email).toBe("cesare@example.it");
    expect(mapped.fiscalNumber).toBe("TINIT-CSRGGL44L13H501E");
    expect(mapped.displayName).toContain("Cesare");
  });

  it("synthesizes email from fiscal number when email missing", () => {
    const mapped = mapSpidProfile({
      fiscalNumber: "TINIT-CSRGGL44L13H501E",
      name: "Gaio",
      familyName: "Cesare",
    });
    expect(mapped.email).toBe("csrggl44l13h501e@spid.local");
    expect(mapped.fiscalNumber).toBe("TINIT-CSRGGL44L13H501E");
  });

  it("throws when neither email nor fiscalNumber", () => {
    expect(() => mapSpidProfile({ name: "X" })).toThrow(/identity/i);
  });
});
