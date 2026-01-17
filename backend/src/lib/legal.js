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

// Hash util pentru a detecta modificări (audit)
function checksumSHA256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function readYamlFile(fp) {
  const raw = fs.readFileSync(fp, "utf8");
  return yaml.parse(raw);
}

let _manifestCache = null;
let _manifestMtime = 0;

function loadManifest() {
  const st = fs.statSync(MANIFEST_PATH);
  const mtime = st.mtimeMs;
  if (_manifestCache && _manifestMtime === mtime) return _manifestCache;

  const manifest = readYamlFile(MANIFEST_PATH);
  if (!manifest?.documents || typeof manifest.documents !== "object") {
    throw new Error("manifest_invalid");
  }

  _manifestCache = manifest;
  _manifestMtime = mtime;
  return manifest;
}

let _varsCache = new Map(); // key: varsVersion -> {mtime, data}

function loadVars(varsVersion) {
  const v = Number(varsVersion || 1);
  const fp = path.join(LEGAL_DIR, "vars", `v${v}.yml`);
  if (!fs.existsSync(fp)) {
    throw new Error(`vars_not_found:v${v}`);
  }
  const st = fs.statSync(fp);
  const cached = _varsCache.get(v);
  if (cached && cached.mtime === st.mtimeMs) return cached.data;

  const data = readYamlFile(fp);
  _varsCache.set(v, { mtime: st.mtimeMs, data });
  return data;
}

// Templating super simplu: înlocuiește {{a.b.c}} cu valoarea din vars
function renderTemplate(str, vars) {
  if (!str) return str;
  return String(str).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    const parts = key.split(".");
    let cur = vars;
    for (const p of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, p)) cur = cur[p];
      else return ""; // dacă lipsește, gol
    }
    return cur == null ? "" : String(cur);
  });
}

function resolveDocPath(docRelPath) {
  // docRelPath e relativ față de root (ex: legal/docs/tos/v1.md)
  // îl transformăm în absolut: <backendRoot>/legal/docs/...
  // deoarece LEGAL_DIR e deja <backendRoot>/legal
  // dacă docRelPath începe cu "legal/" îl tăiem
  const rel = docRelPath.startsWith("legal/")
    ? docRelPath.slice("legal/".length)
    : docRelPath;
  return path.join(LEGAL_DIR, rel);
}

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
  if (!doc) throw new Error("unknown_type:" + key);

  const version =
    opts.version != null
      ? Number(opts.version)
      : Number(doc.current);

  const fileMeta = doc.files?.[version];
  if (!fileMeta?.path) {
    throw new Error(`version_not_found:${key}:v${version}`);
  }

  const fp = resolveDocPath(fileMeta.path);
  if (!fs.existsSync(fp)) {
    throw new Error(`file_missing:${key}:v${version}:${fp}`);
  }

  const raw = fs.readFileSync(fp, "utf8");
  const parsed = matter(raw);

  const varsVersion = fileMeta.vars ?? 1;
  const vars = loadVars(varsVersion);

  // Aplicăm templating pe titlu + content
  const title = renderTemplate(parsed.data?.title || doc.title || "", vars);
  const valid_from = renderTemplate(parsed.data?.valid_from || "", vars);

  const content = renderTemplate(parsed.content || "", vars);

  // HTML: punem H1 din title + restul markdown-ului
  const html = marked.parse(`# ${title}\n\n${content}`.trim());

  return {
    type: key,
    key,
    title,
    version: parsed.data?.version ?? version, // dacă în frontmatter e numeric, păstrăm
    semver: parsed.data?.semver || null,
    valid_from,
    checksum: checksumSHA256(raw),
    html,
  };
}

/**
 * Încarcă mai multe documente simultan (latest)
 */
export function loadMany(types) {
  return types.map((t) => loadLegalDoc(t));
}

/**
 * Helper: URL public “pretty” pentru un doc.
 * Dacă vrei, îl poți folosi în meta.
 */
export function defaultPublicUrlForType(type) {
  // slug frumos (păstrăm ce aveai)
  if (type === "tos") return "/termenii-si-conditiile";
  if (type === "privacy") return "/confidentialitate";
  if (type === "vendor_terms") return "/acord-vanzatori";
  if (type === "shipping_addendum") return "/anexa-expediere";
  if (type === "returns_policy_ack") return "/politica-retur";
  if (type === "products_addendum") return "/anexa-produse";
  return "#";
}
