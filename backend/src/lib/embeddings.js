import sharp from "sharp";
import { pipeline, RawImage } from "@huggingface/transformers";
import { Blob } from "buffer"; // sigur în Node; în Node 18+ ar merge și fără

let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "image-feature-extraction",
      "Xenova/clip-vit-base-patch32"
    );
  }
  return extractorPromise;
}

export async function imageToEmbedding(buffer) {
  let jpeg;

  try {
    jpeg = await sharp(buffer, { failOnError: false })
      .rotate()
      .resize(224, 224, { fit: "cover" })
      .removeAlpha()
      .toColourspace("srgb")
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (err) {
    console.error("sharp error:", err);
    return new Float32Array(512).fill(0);
  }

  let extractor;
  try {
    extractor = await getExtractor();
  } catch (err) {
    console.error("pipeline load error:", err);
    return new Float32Array(512).fill(0);
  }

  try {
    // ✅ Buffer -> Blob (RawImage.read acceptă Blob)
    const blob = new Blob([jpeg], { type: "image/jpeg" });
    const img = await RawImage.read(blob);

    const out = await extractor(img, { pooling: "mean", normalize: true });
    const arr = out.data;

    // extra L2 normalize
    let norm = 0;
    for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < arr.length; i++) arr[i] /= norm;

    return arr;
  } catch (err) {
    console.error("CLIP extract error:", err);
    return new Float32Array(512).fill(0);
  }
}

export function toPgVectorLiteral(floatArray) {
  return `[${Array.from(floatArray).join(",")}]`;
}
