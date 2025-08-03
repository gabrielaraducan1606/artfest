import path from 'path';
import fs from 'fs';

export async function uploadToStorage(file, key) {
  // Calea locală unde salvăm fișierul (în storage/)
  const storagePath = path.join(process.cwd(), "storage", key);

  // Creăm folderul dacă nu există
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });

  // Scriem fișierul local
  fs.writeFileSync(storagePath, file.buffer);

  // Returnăm URL-ul corect în funcție de mediu
  if (isProduction) {
    // Domeniul real din producție
    return `${API_URL}/uploads/${encodeURIComponent(key)}`;
  } else {
    // Localhost pentru dezvoltare
    return `http://localhost:5000/uploads/${encodeURIComponent(key)}`;
  }
}