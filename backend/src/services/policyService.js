// backend/src/services/policyService.js

import { prisma } from "../db.js";

import {
  getLegalDefinition,
  listLegalTypes,
  loadLegalDoc,
} from "../lib/legal.js";

/* =========================================================
 * Mapări manifest -> Prisma
 * ========================================================= */

/*
 * Cheia din manifest:
 *
 * tos
 * privacy
 * cookies
 * returns_policy_ack
 *
 * devine valoarea din enumul ConsentDoc.
 */
const LEGAL_TYPE_TO_USER_DOCUMENT = {
  tos: "TOS",
  privacy: "PRIVACY_ACK",
  cookies: "COOKIES_ACK",
  returns_policy_ack: "RETURNS_POLICY_ACK",
};

/*
 * Cheia din manifest:
 *
 * vendor_terms
 * shipping_addendum
 * returns_policy_ack
 * products_addendum
 *
 * devine valoarea din enumul VendorDoc.
 */
const LEGAL_TYPE_TO_VENDOR_DOCUMENT = {
  vendor_terms: "VENDOR_TERMS",
  shipping_addendum: "SHIPPING_ADDENDUM",
  returns_policy_ack: "RETURNS_POLICY_ACK",
  products_addendum: "PRODUCTS_ADDENDUM",
};

/*
 * Cheile folosite de frontend și de notificările
 * pentru PolicyGate.
 */
const GATE_KEY_TO_USER_DOCUMENT = {
  TOS: "TOS",
  PRIVACY: "PRIVACY_ACK",
  COOKIES: "COOKIES_ACK",
  RETURNS_POLICY_ACK: "RETURNS_POLICY_ACK",
  MARKETING: "MARKETING_EMAIL_OPTIN",
};

const USER_DOCUMENT_TO_GATE_KEY = {
  TOS: "TOS",
  PRIVACY_ACK: "PRIVACY",
  COOKIES_ACK: "COOKIES",
  RETURNS_POLICY_ACK: "RETURNS_POLICY_ACK",
  MARKETING_EMAIL_OPTIN: "MARKETING",
};

const GATE_KEY_TO_VENDOR_DOCUMENT = {
  VENDOR_TERMS: "VENDOR_TERMS",
  VENDOR_PRIVACY_NOTICE: "VENDOR_PRIVACY_NOTICE",
  SHIPPING_ADDENDUM: "SHIPPING_ADDENDUM",
  PRODUCTS_ADDENDUM: "PRODUCTS_ADDENDUM",
  RETURNS_POLICY_ACK: "RETURNS_POLICY_ACK",
};

/*
 * PRODUCT_DECLARATION nu este publicată în UserPolicy
 * sau VendorPolicy.
 *
 * Ea este păstrată separat în:
 * VendorProductDeclaration.
 */
const SPECIAL_VENDOR_DOCUMENTS = new Set([
  "PRODUCT_DECLARATION",
]);

/* =========================================================
 * Etichete și URL-uri fallback
 * ========================================================= */

const DOCUMENT_LABELS = {
  TOS: "Termeni și Condiții",
  PRIVACY: "Politica de confidențialitate",
  PRIVACY_ACK: "Politica de confidențialitate",
  COOKIES: "Politica de Cookie-uri",
  COOKIES_ACK: "Politica de Cookie-uri",
  RETURNS_POLICY_ACK: "Politica de retur",
  MARKETING: "Preferințe marketing",
  MARKETING_EMAIL_OPTIN: "Preferințe marketing",

  VENDOR_TERMS: "Acordul Marketplace pentru Vânzători",
  VENDOR_PRIVACY_NOTICE: "Notă GDPR pentru vânzători",
  SHIPPING_ADDENDUM: "Anexa de Expediere și Curierat",
  PRODUCTS_ADDENDUM: "Anexa Produse",
  PRODUCT_DECLARATION: "Declarație privind produsele",
};

const DOCUMENT_URLS = {
  TOS: "/termenii-si-conditiile",
  PRIVACY: "/confidentialitate",
  PRIVACY_ACK: "/confidentialitate",
  COOKIES: "/cookies",
  COOKIES_ACK: "/cookies",
  RETURNS_POLICY_ACK: "/politica-retur",

  VENDOR_TERMS: "/acord-vanzatori",
  VENDOR_PRIVACY_NOTICE: "/confidentialitate",
  SHIPPING_ADDENDUM: "/anexa-expediere",
  PRODUCTS_ADDENDUM: "/anexa-produse",
  PRODUCT_DECLARATION: "/vendor/legal/product-declaration",
};

/* =========================================================
 * Helpers generale
 * ========================================================= */

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeLegalType(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeDocumentKey(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeScope(value) {
  return normalizeText(value).toUpperCase();
}

function normalizeDocumentKeys(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((item) => {
          if (typeof item === "string") {
            return normalizeDocumentKey(item);
          }

          if (typeof item?.key === "string") {
            return normalizeDocumentKey(item.key);
          }

          if (typeof item?.document === "string") {
            return normalizeDocumentKey(item.document);
          }

          return "";
        })
        .filter(Boolean)
    )
  );
}

function normalizeTypes(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map(normalizeLegalType)
        .filter(Boolean)
    )
  );
}

function getPolicyVersion(document) {
  return normalizeText(
    document?.policyVersion ||
      document?.semver ||
      document?.version ||
      document?.manifestVersion
  );
}

function getPolicyChecksum(document) {
  /*
   * Pentru versiunile publicate de acum înainte
   * preferăm checksum-ul conținutului final.
   *
   * Dacă nu există, revenim la checksum-ul vechi.
   */
  return (
    document?.renderedChecksum ||
    document?.checksum ||
    document?.sourceChecksum ||
    null
  );
}

function assertValidScope(scope) {
  const normalized = normalizeScope(scope);

  if (!["USERS", "VENDORS"].includes(normalized)) {
    const error = new Error("invalid_policy_scope");
    error.code = "invalid_policy_scope";
    throw error;
  }

  return normalized;
}

function assertUserId(userId) {
  const normalized = normalizeText(userId);

  if (!normalized) {
    const error = new Error("user_id_required");
    error.code = "user_id_required";
    throw error;
  }

  return normalized;
}

function assertVendorId(vendorId) {
  const normalized = normalizeText(vendorId);

  if (!normalized) {
    const error = new Error("vendor_id_required");
    error.code = "vendor_id_required";
    throw error;
  }

  return normalized;
}

/* =========================================================
 * Publicare politici din manifest
 * ========================================================= */

/**
 * Publică documentele curente din manifest în:
 *
 * - UserPolicy
 * - VendorPolicy
 *
 * Nu șterge:
 *
 * - politicile vechi;
 * - UserConsent;
 * - VendorAcceptance.
 *
 * Versiunile vechi sunt doar marcate:
 *
 * isActive: false
 *
 * @param {object} options
 * @param {string[]} [options.types]
 * @param {Date} [options.publishedAt]
 * @param {boolean} [options.deactivatePrevious]
 */
export async function publishPoliciesFromManifest({
  types,
  publishedAt = new Date(),
  deactivatePrevious = true,
} = {}) {
  const availableTypes = listLegalTypes();

  const requestedTypes =
    Array.isArray(types) && types.length
      ? normalizeTypes(types)
      : availableTypes;

  const unknownTypes = requestedTypes.filter(
    (type) => !availableTypes.includes(type)
  );

  if (unknownTypes.length) {
    const error = new Error(
      `unknown_legal_types:${unknownTypes.join(",")}`
    );

    error.code = "unknown_legal_types";
    error.unknownTypes = unknownTypes;

    throw error;
  }

  /*
   * Citim și validăm toate documentele înainte
   * să începem tranzacția.
   *
   * Dacă un fișier lipsește sau manifestul este greșit,
   * nu modificăm nimic în DB.
   */
  const loadedDocuments = requestedTypes.map((type) => {
    const definition = getLegalDefinition(type);
    const document = loadLegalDoc(type);

    return {
      type,
      definition,
      document,
    };
  });

  return prisma.$transaction(async (tx) => {
    const results = [];

    for (const item of loadedDocuments) {
      const {
        type,
        definition,
        document,
      } = item;

      const manifestScope = normalizeScope(
        definition.scope
      );

      const version = getPolicyVersion(document);

      if (!version) {
        const error = new Error(
          `policy_version_missing:${type}`
        );

        error.code = "policy_version_missing";
        error.type = type;

        throw error;
      }

      const title =
        normalizeText(document.title) ||
        normalizeText(definition.title) ||
        type;

      const url =
        normalizeText(document.publicUrl) ||
        "#";

      const checksum =
        getPolicyChecksum(document);

      const isRequired =
        definition.required === true;

      /*
       * USER și BOTH publică în UserPolicy.
       */
      if (
        manifestScope === "USER" ||
        manifestScope === "USERS" ||
        manifestScope === "BOTH"
      ) {
        const userDocument =
          LEGAL_TYPE_TO_USER_DOCUMENT[type];

        if (!userDocument) {
          const error = new Error(
            `user_document_mapping_missing:${type}`
          );

          error.code =
            "user_document_mapping_missing";

          error.type = type;

          throw error;
        }

        if (deactivatePrevious) {
          await tx.userPolicy.updateMany({
            where: {
              document: userDocument,
              version: {
                not: version,
              },
              isActive: true,
            },
            data: {
              isActive: false,
            },
          });
        }

        const policy =
          await tx.userPolicy.upsert({
            where: {
              document_version: {
                document: userDocument,
                version,
              },
            },
            create: {
              document: userDocument,
              title,
              url,
              version,
              checksum,
              isRequired,
              isActive: true,
              publishedAt,
            },
            update: {
              title,
              url,
              checksum,
              isRequired,
              isActive: true,
              publishedAt,
            },
          });

        results.push({
          scope: "USERS",
          type,
          document: userDocument,
          version: policy.version,
          title: policy.title,
          url: policy.url,
          checksum: policy.checksum,
          isRequired: policy.isRequired,
          isActive: policy.isActive,
          publishedAt: policy.publishedAt,
        });
      }

      /*
       * VENDOR și BOTH publică în VendorPolicy.
       */
      if (
        manifestScope === "VENDOR" ||
        manifestScope === "VENDORS" ||
        manifestScope === "BOTH"
      ) {
        const vendorDocument =
          LEGAL_TYPE_TO_VENDOR_DOCUMENT[type];

        if (!vendorDocument) {
          const error = new Error(
            `vendor_document_mapping_missing:${type}`
          );

          error.code =
            "vendor_document_mapping_missing";

          error.type = type;

          throw error;
        }

        if (deactivatePrevious) {
          await tx.vendorPolicy.updateMany({
            where: {
              document: vendorDocument,
              version: {
                not: version,
              },
              isActive: true,
            },
            data: {
              isActive: false,
            },
          });
        }

        const policy =
          await tx.vendorPolicy.upsert({
            where: {
              document_version: {
                document: vendorDocument,
                version,
              },
            },
            create: {
              document: vendorDocument,
              title,
              url,
              version,
              checksum,
              isRequired,
              isActive: true,
              publishedAt,
            },
            update: {
              title,
              url,
              checksum,
              isRequired,
              isActive: true,
              publishedAt,
            },
          });

        results.push({
          scope: "VENDORS",
          type,
          document: vendorDocument,
          version: policy.version,
          title: policy.title,
          url: policy.url,
          checksum: policy.checksum,
          isRequired: policy.isRequired,
          isActive: policy.isActive,
          publishedAt: policy.publishedAt,
        });
      }

      if (
        ![
          "USER",
          "USERS",
          "VENDOR",
          "VENDORS",
          "BOTH",
        ].includes(manifestScope)
      ) {
        const error = new Error(
          `manifest_scope_invalid:${type}:${manifestScope}`
        );

        error.code = "manifest_scope_invalid";
        error.type = type;
        error.scope = manifestScope;

        throw error;
      }
    }

    return {
      ok: true,
      requestedTypes,
      publishedCount: results.length,
      policies: results,
    };
  });
}

/* =========================================================
 * Citirea politicilor active
 * ========================================================= */

export async function getActiveUserPolicies({
  documents,
} = {}) {
  const normalizedDocuments =
    Array.isArray(documents) && documents.length
      ? Array.from(
          new Set(
            documents
              .map(normalizeDocumentKey)
              .map(
                (key) =>
                  GATE_KEY_TO_USER_DOCUMENT[key] ||
                  key
              )
              .filter(Boolean)
          )
        )
      : null;

  const rows = await prisma.userPolicy.findMany({
    where: {
      isActive: true,
      ...(normalizedDocuments
        ? {
            document: {
              in: normalizedDocuments,
            },
          }
        : {}),
    },
    orderBy: [
      {
        document: "asc",
      },
      {
        publishedAt: "desc",
      },
    ],
  });

  const latest = new Map();

  for (const row of rows) {
    if (!latest.has(row.document)) {
      latest.set(row.document, row);
    }
  }

  return Array.from(latest.values());
}

export async function getActiveVendorPolicies({
  documents,
} = {}) {
  const normalizedDocuments =
    Array.isArray(documents) && documents.length
      ? Array.from(
          new Set(
            documents
              .map(normalizeDocumentKey)
              .map(
                (key) =>
                  GATE_KEY_TO_VENDOR_DOCUMENT[key] ||
                  key
              )
              .filter(
                (key) =>
                  !SPECIAL_VENDOR_DOCUMENTS.has(key)
              )
          )
        )
      : null;

  const rows = await prisma.vendorPolicy.findMany({
    where: {
      isActive: true,
      ...(normalizedDocuments
        ? {
            document: {
              in: normalizedDocuments,
            },
          }
        : {}),
    },
    orderBy: [
      {
        document: "asc",
      },
      {
        publishedAt: "desc",
      },
    ],
  });

  const latest = new Map();

  for (const row of rows) {
    if (!latest.has(row.document)) {
      latest.set(row.document, row);
    }
  }

  return Array.from(latest.values());
}

/* =========================================================
 * Construirea documentelor pentru PolicyGate
 * ========================================================= */

/**
 * Construiește lista pe care frontendul PolicyGate
 * o poate afișa direct.
 */
export async function buildPolicyGateDocuments({
  scope,
  userId,
  vendorId,
  documentKeys,
}) {
  const normalizedScope =
    assertValidScope(scope);

  const keys =
    normalizeDocumentKeys(documentKeys);

  if (!keys.length) {
    return [];
  }

  if (normalizedScope === "USERS") {
    const normalizedUserId =
      assertUserId(userId);

    const dbDocuments = Array.from(
      new Set(
        keys
          .map(
            (key) =>
              GATE_KEY_TO_USER_DOCUMENT[key]
          )
          .filter(Boolean)
      )
    );

    if (!dbDocuments.length) {
      return [];
    }

    const policies =
      await getActiveUserPolicies({
        documents: dbDocuments,
      });

    const consents =
      await prisma.userConsent.findMany({
        where: {
          userId: normalizedUserId,
          document: {
            in: dbDocuments,
          },
        },
        select: {
          document: true,
          version: true,
          givenAt: true,
        },
      });

    const acceptedSet = new Set(
      consents.map(
        (consent) =>
          `${consent.document}::${consent.version}`
      )
    );

    return policies.map((policy) => {
      const key =
        USER_DOCUMENT_TO_GATE_KEY[
          policy.document
        ] || policy.document;

      return {
        key,
        document: policy.document,
        title:
          policy.title ||
          DOCUMENT_LABELS[key] ||
          DOCUMENT_LABELS[policy.document] ||
          key,
        version: policy.version,
        checksum: policy.checksum || null,
        url:
          policy.url ||
          DOCUMENT_URLS[key] ||
          DOCUMENT_URLS[policy.document] ||
          null,
        required: policy.isRequired === true,
        alreadyAccepted: acceptedSet.has(
          `${policy.document}::${policy.version}`
        ),
        publishedAt:
          policy.publishedAt || null,
      };
    });
  }

  const normalizedVendorId =
    assertVendorId(vendorId);

  const normalKeys = keys.filter(
    (key) =>
      !SPECIAL_VENDOR_DOCUMENTS.has(key)
  );

  const dbDocuments = Array.from(
    new Set(
      normalKeys
        .map(
          (key) =>
            GATE_KEY_TO_VENDOR_DOCUMENT[key]
        )
        .filter(Boolean)
    )
  );

  const policies = dbDocuments.length
    ? await getActiveVendorPolicies({
        documents: dbDocuments,
      })
    : [];

  const acceptances = dbDocuments.length
    ? await prisma.vendorAcceptance.findMany({
        where: {
          vendorId: normalizedVendorId,
          document: {
            in: dbDocuments,
          },
        },
        select: {
          document: true,
          version: true,
          acceptedAt: true,
        },
      })
    : [];

  const acceptedSet = new Set(
    acceptances.map(
      (acceptance) =>
        `${acceptance.document}::${acceptance.version}`
    )
  );

  const result = policies.map((policy) => ({
    key: policy.document,
    document: policy.document,
    title:
      policy.title ||
      DOCUMENT_LABELS[policy.document] ||
      policy.document,
    version: policy.version,
    checksum: policy.checksum || null,
    url:
      policy.url ||
      DOCUMENT_URLS[policy.document] ||
      null,
    required: policy.isRequired === true,
    alreadyAccepted: acceptedSet.has(
      `${policy.document}::${policy.version}`
    ),
    publishedAt:
      policy.publishedAt || null,
  }));

  if (
    keys.includes("PRODUCT_DECLARATION")
  ) {
    const declaration =
      await prisma.vendorProductDeclaration.findUnique({
        where: {
          vendorId: normalizedVendorId,
        },
        select: {
          version: true,
          acceptedAt: true,
        },
      });

    result.push({
      key: "PRODUCT_DECLARATION",
      document: "PRODUCT_DECLARATION",
      title:
        DOCUMENT_LABELS.PRODUCT_DECLARATION,
      version:
        declaration?.version || "1.0.0",
      checksum: null,
      url:
        DOCUMENT_URLS.PRODUCT_DECLARATION,
      required: true,
      alreadyAccepted: !!declaration,
      publishedAt: null,
    });
  }

  /*
   * Păstrăm ordinea documentelor selectate în admin.
   */
  const position = new Map(
    keys.map((key, index) => [
      key,
      index,
    ])
  );

  result.sort((a, b) => {
    const positionA =
      position.get(a.key) ??
      Number.MAX_SAFE_INTEGER;

    const positionB =
      position.get(b.key) ??
      Number.MAX_SAFE_INTEGER;

    return positionA - positionB;
  });

  return result;
}

/* =========================================================
 * Acceptarea documentelor
 * ========================================================= */

export async function acceptPolicyDocuments({
  scope,
  userId,
  vendorId,
  documentKeys,
  ip = null,
  ua = null,
  source = "policy_gate",
}) {
  const normalizedScope =
    assertValidScope(scope);

  const normalizedUserId =
    assertUserId(userId);

  const keys =
    normalizeDocumentKeys(documentKeys);

  if (!keys.length) {
    const error =
      new Error("no_documents");

    error.code = "no_documents";

    throw error;
  }

  if (normalizedScope === "USERS") {
    const invalidKeys = keys.filter(
      (key) =>
        !GATE_KEY_TO_USER_DOCUMENT[key]
    );

    if (invalidKeys.length) {
      const error =
        new Error("invalid_documents");

      error.code = "invalid_documents";
      error.invalidDocuments = invalidKeys;

      throw error;
    }

    const dbDocuments = Array.from(
      new Set(
        keys.map(
          (key) =>
            GATE_KEY_TO_USER_DOCUMENT[key]
        )
      )
    );

    return prisma.$transaction(
      async (tx) => {
        const policies =
          await tx.userPolicy.findMany({
            where: {
              isActive: true,
              document: {
                in: dbDocuments,
              },
            },
            orderBy: [
              {
                document: "asc",
              },
              {
                publishedAt: "desc",
              },
            ],
          });

        const latest = new Map();

        for (const policy of policies) {
          if (!latest.has(policy.document)) {
            latest.set(
              policy.document,
              policy
            );
          }
        }

        const missingPolicies =
          dbDocuments.filter(
            (document) =>
              !latest.has(document)
          );

        if (missingPolicies.length) {
          const error =
            new Error(
              "active_policy_missing"
            );

          error.code =
            "active_policy_missing";

          error.missingDocuments =
            missingPolicies;

          throw error;
        }

        const accepted = [];

        for (const document of dbDocuments) {
          const policy =
            latest.get(document);

          const consent =
            await tx.userConsent.upsert({
              where: {
                userId_document_version: {
                  userId:
                    normalizedUserId,
                  document:
                    policy.document,
                  version:
                    policy.version,
                },
              },
              create: {
                userId:
                  normalizedUserId,
                document:
                  policy.document,
                version:
                  policy.version,
                checksum:
                  policy.checksum || null,
                ip,
                ua,
              },
              update: {
                checksum:
                  policy.checksum || null,
                ip,
                ua,
                givenAt: new Date(),
              },
            });

          accepted.push({
            key:
              USER_DOCUMENT_TO_GATE_KEY[
                policy.document
              ] || policy.document,
            document:
              policy.document,
            version:
              policy.version,
            acceptedAt:
              consent.givenAt,
          });
        }

        return {
          ok: true,
          scope: normalizedScope,
          accepted,
        };
      }
    );
  }

  const normalizedVendorId =
    assertVendorId(vendorId);

  const invalidKeys = keys.filter(
    (key) =>
      key !== "PRODUCT_DECLARATION" &&
      !GATE_KEY_TO_VENDOR_DOCUMENT[key]
  );

  if (invalidKeys.length) {
    const error =
      new Error("invalid_documents");

    error.code = "invalid_documents";
    error.invalidDocuments = invalidKeys;

    throw error;
  }

  return prisma.$transaction(
    async (tx) => {
      const normalKeys = keys.filter(
        (key) =>
          key !== "PRODUCT_DECLARATION"
      );

      const dbDocuments = Array.from(
        new Set(
          normalKeys.map(
            (key) =>
              GATE_KEY_TO_VENDOR_DOCUMENT[key]
          )
        )
      );

      const policies = dbDocuments.length
        ? await tx.vendorPolicy.findMany({
            where: {
              isActive: true,
              document: {
                in: dbDocuments,
              },
            },
            orderBy: [
              {
                document: "asc",
              },
              {
                publishedAt: "desc",
              },
            ],
          })
        : [];

      const latest = new Map();

      for (const policy of policies) {
        if (!latest.has(policy.document)) {
          latest.set(
            policy.document,
            policy
          );
        }
      }

      const missingPolicies =
        dbDocuments.filter(
          (document) =>
            !latest.has(document)
        );

      if (missingPolicies.length) {
        const error =
          new Error(
            "active_policy_missing"
          );

        error.code =
          "active_policy_missing";

        error.missingDocuments =
          missingPolicies;

        throw error;
      }

      const accepted = [];

      for (const document of dbDocuments) {
        const policy =
          latest.get(document);

        const acceptance =
          await tx.vendorAcceptance.upsert({
            where: {
              vendorId_document_version: {
                vendorId:
                  normalizedVendorId,
                document:
                  policy.document,
                version:
                  policy.version,
              },
            },
            create: {
              vendorId:
                normalizedVendorId,
              userId:
                normalizedUserId,
              document:
                policy.document,
              version:
                policy.version,
              checksum:
                policy.checksum || null,
              acceptedAt:
                new Date(),
              ip,
              ua,
              source,
            },
            update: {
              userId:
                normalizedUserId,
              checksum:
                policy.checksum || null,
              acceptedAt:
                new Date(),
              ip,
              ua,
              source,
            },
          });

        accepted.push({
          key: policy.document,
          document:
            policy.document,
          version:
            policy.version,
          acceptedAt:
            acceptance.acceptedAt,
        });
      }

      if (
        keys.includes(
          "PRODUCT_DECLARATION"
        )
      ) {
        const declarationVersion =
          "1.0.0";

        const declaration =
          await tx.vendorProductDeclaration.upsert({
            where: {
              vendorId:
                normalizedVendorId,
            },
            create: {
              vendorId:
                normalizedVendorId,
              version:
                declarationVersion,
              acceptedAt:
                new Date(),
              ip,
              ua,
              meta: {
                source,
              },
            },
            update: {
              version:
                declarationVersion,
              acceptedAt:
                new Date(),
              ip,
              ua,
              meta: {
                source,
              },
            },
          });

        accepted.push({
          key:
            "PRODUCT_DECLARATION",
          document:
            "PRODUCT_DECLARATION",
          version:
            declaration.version,
          acceptedAt:
            declaration.acceptedAt,
        });
      }

      return {
        ok: true,
        scope: normalizedScope,
        accepted,
      };
    }
  );
}

/* =========================================================
 * Verificarea documentelor rămase
 * ========================================================= */

export async function getMissingRequiredDocuments({
  scope,
  userId,
  vendorId,
  documentKeys,
}) {
  const documents =
    await buildPolicyGateDocuments({
      scope,
      userId,
      vendorId,
      documentKeys,
    });

  return documents.filter(
    (document) =>
      document.required === true &&
      document.alreadyAccepted !== true
  );
}

/* =========================================================
 * Arhivarea notificării după acceptare
 * ========================================================= */

export async function archivePolicyNotification({
  notificationId,
  scope,
  userId,
  vendorId,
}) {
  const id =
    normalizeText(notificationId);

  if (!id) {
    return {
      ok: true,
      updatedCount: 0,
    };
  }

  const normalizedScope =
    assertValidScope(scope);

  const where = {
    id,
    archived: false,
    meta: {
      path: ["kind"],
      equals: "POLICY_UPDATE",
    },
  };

  if (normalizedScope === "USERS") {
    where.userId =
      assertUserId(userId);
  } else {
    where.vendorId =
      assertVendorId(vendorId);
  }

  const result =
    await prisma.notification.updateMany({
      where,
      data: {
        readAt: new Date(),
        archived: true,
      },
    });

  return {
    ok: true,
    updatedCount: result.count,
  };
}

/* =========================================================
 * Publicare + rezultate pentru admin
 * ========================================================= */

/**
 * Helper pentru viitorul endpoint:
 *
 * POST /api/admin/policies/publish
 *
 * Primește cheile din PolicyGate/Admin:
 *
 * USERS:
 * TOS, PRIVACY, COOKIES, RETURNS_POLICY_ACK
 *
 * VENDORS:
 * VENDOR_TERMS, SHIPPING_ADDENDUM,
 * PRODUCTS_ADDENDUM, RETURNS_POLICY_ACK
 */
export async function publishSelectedGateDocuments({
  scope,
  documentKeys,
  publishedAt = new Date(),
} = {}) {
  const normalizedScope =
    assertValidScope(scope);

  const keys =
    normalizeDocumentKeys(documentKeys);

  if (!keys.length) {
    const error =
      new Error("no_documents");

    error.code = "no_documents";

    throw error;
  }

  const types = [];

  if (normalizedScope === "USERS") {
    const keyToType = {
      TOS: "tos",
      PRIVACY: "privacy",
      COOKIES: "cookies",
      RETURNS_POLICY_ACK:
        "returns_policy_ack",
    };

    const invalidKeys = keys.filter(
      (key) => !keyToType[key]
    );

    if (invalidKeys.length) {
      const error =
        new Error("invalid_documents");

      error.code = "invalid_documents";
      error.invalidDocuments = invalidKeys;

      throw error;
    }

    for (const key of keys) {
      types.push(keyToType[key]);
    }
  } else {
    const keyToType = {
      VENDOR_TERMS: "vendor_terms",
      SHIPPING_ADDENDUM:
        "shipping_addendum",
      PRODUCTS_ADDENDUM:
        "products_addendum",
      RETURNS_POLICY_ACK:
        "returns_policy_ack",
    };

    /*
     * PRODUCT_DECLARATION este specială.
     * Nu se publică în VendorPolicy.
     */
    const publishableKeys = keys.filter(
      (key) =>
        key !== "PRODUCT_DECLARATION"
    );

    const invalidKeys =
      publishableKeys.filter(
        (key) => !keyToType[key]
      );

    if (invalidKeys.length) {
      const error =
        new Error("invalid_documents");

      error.code = "invalid_documents";
      error.invalidDocuments = invalidKeys;

      throw error;
    }

    for (const key of publishableKeys) {
      types.push(keyToType[key]);
    }
  }

  const uniqueTypes =
    Array.from(new Set(types));

  if (!uniqueTypes.length) {
    return {
      ok: true,
      requestedTypes: [],
      publishedCount: 0,
      policies: [],
    };
  }

  return publishPoliciesFromManifest({
    types: uniqueTypes,
    publishedAt,
    deactivatePrevious: true,
  });
}

/* =========================================================
 * Exporturi de diagnostic
 * ========================================================= */

export function getPolicyMappings() {
  return {
    legalTypeToUserDocument: {
      ...LEGAL_TYPE_TO_USER_DOCUMENT,
    },

    legalTypeToVendorDocument: {
      ...LEGAL_TYPE_TO_VENDOR_DOCUMENT,
    },

    gateKeyToUserDocument: {
      ...GATE_KEY_TO_USER_DOCUMENT,
    },

    gateKeyToVendorDocument: {
      ...GATE_KEY_TO_VENDOR_DOCUMENT,
    },
  };
}