// backend/src/lib/legal.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";
import { marked } from "marked";
import { fileURLToPath } from "url";
import yaml from "yaml";

// __dirname safe pentru ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// urcă din src/lib/ până la rădăcina backend, apoi intră în /legal
const LEGAL_DIR = path.resolve(__dirname, "../../legal");
const MANIFEST_PATH = path.join(LEGAL_DIR, "manifest.yml");

/* =========================
 * Helpers
 * ========================= */

function checksumSHA256(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

function normalizeText(raw) {
  return String(raw || "")
    .replace(/^\uFEFF/, "") // strip BOM
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function readUtf8File(fp) {
  const raw = fs.readFileSync(fp, "utf8");
  return normalizeText(raw);
}

function readYamlFile(fp) {
  const raw = readUtf8File(fp);
  return yaml.parse(raw);
}

function fileMtimeSafe(fp) {
  return fs.statSync(fp).mtimeMs;
}

/* =========================
 * Manifest cache
 * ========================= */

let _manifestCache = null;
let _manifestMtime = 0;

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`manifest_missing:${MANIFEST_PATH}`);
  }

  const mtime = fileMtimeSafe(MANIFEST_PATH);
  if (_manifestCache && _manifestMtime === mtime) {
    return _manifestCache;
  }

  const manifest = readYamlFile(MANIFEST_PATH);
  if (!manifest?.documents || typeof manifest.documents !== "object") {
    throw new Error("manifest_invalid");
  }

  _manifestCache = manifest;
  _manifestMtime = mtime;
  return manifest;
}

/* =========================
 * Vars cache
 * ========================= */

const _varsCache = new Map(); // key: version -> { mtime, data }

function loadVars(varsVersion) {
  const v = Number(varsVersion || 1);
  const fp = path.join(LEGAL_DIR, "vars", `v${v}.yml`);

  if (!fs.existsSync(fp)) {
    throw new Error(`vars_not_found:v${v}`);
  }

  const mtime = fileMtimeSafe(fp);
  const cached = _varsCache.get(v);

  if (cached && cached.mtime === mtime) {
    return cached.data;
  }

  const data = readYamlFile(fp) || {};
  _varsCache.set(v, { mtime, data });
  return data;
}

/* =========================
 * Document cache
 * ========================= */

const _docCache = new Map();
/**
 * key = `${type}::${version||"current"}`
 * value = { fingerprint, data }
 */

function getDocCacheKey(type, version) {
  return `${type}::${version == null ? "current" : String(version)}`;
}

/* =========================
 * Templating
 * ========================= */

// Înlocuiește {{a.b.c}} cu valoarea din vars
function renderTemplate(str, vars) {
  if (str == null) return str;

  return String(str).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    const parts = key.split(".");
    let cur = vars;

    for (const p of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
        cur = cur[p];
      } else {
        return "";
      }
    }

    return cur == null ? "" : String(cur);
  });
}

function resolveDocPath(docRelPath) {
  const rel = String(docRelPath || "").startsWith("legal/")
    ? String(docRelPath).slice("legal/".length)
    : String(docRelPath || "");

  return path.join(LEGAL_DIR, rel);
}

function buildFingerprint(paths) {
  return paths
    .map((fp) => `${fp}:${fs.existsSync(fp) ? fileMtimeSafe(fp) : "missing"}`)
    .join("|");
}

/* =========================
 * Public API
 * ========================= */

/**
 * Returnează lista de chei disponibile (types)
 */
export function listLegalTypes() {
  const manifest = loadManifest();
  return Object.keys(manifest.documents || {});
}

/**
 * Încarcă un document legal (latest sau versiune specifică)
 * key = "tos" | "privacy" | "vendor_terms" | ...
 */
export function loadLegalDoc(key, opts = {}) {
  const manifest = loadManifest();
  const doc = manifest.documents?.[key];

  if (!doc) {
    throw new Error(`unknown_type:${key}`);
  }

  const requestedVersion =
    opts.version != null ? Number(opts.version) : Number(doc.current);

  const fileMeta = doc.files?.[requestedVersion];
  if (!fileMeta?.path) {
    throw new Error(`version_not_found:${key}:v${requestedVersion}`);
  }

  const fp = resolveDocPath(fileMeta.path);
  if (!fs.existsSync(fp)) {
    throw new Error(`file_missing:${key}:v${requestedVersion}:${fp}`);
  }

  const varsVersion = Number(fileMeta.vars ?? 1);
  const varsPath = path.join(LEGAL_DIR, "vars", `v${varsVersion}.yml`);

  const cacheKey = getDocCacheKey(key, requestedVersion);
  const fingerprint = buildFingerprint([MANIFEST_PATH, fp, varsPath]);

  const cached = _docCache.get(cacheKey);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.data;
  }

  const raw = readUtf8File(fp);
  const parsed = matter(raw);
  const vars = loadVars(varsVersion);

  const title = renderTemplate(parsed.data?.title || doc.title || "", vars).trim();
  const valid_from = renderTemplate(parsed.data?.valid_from || "", vars).trim();
  const content = renderTemplate(parsed.content || "", vars).trim();

  const html = marked.parse(content);

  const result = {
    type: key,
    key,
    title: title || key,
    version: parsed.data?.version ?? requestedVersion,
    semver: parsed.data?.semver || null,
    valid_from: valid_from || null,
    checksum: checksumSHA256(raw),
    content,
    html,
    sourcePath: fp,
    varsVersion,
  };

  _docCache.set(cacheKey, {
    fingerprint,
    data: result,
  });

  return result;
}

/**
 * Încarcă mai multe documente simultan (latest)
 */
export function loadMany(types = []) {
  return types.map((t) => loadLegalDoc(t));
}

/**
 * Helper: URL public “pretty” pentru un doc.
 */
export function defaultPublicUrlForType(type) {
  if (type === "tos") return "/termenii-si-conditiile";
  if (type === "privacy") return "/confidentialitate";
  if (type === "cookies") return "/cookies";
  if (type === "vendor_terms") return "/acord-vanzatori";
  if (type === "shipping_addendum") return "/anexa-expediere";
  if (type === "returns_policy_ack") return "/politica-retur";
  if (type === "products_addendum") return "/anexa-produse";
  return "#";
}

/**
 * Curăță cache-urile - util în scripturi sau la reload manual.
 */
export function clearLegalCache() {
  _manifestCache = null;
  _manifestMtime = 0;
  _varsCache.clear();
  _docCache.clear();
}