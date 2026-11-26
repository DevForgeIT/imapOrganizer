import { createRequire } from "node:module";
import { SAML } from "@node-saml/node-saml";

const require = createRequire(import.meta.url);
const { signXmlMetadata } = require("@node-saml/node-saml/lib/utility.js") as {
  signXmlMetadata: (
    xml: string,
    options: {
      privateKey: string | Buffer;
      publicCert?: string | Buffer | null;
      signatureAlgorithm?: string;
      xmlSignatureTransforms?: string[];
      digestAlgorithm?: string;
    },
  ) => string;
};
const { signAuthnRequestPost } = require(
  "@node-saml/node-saml/lib/saml-post-signing.js",
) as {
  signAuthnRequestPost: (
    authnRequest: string,
    options: {
      privateKey: string | Buffer;
      publicCert?: string | Buffer;
      signatureAlgorithm?: string;
      xmlSignatureTransforms?: string[];
      digestAlgorithm?: string;
    },
  ) => string;
};

const ISSUER_FORMAT =
  "urn:oasis:names:tc:SAML:2.0:nameid-format:entity";

/**
 * SPID patches on top of node-saml:
 * - Issuer @Format + @NameQualifier (QAD 2.2.x)
 * - remove NameIDPolicy/@AllowCreate (QAD 2.3.1)
 * - ACS metadata index "0" (QAD 1.1.8)
 * - for HTTP-POST: patch XML *before* signing (QAD 2.7 / 2.8)
 */
export class SpidSaml extends SAML {
  protected async generateAuthorizeRequestAsync(
    isPassive: boolean,
    isHttpPostBinding: boolean,
  ): Promise<string> {
    // Always build unsigned first so SPID patches don't invalidate the XML signature.
    let xml = await super.generateAuthorizeRequestAsync(isPassive, false);

    // Some SPID validators are picky about the XML declaration in POST AuthnRequest.
    xml = xml.replace(/^<\?xml[^?]*\?>\s*/i, "");

    if (!/<saml:Issuer\b[^>]*\bNameQualifier=/i.test(xml)) {
      const nameQualifier = this.options.issuer;
      xml = xml.replace(
        /<(?:saml:)?Issuer(\s[^>]*)?>/i,
        (_m, attrs: string = "") =>
          `<saml:Issuer${attrs} Format="${ISSUER_FORMAT}" NameQualifier="${escapeXmlAttr(nameQualifier)}">`,
      );
    }

    // SPID QAD 2.3.1: AllowCreate must not be present
    xml = xml.replace(/\sAllowCreate="(?:true|false)"/gi, "");

    // Demo QAD 2.1.11: IsPassive must not appear (even as false).
    xml = xml.replace(/\sIsPassive="(?:true|false)"/gi, "");

    // Demo QAD 2.1.12–17 expects ACS URL + ProtocolBinding=HTTP-POST.
    // Index mode (disableRequestAcsUrl) is the alternative preferred by regole tecniche.
    if (this.options.disableRequestAcsUrl) {
      xml = xml.replace(/\sProtocolBinding="[^"]*"/g, "");
      xml = xml.replace(/\sAssertionConsumerServiceURL="[^"]*"/g, "");
      if (!/\bAssertionConsumerServiceIndex=/.test(xml)) {
        xml = xml.replace(
          /<samlp:AuthnRequest\b([^>]*)>/,
          '<samlp:AuthnRequest$1 AssertionConsumerServiceIndex="0">',
        );
      }
    } else {
      // Do not send both Index and URL.
      xml = xml.replace(/\sAssertionConsumerServiceIndex="[^"]*"/g, "");
      if (!/\bProtocolBinding=/.test(xml)) {
        xml = xml.replace(
          /<samlp:AuthnRequest\b/,
          '<samlp:AuthnRequest ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
        );
      }
    }

    if (isHttpPostBinding && this.options.privateKey) {
      // publicCert is required so xml-crypto emits KeyInfo/X509Certificate (SPID Demo).
      xml = signAuthnRequestPost(xml, {
        privateKey: this.options.privateKey,
        publicCert: this.options.publicCert,
        signatureAlgorithm: this.options.signatureAlgorithm ?? "sha256",
        xmlSignatureTransforms: this.options.xmlSignatureTransforms,
        digestAlgorithm: this.options.digestAlgorithm ?? "sha256",
      });
    }

    return xml;
  }

  generateServiceProviderMetadata(
    decryptionCert: string | null,
    signingCert?: string | string[] | null,
  ): string {
    const wantSign = this.options.signMetadata === true;
    this.options.signMetadata = false;
    let xml = super.generateServiceProviderMetadata(
      decryptionCert,
      signingCert,
    );
    this.options.signMetadata = wantSign;

    xml = xml.replace(
      /(<AssertionConsumerService\b[^>]*?)\sindex="1"/,
      '$1 index="0"',
    );

    if (wantSign && this.options.privateKey) {
      // publicCert required so Signature includes KeyInfo (xmlsec "key is not found" otherwise)
      const pub =
        pickCert(this.options.publicCert) ??
        pickCert(signingCert) ??
        decryptionCert;
      xml = signXmlMetadata(xml, {
        privateKey: this.options.privateKey,
        publicCert: pub,
        signatureAlgorithm: this.options.signatureAlgorithm ?? "sha256",
        xmlSignatureTransforms: this.options.xmlSignatureTransforms,
        digestAlgorithm: this.options.digestAlgorithm ?? "sha256",
      });
    }
    return xml;
  }
}

function pickCert(
  value: string | Buffer | string[] | null | undefined,
): string | Buffer | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
