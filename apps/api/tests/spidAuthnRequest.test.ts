import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { SpidSaml } from "../src/spid/spidSaml.js";
import { certToPem, resolveApiPath } from "../src/spid/paths.js";
import { parseIdpMetadata } from "../src/spid/idpMetadata.js";

describe("SpidSaml AuthnRequest", () => {
  let saml: SpidSaml;

  beforeAll(() => {
    const apiRoot = path.resolve(__dirname, "..");
    const prev = process.cwd();
    process.chdir(apiRoot);
    try {
      const idp = parseIdpMetadata(
        fs.readFileSync(resolveApiPath("spid/idp-metadata.xml"), "utf8"),
      );
      const key = fs.readFileSync(resolveApiPath("spid/sp-key.pem"), "utf8");
      const cert = fs.readFileSync(resolveApiPath("spid/sp-cert.pem"), "utf8");
      const entityId =
        "https://example.trycloudflare.com/auth/spid/metadata";
      saml = new SpidSaml({
        callbackUrl: "https://example.trycloudflare.com/auth/spid/acs",
        entryPoint: idp.ssoRedirectUrl,
        issuer: entityId,
        idpCert: idp.signingCerts.map(certToPem),
        privateKey: key,
        publicCert: cert,
        skipRequestCompression: true,
        // Demo QAD requires ACS URL + ProtocolBinding (not Index alone).
        disableRequestAcsUrl: false,
        logoutCallbackUrl: "https://example.trycloudflare.com/auth/spid/slo",
        wantAssertionsSigned: true,
        wantAuthnResponseSigned: true,
        identifierFormat:
          "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
        authnContext: ["https://www.spid.gov.it/SpidL1"],
        racComparison: "exact",
        audience: entityId,
        attributeConsumingServiceIndex: "0",
        signMetadata: true,
        signatureAlgorithm: "sha256",
        digestAlgorithm: "sha256",
        metadataOrganization: {
          OrganizationName: [{ "@xml:lang": "it", "#text": "Test" }],
          OrganizationDisplayName: [{ "@xml:lang": "it", "#text": "Test" }],
          OrganizationURL: [
            { "@xml:lang": "it", "#text": "https://example.trycloudflare.com" },
          ],
        },
      });
    } finally {
      process.chdir(prev);
    }
  });

  it("adds Issuer Format and NameQualifier (SPID strict)", async () => {
    const url = await saml.getAuthorizeUrlAsync("", undefined);
    const raw = new URL(url).searchParams.get("SAMLRequest");
    expect(raw).toBeTruthy();
    const buf = Buffer.from(raw!, "base64");
    let xml: string;
    try {
      xml = inflateRawSync(buf).toString("utf8");
    } catch {
      xml = buf.toString("utf8");
    }
    expect(xml).toMatch(
      /Format="urn:oasis:names:tc:SAML:2\.0:nameid-format:entity"/,
    );
    expect(xml).toMatch(
      /NameQualifier="https:\/\/example\.trycloudflare\.com\/auth\/spid\/metadata"/,
    );
    expect(xml).toContain('AttributeConsumingServiceIndex="0"');
    expect(xml).toMatch(
      /AssertionConsumerServiceURL="https:\/\/example\.trycloudflare\.com\/auth\/spid\/acs"/,
    );
    expect(xml).toContain(
      'ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
    );
    expect(xml).not.toMatch(/AssertionConsumerServiceIndex=/);
    // SPID QAD 2.3.1 / 2.1.11
    expect(xml).not.toMatch(/AllowCreate=/);
    expect(xml).not.toMatch(/IsPassive=/);
    expect(xml).toMatch(
      /Format="urn:oasis:names:tc:SAML:2\.0:nameid-format:transient"/,
    );
  });

  it("HTTP-POST AuthnRequest is XML-signed after SPID patches", async () => {
    const form = await saml.getAuthorizeFormAsync("", undefined);
    const m = form.match(/name="SAMLRequest"\s+value="([^"]+)"/i);
    expect(m).toBeTruthy();
    const buf = Buffer.from(m![1], "base64");
    let xml: string;
    try {
      xml = inflateRawSync(buf).toString("utf8");
    } catch {
      xml = buf.toString("utf8");
    }
    expect(xml).toContain("Signature");
    expect(xml).toMatch(/X509Certificate/);
    expect(xml).toMatch(/NameQualifier=/);
    expect(xml).not.toMatch(/AllowCreate=/);
    expect(xml).toMatch(/AssertionConsumerServiceURL=/);
    expect(xml).toMatch(/ProtocolBinding=/);
    expect(xml).not.toMatch(/AssertionConsumerServiceIndex=/);
  });

  it("emits ACS index 0 in signed metadata", () => {
    const apiRoot = path.resolve(__dirname, "..");
    const cert = fs.readFileSync(
      path.join(apiRoot, "spid/sp-cert.pem"),
      "utf8",
    );
    const xml = saml.generateServiceProviderMetadata(cert, cert);
    expect(xml).toMatch(/AssertionConsumerService[^>]*index="0"/);
    expect(xml).toContain("Organization");
    expect(xml).toContain("Signature");
  });
});
