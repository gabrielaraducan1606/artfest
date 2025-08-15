// backend/utils/storage.js
import path from "path";
import fs from "fs";

/**
 * Salvează fișierul în ./uploads/<key> și întoarce calea relativă
 * care este servită la GET /uploads/* de Express.
 */
export async function uploadToStorage(file, key) {
  // normalizează key: fără slash la început, separatori POSIX
  let cleanKey = String(key).replace(/^\/+/, "").replace(/\\/g, "/");

  const diskPath = path.join(process.cwd(), "uploads", cleanKey);
  fs.mkdirSync(path.dirname(diskPath), { recursive: true });
  fs.writeFileSync(diskPath, file.buffer);

  // IMPORTANT: întoarcem cale relativă, NE-ENCODATĂ
  return `uploads/${cleanKey}`;
}
