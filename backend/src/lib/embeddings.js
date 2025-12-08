// server/lib/embeddings.js
import sharp from "sharp";
import { pipeline } from "@xenova/transformers";

let extractorPromise = null;

// încarcă modelul CLIP o singură dată (singleton)
async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      "Xenova/clip-vit-base-patch32"
    );
  }
  return extractorPromise;
}

// întoarce un Float32Array(512) normalizat L2 (norma = 1)
export async function imageToEmbedding(buffer) {
  // redimensionăm și convertim în JPEG (224x224 CLIP style)
  const jpeg = await sharp(buffer)
    .resize(224, 224, { fit: "cover" })
    .jpeg()
    .toBuffer();

  const extractor = await getExtractor();
  const out = await extractor(jpeg, { pooling: "mean", normalize: true });

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
