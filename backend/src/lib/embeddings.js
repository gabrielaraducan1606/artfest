import sharp from "sharp";
import { pipeline } from "@xenova/transformers";

let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", "Xenova/clip-vit-base-patch32");
  }
  return extractorPromise;
}

// întoarce Float32Array(512) normalizat L2
export async function imageToEmbedding(buffer) {
  const jpeg = await sharp(buffer).resize(224, 224, { fit: "cover" }).jpeg().toBuffer();
  const extractor = await getExtractor();
  const out = await extractor(jpeg, { pooling: "mean", normalize: true });
  const arr = out.data; // Float32Array
  // asigură normă 1
  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < arr.length; i++) arr[i] = arr[i] / norm;
  return arr;
}

// helper pt. pgvector (param prin CAST($1 AS vector))
export function toPgVectorLiteral(floatArray) {
  return `[${Array.from(floatArray).join(",")}]`;
}
