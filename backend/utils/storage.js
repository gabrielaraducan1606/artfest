// utils/storage.js
import path from 'path';
import fs from 'fs';

const API_URL = process.env.API_URL || "http://localhost:5000";
const isProduction = process.env.NODE_ENV === "production";

export async function uploadToStorage(file, key) {
  // Calea locală unde salvăm fișierul (în storage/)
  const storagePath = path.join(process.cwd(), "storage", key);

  // Creăm folderul dacă nu există
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });

  // Scriem fișierul local
  fs.writeFileSync(storagePath, file.buffer);

  // Returnăm URL-ul absolut corect
  return `${API_URL}/uploads/${encodeURIComponent(key)}`;
}
