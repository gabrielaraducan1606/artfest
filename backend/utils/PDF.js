// utils/pdf.js
import fs from 'fs';
import path from 'path';

export function ensureContractsDir() {
  const root = path.resolve('storage/contracts');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

export async function savePdfBuffer(buf, filenameBase) {
  const dir = ensureContractsDir();
  const safe = filenameBase.replace(/[^a-z0-9-_]/gi, '_');
  const fullPath = path.join(dir, `${safe}.pdf`);

  await fs.promises.writeFile(fullPath, buf);

  // Mapare spre /uploads/*
  // storage/contracts/xyz.pdf -> /uploads/contracts/xyz.pdf
  const rel = path.relative(path.resolve('storage'), fullPath).split(path.sep).join('/');
  const url = `/uploads/${rel}`;
  return { path: fullPath, url };
}
