// backend/utils/pdf.js
/* eslint-env node */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// <repo>/backend
const BACKEND_ROOT = path.resolve(__dirname, "..");

// Toate PDF-urile merg în <repo>/backend/storage/contracts
const STORAGE_DIR = path.join(BACKEND_ROOT, "storage");
const CONTRACTS_DIR = path.join(STORAGE_DIR, "contracts");

/**
 * Salvează un buffer PDF pe disc și întoarce calea + URL-ul public.
 * @param {Buffer|Uint8Array} bytes - conținutul PDF-ului
 * @param {string} baseName - nume bază fără extensie (ex: "contract-123")
 * @returns {{path: string, url: string}}
 */
export async function savePdfBuffer(bytes, baseName) {
  // Asigură directoarele
  if (!fsSync.existsSync(CONTRACTS_DIR)) {
    await fs.mkdir(CONTRACTS_DIR, { recursive: true });
  }

  const safeBase = String(baseName).replace(/[^\w.-]+/g, "_");
  const filename = `${safeBase}.pdf`;
  const absPath = path.join(CONTRACTS_DIR, filename);

  // Scrie PDF-ul pe disc
  await fs.writeFile(absPath, bytes);

  // URL-ul public servit de server din /storage
  const url = `/storage/contracts/${filename}`;

  // (debug) vezi exact unde s-a salvat și ce URL ai
  console.log("[pdf] write:", absPath);
  console.log("[pdf] url  :", url);

  return { path: absPath, url };
}