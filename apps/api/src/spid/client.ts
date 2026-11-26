import fs from "node:fs";
import { ValidateInResponseTo, type Profile } from "@node-saml/node-saml";
import { getConfig } from "../config.js";
import { parseIdpMetadata, type IdpMetadata } from "./idpMetadata.js";
import { certToPem, resolveApiPath } from "./paths.js";
import { SpidSaml } from "./spidSaml.js";

export type SpidRuntime = {
  saml: SpidSaml;
  idp: IdpMetadata;
  entityId: string;
  acsUrl: string;
  spCertPem: string;
};

let cached: SpidRuntime | null = null;
let cachedIdpMtimeMs = -1;
let cachedIdpPath = "";

function spidUrls() {
  const cfg = getConfig();
  const base = cfg.SPID_BASE_URL.replace(/\/$/, "");
  const entityId = cfg.SPID_ENTITY_ID || `${base}/auth/spid/metadata`;
  const acsUrl = cfg.SPID_ACS_URL || `${base}/auth/spid/acs`;
  return { base, entityId, acsUrl };
}

export function resetSpidClientCache(): void {
  cached = null;
  cachedIdpMtimeMs = -1;
  cachedIdpPath = "";
}

export function loadSpidRuntime(): SpidRuntime {
  const cfg = getConfig();
  if (!cfg.SPID_ENABLED) {
    throw new Error("SPID is disabled");
  }

  const idpPath = resolveApiPath(cfg.SPID_IDP_METADATA_PATH);
  const idpMtimeMs = fs.statSync(idpPath).mtimeMs;
  if (
    cached &&
    cachedIdpPath === idpPath &&
    cachedIdpMtimeMs === idpMtimeMs
  ) {
    return cached;
  }

  const idpXml = fs.readFileSync(idpPath, "utf8");
  const idp = parseIdpMetadata(idpXml);
  const spKeyPem = fs.readFileSync(
    resolveApiPath(cfg.SPID_SP_KEY_PATH),
    "utf8",
  );
  const spCertPem = fs.readFileSync(
    resolveApiPath(cfg.SPID_SP_CERT_PATH),
    "utf8",
  );
  const { base, entityId, acsUrl } = spidUrls();

  const idpCerts = idp.signingCerts.map(certToPem);
  const orgName = cfg.SPID_ORG_NAME;
  const orgDisplay = cfg.SPID_ORG_DISPLAY_NAME;
  const orgUrl = (cfg.SPID_ORG_URL || base).replace(/\/$/, "");
  // Plain email (no mailto:) — Demo Check Strict validates EmailAddress as email.
  const contactEmail = cfg.SPID_CONTACT_EMAIL.replace(/^mailto:/i, "");
  const vat = cfg.SPID_VAT_NUMBER.trim() || "IT12345678901";
  const vatCountry = vat.slice(0, 2);
  const vatCode = vat.slice(2);

  const spidExt: Record<string, unknown> = {
    "@xmlns:spid": "https://spid.gov.it/saml-extensions",
    "spid:Private": {},
  };
  if (cfg.SPID_VAT_NUMBER.trim()) {
    spidExt["spid:VATNumber"] = vat;
  } else if (cfg.SPID_FISCAL_CODE.trim()) {
    spidExt["spid:FiscalCode"] = cfg.SPID_FISCAL_CODE.trim();
  } else {
    spidExt["spid:VATNumber"] = vat;
  }

  const billingExt: Record<string, unknown> = {
    "@xmlns:fpa": "https://spid.gov.it/invoicing-extensions",
    "fpa:CessionarioCommittente": {
      "fpa:DatiAnagrafici": {
        "fpa:IdFiscaleIVA": {
          "fpa:IdPaese": vatCountry || cfg.SPID_BILLING_COUNTRY,
          "fpa:IdCodice": vatCode || "12345678901",
        },
        "fpa:Anagrafica": {
          "fpa:Denominazione": orgName,
        },
      },
      "fpa:Sede": {
        "fpa:Indirizzo": cfg.SPID_BILLING_ADDRESS,
        "fpa:CAP": cfg.SPID_BILLING_CAP,
        "fpa:Comune": cfg.SPID_BILLING_CITY,
        "fpa:Provincia": cfg.SPID_BILLING_PROVINCE,
        "fpa:Nazione": cfg.SPID_BILLING_COUNTRY,
      },
    },
  };

  const sloUrl = `${base}/auth/spid/slo`;

  const saml = new SpidSaml({
    callbackUrl: acsUrl,
    // HTTP-POST AuthnRequest must Destination to the IdP POST SSO endpoint.
    entryPoint: idp.ssoPostUrl ?? idp.ssoRedirectUrl,
    issuer: entityId,
    idpCert: idpCerts,
    privateKey: spKeyPem,
    publicCert: spCertPem,
    decryptionPvk: spKeyPem,
    signatureAlgorithm: "sha256",
    digestAlgorithm: "sha256",
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    validateInResponseTo: ValidateInResponseTo.ifPresent,
    acceptedClockSkewMs: 5 * 60 * 1000,
    identifierFormat:
      "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
    authnContext: [cfg.SPID_AUTHN_CONTEXT],
    forceAuthn: cfg.SPID_AUTHN_CONTEXT.includes("SpidL2") ||
      cfg.SPID_AUTHN_CONTEXT.includes("SpidL3"),
    // SPID Demo / most Italian SPs use exact
    racComparison: "exact",
    audience: entityId,
    skipRequestCompression: true,
    // Demo Assertion Consumer Validator (QAD 2.1.12–17) requires
    // AssertionConsumerServiceURL + ProtocolBinding=HTTP-POST (not Index alone).
    disableRequestAcsUrl: false,
    logoutCallbackUrl: sloUrl,
    signMetadata: true,
    attributeConsumingServiceIndex: "0",
    metadataOrganization: {
      OrganizationName: [
        { "@xml:lang": "it", "#text": orgName },
        { "@xml:lang": "en", "#text": orgName },
      ],
      OrganizationDisplayName: [
        { "@xml:lang": "it", "#text": orgDisplay },
        { "@xml:lang": "en", "#text": orgDisplay },
      ],
      OrganizationURL: [
        { "@xml:lang": "it", "#text": orgUrl },
        { "@xml:lang": "en", "#text": orgUrl },
      ],
    },
    metadataContactPerson: [
      {
        "@contactType": "other",
        Extensions: spidExt,
        Company: orgName,
        EmailAddress: [contactEmail],
      },
      {
        "@contactType": "billing",
        Extensions: billingExt,
        Company: orgName,
        EmailAddress: [contactEmail],
      },
    ],
    metadataAttributeConsumingServices: [
      {
        "@index": "0",
        "@isDefault": true,
        ServiceName: [
          { "@xml:lang": "it", "#text": orgDisplay },
          { "@xml:lang": "en", "#text": orgDisplay },
        ],
        RequestedAttribute: [
          "spidCode",
          "name",
          "familyName",
          "fiscalNumber",
          "email",
        ].map((name) => ({
          "@Name": name,
          "@NameFormat":
            "urn:oasis:names:tc:SAML:2.0:attrname-format:basic" as const,
          "@isRequired": name === "fiscalNumber",
        })),
      },
    ],
  });

  cached = { saml, idp, entityId, acsUrl, spCertPem };
  cachedIdpPath = idpPath;
  cachedIdpMtimeMs = idpMtimeMs;
  return cached;
}

export function getSpMetadataXml(): string {
  const { saml, spCertPem } = loadSpidRuntime();
  return saml.generateServiceProviderMetadata(spCertPem, spCertPem);
}

/** HTTP-POST AuthnRequest (XML signed) — required by Demo/Validator. */
export async function getSpidAuthorizeForm(relayState?: string): Promise<string> {
  const { saml } = loadSpidRuntime();
  return saml.getAuthorizeFormAsync(relayState ?? "", undefined);
}

export async function validateSpidResponse(
  body: Record<string, string>,
): Promise<Profile> {
  const { saml } = loadSpidRuntime();
  const { profile, loggedOut } = await saml.validatePostResponseAsync(body);
  if (loggedOut) {
    throw new Error("Unexpected SPID logout response");
  }
  if (!profile) {
    throw new Error("Empty SPID profile");
  }
  return profile;
}
