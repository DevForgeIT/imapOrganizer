export type SpidProfileInput = Record<string, unknown>;

export type MappedSpidIdentity = {
  email: string;
  fiscalNumber: string | null;
  spidCode: string | null;
  displayName: string | null;
};

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value) && value.length > 0) {
    return asString(value[0]);
  }
  return null;
}

/** Pick first attribute by exact key or URI/local-name suffix (case-insensitive). */
export function pickAttr(
  profile: SpidProfileInput,
  names: string[],
): string | null {
  const entries = Object.entries(profile);
  for (const name of names) {
    const direct = asString(profile[name]);
    if (direct) return direct;
    const lower = name.toLowerCase();
    for (const [key, val] of entries) {
      const k = key.toLowerCase();
      if (k === lower || k.endsWith(`/${lower}`) || k.endsWith(`#${lower}`)) {
        const s = asString(val);
        if (s) return s;
      }
    }
  }
  return null;
}

function normalizeFiscal(raw: string): string {
  return raw.trim().toUpperCase();
}

function emailFromFiscal(fiscalNumber: string): string {
  const bare = fiscalNumber.replace(/^TINIT-/i, "").toLowerCase();
  return `${bare}@spid.local`;
}

export function mapSpidProfile(profile: SpidProfileInput): MappedSpidIdentity {
  const emailRaw = pickAttr(profile, ["email", "emailaddress", "mail"]);
  const fiscalRaw = pickAttr(profile, [
    "fiscalNumber",
    "fiscalnumber",
    "codicefiscale",
  ]);
  const spidCode = pickAttr(profile, ["spidCode", "spidcode"]);
  const name = pickAttr(profile, ["name", "givenname", "firstname"]);
  const familyName = pickAttr(profile, [
    "familyName",
    "familyname",
    "surname",
    "lastname",
  ]);

  const fiscalNumber = fiscalRaw ? normalizeFiscal(fiscalRaw) : null;
  const email = (emailRaw ?? (fiscalNumber ? emailFromFiscal(fiscalNumber) : null))
    ?.toLowerCase();

  if (!email) {
    throw new Error("SPID identity missing email and fiscalNumber");
  }

  const displayParts = [name, familyName].filter(Boolean);
  return {
    email,
    fiscalNumber,
    spidCode,
    displayName: displayParts.length ? displayParts.join(" ") : null,
  };
}
