export type IdpMetadata = {
  entityId: string;
  ssoRedirectUrl: string;
  ssoPostUrl: string | null;
  signingCerts: string[];
};

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i");
  const m = tag.match(re);
  return m ? decodeXmlEntities(m[1]) : null;
}

/**
 * Minimal IdP metadata parser (no XML DOM dep).
 * Enough for Demo SPID / standard IDPSSODescriptor.
 */
export function parseIdpMetadata(xml: string): IdpMetadata {
  const entityMatch = xml.match(
    /<(?:\w+:)?EntityDescriptor\b[^>]*>/i,
  );
  if (!entityMatch) throw new Error("IdP metadata: EntityDescriptor missing");
  const entityId = attr(entityMatch[0], "entityID");
  if (!entityId) throw new Error("IdP metadata: entityID missing");

  const certs: string[] = [];
  const certRe =
    /<(?:\w+:)?X509Certificate\b[^>]*>\s*([A-Za-z0-9+/=\s]+)\s*<\/(?:\w+:)?X509Certificate>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = certRe.exec(xml)) !== null) {
    const body = cm[1].replace(/\s+/g, "");
    if (body) certs.push(body);
  }
  if (!certs.length) {
    throw new Error("IdP metadata: no X509Certificate found");
  }

  const ssoRe =
    /<(?:\w+:)?SingleSignOnService\b([^>]*)\/?>/gi;
  let redirect: string | null = null;
  let post: string | null = null;
  let sm: RegExpExecArray | null;
  while ((sm = ssoRe.exec(xml)) !== null) {
    const tag = sm[1] ?? "";
    const binding = attr(`x ${tag}`, "Binding") ?? "";
    const location = attr(`x ${tag}`, "Location");
    if (!location) continue;
    if (binding.includes("HTTP-Redirect")) redirect = location;
    if (binding.includes("HTTP-POST")) post = location;
  }

  if (!redirect && !post) {
    throw new Error("IdP metadata: SingleSignOnService missing");
  }

  return {
    entityId,
    ssoRedirectUrl: redirect ?? post!,
    ssoPostUrl: post,
    signingCerts: [...new Set(certs)],
  };
}
