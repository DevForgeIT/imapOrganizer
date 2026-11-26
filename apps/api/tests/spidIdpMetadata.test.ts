import { describe, it, expect } from "vitest";
import { parseIdpMetadata } from "../src/spid/idpMetadata.js";

const SAMPLE = `<?xml version="1.0"?>
<md:EntityDescriptor entityID="https://demo.spid.gov.it"
  xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo><ds:X509Data>
        <ds:X509Certificate>MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtestcert</ds:X509Certificate>
      </ds:X509Data></ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="https://demo.spid.gov.it/samlsso"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="https://demo.spid.gov.it/samlsso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`;

describe("parseIdpMetadata", () => {
  it("extracts entityID, SSO redirect URL and signing cert", () => {
    const idp = parseIdpMetadata(SAMPLE);
    expect(idp.entityId).toBe("https://demo.spid.gov.it");
    expect(idp.ssoRedirectUrl).toBe("https://demo.spid.gov.it/samlsso");
    expect(idp.ssoPostUrl).toBe("https://demo.spid.gov.it/samlsso");
    expect(idp.signingCerts.length).toBeGreaterThan(0);
    expect(idp.signingCerts[0]).toContain("MIIB");
  });
});
