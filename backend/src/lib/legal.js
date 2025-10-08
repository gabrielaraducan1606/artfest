// backend/src/lib/legal.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";
import { marked } from "marked";
import { fileURLToPath } from "url";

// __dirname safe pentru ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// urcă din src/lib/ până la rădăcina backend, apoi intră în /legal
const LEGAL_DIR = path.resolve(__dirname, "../../legal");

// Harta fișierelor markdown
const MAP = {
  // public
  tos: "termenii-si-conditiile.md",
  privacy: "politica-de-confidentialitate.md",

  // vendor specific
  vendor_terms: "acord-vanzatori.md",
  shipping_addendum: "anexa-expediere.md",
  returns: "politica-retur.md", // opțional
};

// Hash util pentru a detecta modificări (audit)
function checksumSHA256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * Încarcă un fișier legal (Markdown + frontmatter YAML)
 */
export function loadLegalDoc(type) {
  const file = MAP[type];
  if (!file) throw new Error("Tip necunoscut: " + type);

  const fp = path.join(LEGAL_DIR, file);
  if (!fs.existsSync(fp)) {
    throw new Error(`Fișier lipsă pentru ${type}: ${fp}`);
  }

  const raw = fs.readFileSync(fp, "utf8");
  const parsed = matter(raw);
  const html = marked.parse(`# ${parsed.data?.title || ""}\n\n${parsed.content}`);

  return {
    type,
    title: parsed.data?.title || "",
    version: parsed.data?.version || "1.0.0",
    valid_from: parsed.data?.valid_from || "",
    checksum: checksumSHA256(raw),
    html,
  };
}

/**
 * Încarcă mai multe documente simultan
 */
export function loadMany(types) {
  return types.map((t) => loadLegalDoc(t));
}
