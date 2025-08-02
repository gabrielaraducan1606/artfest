// src/utils/storage.js
export async function uploadToStorage(file, key) {
  // file.buffer, file.mimetype, file.originalname
  // TODO: înlocuiește cu upload real S3/Cloudinary; key -> cale unică
  return `https://files.example.com/${encodeURIComponent(key)}`;
}
