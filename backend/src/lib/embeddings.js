import sharp from "sharp";
import { pipeline, RawImage } from "@huggingface/transformers";
import { Blob } from "buffer";

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

function zeroEmbedding() {
  return new Float32Array(512).fill(0);
}

export async function imageToEmbedding(buffer) {
  let jpeg;

  try {
    jpeg = await sharp(buffer, { failOnError: false })
      .rotate()
      .resize(224, 224, {
        fit: "cover",
        position: "centre",
      })
      .removeAlpha()
      .toColourspace("srgb")
      .jpeg({
        quality: 70,
        mozjpeg: true,
      })
      .toBuffer();
  } catch (err) {
    console.error("sharp error:", err);
    return zeroEmbedding();
  }

  let extractor;
  try {
    extractor = await getExtractor();
  } catch (err) {
    console.error("pipeline load error:", err);
    return zeroEmbedding();
  }

  try {
    const blob = new Blob([jpeg], { type: "image/jpeg" });
    const img = await RawImage.read(blob);

    const out = await extractor(img, {
      pooling: "mean",
      normalize: true,
    });

    const arr = out?.data;
    if (!arr || !arr.length) {
      console.error("CLIP extract error: empty embedding");
      return zeroEmbedding();
    }

    let norm = 0;
    for (let i = 0; i < arr.length; i++) {
      norm += arr[i] * arr[i];
    }

    norm = Math.sqrt(norm) || 1;

    for (let i = 0; i < arr.length; i++) {
      arr[i] /= norm;
    }

    return arr;
  } catch (err) {
    console.error("CLIP extract error:", err);
    return zeroEmbedding();
  }
}

export function isAllZeroEmbedding(arr) {
  if (!arr?.length) return true;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== 0) return false;
  }
  return true;
}

export function toPgVectorLiteral(floatArray) {
  return `[${Array.from(floatArray).join(",")}]`;
}