// backend/src/lib/legal.js

import fs from "fs";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";
import { marked } from "marked";
import { fileURLToPath } from "url";
import yaml from "yaml";

/* =========================================================
 * Paths
 * ========================================================= */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * Din:
 * backend/src/lib/legal.js
 *
 * ajungem la:
 * backend/legal
 */
const LEGAL_DIR = path.resolve(__dirname, "../../legal");
const MANIFEST_PATH = path.join(LEGAL_DIR, "manifest.yml");

/* =========================================================
 * Constants
 * ========================================================= */

const PUBLIC_URLS = {
  tos: "/termenii-si-conditiile",
  privacy: "/confidentialitate",
  cookies: "/cookies",

  vendor_terms: "/acord-vanzatori",
  shipping_addendum: "/anexa-expediere",
  returns_policy_ack: "/politica-retur",
  products_addendum: "/anexa-produse",
};

/* =========================================================
 * General helpers
 * ========================================================= */

function checksumSHA256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""), "utf8")
    .digest("hex");
}

function normalizeText(raw) {
  return String(raw ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function normalizeLegalKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function readUtf8File(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return normalizeText(raw);
}

function readYamlFile(filePath) {
  const raw = readUtf8File(filePath);
  return yaml.parse(raw);
}

function fileMtimeSafe(filePath) {
  return fs.statSync(filePath).mtimeMs;
}

/*
 * Protecție împotriva unor căi de forma:
 *
 * ../../alt-folder/file.md
 *
 * Toate documentele legale trebuie să rămână în LEGAL_DIR.
 */
function ensurePathInsideLegalDirectory(filePath) {
  const resolvedPath = path.resolve(filePath);
  const legalRoot = path.resolve(LEGAL_DIR);

  const relativePath = path.relative(legalRoot, resolvedPath);

  const isOutside =
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath);

  if (isOutside) {
    throw new Error(`legal_path_outside_root:${resolvedPath}`);
  }

  return resolvedPath;
}

/* =========================================================
 * Manifest cache
 * ========================================================= */

let manifestCache = null;
let manifestMtime = 0;

function validateManifest(manifest) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !manifest.documents ||
    typeof manifest.documents !== "object"
  ) {
    throw new Error("manifest_invalid");
  }

  for (const [key, documentDefinition] of Object.entries(
    manifest.documents
  )) {
    if (
      !documentDefinition ||
      typeof documentDefinition !== "object"
    ) {
      throw new Error(`manifest_document_invalid:${key}`);
    }

    const currentVersion = Number(documentDefinition.current);

    if (
      !Number.isInteger(currentVersion) ||
      currentVersion < 1
    ) {
      throw new Error(
        `manifest_current_version_invalid:${key}`
      );
    }

    if (
      !documentDefinition.files ||
      typeof documentDefinition.files !== "object"
    ) {
      throw new Error(`manifest_files_missing:${key}`);
    }

    const currentFile =
      documentDefinition.files[currentVersion] ??
      documentDefinition.files[String(currentVersion)];

    if (!currentFile?.path) {
      throw new Error(
        `manifest_current_file_missing:${key}:v${currentVersion}`
      );
    }
  }

  return manifest;
}

export function loadLegalManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`manifest_missing:${MANIFEST_PATH}`);
  }

  const currentMtime = fileMtimeSafe(MANIFEST_PATH);

  if (
    manifestCache &&
    manifestMtime === currentMtime
  ) {
    return manifestCache;
  }

  const parsedManifest = readYamlFile(MANIFEST_PATH);
  const validatedManifest = validateManifest(parsedManifest);

  manifestCache = validatedManifest;
  manifestMtime = currentMtime;

  return manifestCache;
}

/* =========================================================
 * Vars cache
 * ========================================================= */

const varsCache = new Map();

/*
 * key:
 * varsVersion
 *
 * value:
 * {
 *   mtime,
 *   data
 * }
 */
function loadVars(varsVersion) {
  const version = Number(varsVersion || 1);

  if (
    !Number.isInteger(version) ||
    version < 1
  ) {
    throw new Error(`vars_version_invalid:${varsVersion}`);
  }

  const filePath = path.join(
    LEGAL_DIR,
    "vars",
    `v${version}.yml`
  );

  ensurePathInsideLegalDirectory(filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`vars_not_found:v${version}`);
  }

  const currentMtime = fileMtimeSafe(filePath);
  const cached = varsCache.get(version);

  if (
    cached &&
    cached.mtime === currentMtime
  ) {
    return cached.data;
  }

  const data = readYamlFile(filePath) || {};

  varsCache.set(version, {
    mtime: currentMtime,
    data,
  });

  return data;
}

/* =========================================================
 * Document cache
 * ========================================================= */

const documentCache = new Map();

/*
 * key:
 * type::manifestVersion
 *
 * value:
 * {
 *   fingerprint,
 *   data
 * }
 */
function getDocumentCacheKey(type, version) {
  return `${type}::${String(version)}`;
}

/* =========================================================
 * Templating
 * ========================================================= */

function renderTemplate(value, vars) {
  if (value == null) {
    return "";
  }

  return String(value).replace(
    /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
    (_fullMatch, variableKey) => {
      const parts = variableKey.split(".");
      let current = vars;

      for (const part of parts) {
        if (
          current &&
          Object.prototype.hasOwnProperty.call(
            current,
            part
          )
        ) {
          current = current[part];
        } else {
          /*
           * Păstrăm comportamentul anterior:
           * o variabilă lipsă devine text gol.
           */
          return "";
        }
      }

      return current == null
        ? ""
        : String(current);
    }
  );
}

/* =========================================================
 * File resolution
 * ========================================================= */

function resolveDocumentPath(documentRelativePath) {
  const originalPath = String(
    documentRelativePath ?? ""
  ).trim();

  if (!originalPath) {
    throw new Error("document_path_missing");
  }

  /*
   * Manifestul poate avea:
   *
   * legal/docs/tos/v1.md
   *
   * sau:
   *
   * docs/tos/v1.md
   *
   * Ambele sunt acceptate.
   */
  const relativePath = originalPath.startsWith("legal/")
    ? originalPath.slice("legal/".length)
    : originalPath;

  const absolutePath = path.resolve(
    LEGAL_DIR,
    relativePath
  );

  return ensurePathInsideLegalDirectory(absolutePath);
}

function buildFingerprint(paths) {
  return paths
    .map((filePath) => {
      if (!fs.existsSync(filePath)) {
        return `${filePath}:missing`;
      }

      return `${filePath}:${fileMtimeSafe(filePath)}`;
    })
    .join("|");
}

/* =========================================================
 * Manifest/document metadata
 * ========================================================= */

export function listLegalTypes() {
  const manifest = loadLegalManifest();

  return Object.keys(manifest.documents || {});
}

export function getLegalDefinition(type) {
  const normalizedType = normalizeLegalKey(type);
  const manifest = loadLegalManifest();

  const definition =
    manifest.documents?.[normalizedType];

  if (!definition) {
    throw new Error(`unknown_type:${normalizedType}`);
  }

  return {
    type: normalizedType,
    title:
      String(definition.title || normalizedType).trim(),
    scope:
      String(definition.scope || "USER")
        .trim()
        .toUpperCase(),
    required:
      definition.required === true,
    current:
      Number(definition.current),
    files:
      definition.files || {},
    publicUrl:
      defaultPublicUrlForType(normalizedType),
  };
}

export function listLegalDefinitions() {
  return listLegalTypes().map((type) =>
    getLegalDefinition(type)
  );
}

/* =========================================================
 * Load legal document
 * ========================================================= */

/**
 * Încarcă un document legal.
 *
 * Exemple:
 *
 * loadLegalDoc("tos")
 * loadLegalDoc("tos", { version: 1 })
 * loadLegalDoc("tos", { version: 2 })
 */
export function loadLegalDoc(type, options = {}) {
  const normalizedType = normalizeLegalKey(type);
  const definition = getLegalDefinition(normalizedType);

  const manifestVersion =
    options.version != null
      ? Number(options.version)
      : Number(definition.current);

  if (
    !Number.isInteger(manifestVersion) ||
    manifestVersion < 1
  ) {
    throw new Error(
      `version_invalid:${normalizedType}:${options.version}`
    );
  }

  const fileMeta =
    definition.files?.[manifestVersion] ??
    definition.files?.[String(manifestVersion)];

  if (!fileMeta?.path) {
    throw new Error(
      `version_not_found:${normalizedType}:v${manifestVersion}`
    );
  }

  const documentPath = resolveDocumentPath(fileMeta.path);

  if (!fs.existsSync(documentPath)) {
    throw new Error(
      `file_missing:${normalizedType}:v${manifestVersion}:${documentPath}`
    );
  }

  const varsVersion = Number(fileMeta.vars ?? 1);

  if (
    !Number.isInteger(varsVersion) ||
    varsVersion < 1
  ) {
    throw new Error(
      `vars_version_invalid:${normalizedType}:v${manifestVersion}`
    );
  }

  const varsPath = ensurePathInsideLegalDirectory(
    path.join(
      LEGAL_DIR,
      "vars",
      `v${varsVersion}.yml`
    )
  );

  if (!fs.existsSync(varsPath)) {
    throw new Error(`vars_not_found:v${varsVersion}`);
  }

  const cacheKey = getDocumentCacheKey(
    normalizedType,
    manifestVersion
  );

  const fingerprint = buildFingerprint([
    MANIFEST_PATH,
    documentPath,
    varsPath,
  ]);

  const cached = documentCache.get(cacheKey);

  if (
    cached &&
    cached.fingerprint === fingerprint
  ) {
    return cached.data;
  }

  const raw = readUtf8File(documentPath);
  const parsed = matter(raw);
  const vars = loadVars(varsVersion);

  const title = renderTemplate(
    parsed.data?.title ||
      definition.title ||
      normalizedType,
    vars
  ).trim();

  const validFrom = renderTemplate(
    parsed.data?.valid_from || "",
    vars
  ).trim();

  const content = renderTemplate(
    parsed.content || "",
    vars
  ).trim();

  const html = marked.parse(content);

  /*
   * Versiunea din front matter poate fi:
   *
   * version: 2
   * semver: 2.0.0
   *
   * Pentru DB preferăm semver dacă există.
   */
  const documentVersion =
    parsed.data?.version != null
      ? parsed.data.version
      : manifestVersion;

  const semver = parsed.data?.semver
    ? String(parsed.data.semver).trim()
    : null;

  const policyVersion =
    semver ||
    String(documentVersion || manifestVersion);

  /*
   * Păstrăm checksum-ul vechi pentru compatibilitate
   * cu acceptările și politicile deja salvate.
   */
  const sourceChecksum = checksumSHA256(raw);

  /*
   * Pentru politicile publicate de acum înainte
   * folosim și checksum-ul conținutului final.
   *
   * Acesta se schimbă inclusiv dacă se modifică vars.
   */
  const renderedSnapshot = JSON.stringify({
    type: normalizedType,
    title,
    policyVersion,
    validFrom: validFrom || null,
    content,
  });

  const renderedChecksum =
    checksumSHA256(renderedSnapshot);

  const result = {
    type: normalizedType,
    key: normalizedType,

    title:
      title ||
      definition.title ||
      normalizedType,

    scope: definition.scope,
    required: definition.required,

    /*
     * Versiunea numerică folosită în manifest:
     * 1, 2, 3...
     */
    manifestVersion,

    /*
     * Compatibilitate cu vechiul cod.
     */
    version: documentVersion,
    semver,

    /*
     * Versiunea recomandată pentru UserPolicy /
     * VendorPolicy.
     */
    policyVersion,

    valid_from:
      validFrom || null,

    /*
     * Compatibilitate cu vechiul cod.
     */
    checksum: sourceChecksum,

    sourceChecksum,
    renderedChecksum,

    content,
    html,

    sourcePath: documentPath,
    varsVersion,

    publicUrl:
      defaultPublicUrlForType(normalizedType),

    htmlUrl:
      `/legal/${encodeURIComponent(normalizedType)}.html`,

    versionHtmlUrl:
      `/legal/${encodeURIComponent(
        normalizedType
      )}/v/${manifestVersion}.html`,
  };

  documentCache.set(cacheKey, {
    fingerprint,
    data: result,
  });

  return result;
}

/**
 * Încarcă mai multe documente.
 *
 * Implicit încarcă versiunile marcate current
 * în manifest.
 */
export function loadMany(types = []) {
  if (!Array.isArray(types)) {
    throw new Error("legal_types_must_be_array");
  }

  return types
    .map(normalizeLegalKey)
    .filter(Boolean)
    .map((type) => loadLegalDoc(type));
}

/* =========================================================
 * Public URLs
 * ========================================================= */

export function defaultPublicUrlForType(type) {
  const normalizedType = normalizeLegalKey(type);

  return PUBLIC_URLS[normalizedType] || "#";
}

/* =========================================================
 * Cache
 * ========================================================= */

export function clearLegalCache() {
  manifestCache = null;
  manifestMtime = 0;

  varsCache.clear();
  documentCache.clear();
}

/* =========================================================
 * Optional diagnostics
 * ========================================================= */

/**
 * Util pentru verificări în scripturi/admin.
 *
 * Nu scrie nimic în DB.
 */
export function validateAllLegalDocuments() {
  const results = [];

  for (const type of listLegalTypes()) {
    try {
      const document = loadLegalDoc(type);

      results.push({
        type,
        ok: true,
        manifestVersion: document.manifestVersion,
        policyVersion: document.policyVersion,
        sourcePath: document.sourcePath,
        sourceChecksum: document.sourceChecksum,
        renderedChecksum: document.renderedChecksum,
      });
    } catch (error) {
      results.push({
        type,
        ok: false,
        error:
          error?.message ||
          "unknown_legal_validation_error",
      });
    }
  }

  return results;
}