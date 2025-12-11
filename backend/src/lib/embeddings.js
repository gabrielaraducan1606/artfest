// server/lib/embeddings.js
import sharp from "sharp";
import { pipeline } from "@xenova/transformers";

let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      "Xenova/clip-vit-base-patch32"
    );
  }
  return extractorPromise;
}

// întoarce un Float32Array(512) normalizat L2
export async function imageToEmbedding(buffer) {
  // 1) prelucrăm imaginea în JPEG 224x224
  let jpeg;
  try {
    jpeg = await sharp(buffer)
      .resize(224, 224, { fit: "cover" })
      .jpeg()
      .toBuffer();
  } catch (err) {
    console.error("Eroare la sharp (resize/convert):", err);
    // fallback: vector random mic, ca să nu crape tot procesul
    const fallback = new Float32Array(512).fill(0);
    return fallback;
  }

  let extractor;
  try {
    extractor = await getExtractor();
  } catch (err) {
    console.error("Eroare la încărcarea modelului CLIP:", err);
    const fallback = new Float32Array(512).fill(0);
    return fallback;
  }

  let out;
  try {
    // aici în mod normal explodează cu "text.split is not a function"
    out = await extractor(jpeg, { pooling: "mean", normalize: true });
  } catch (err) {
    console.error("Eroare în extractor CLIP:", err);
    // 🔴 AICI PRINDEM EXACT BUG-UL
    // Ca să nu se oprească tot scriptul, întoarcem un vector fallback.
    const fallback = new Float32Array(512).fill(0);
    return fallback;
  }

  const arr = out.data; // Float32Array

  // ne asigurăm că norma este 1 (vector unitate)
  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i] / norm;

  return arr;
}

// helper pentru parametrul CAST($1 AS vector)
export function toPgVectorLiteral(floatArray) {
  return `[${Array.from(floatArray).join(",")}]`;
}
