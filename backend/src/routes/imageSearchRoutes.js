import { Router } from "express";
import { prisma } from "../db.js";
import { uploadSearchImage } from "../middleware/imageSearchUpload.js";
import {
  imageToEmbedding,
  isAllZeroEmbedding,
  toPgVectorLiteral,
} from "../lib/embeddings.js";

const router = Router();

const IMAGE_SEARCH_K = Number(process.env.IMAGE_SEARCH_K || 36);

router.post("/search/image", (req, res) => {
  uploadSearchImage(req, res, async (err) => {
    const startedAt = Date.now();

    try {
      if (err) {
        console.error("multer error:", err);

        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            error: "payload_too_large",
            message: `Imagine prea mare (max ${
              process.env.IMAGE_SEARCH_MAX_MB || 4
            }MB).`,
          });
        }

        if (
          typeof err.message === "string" &&
          err.message.toLowerCase().includes("tip de fișier neacceptat")
        ) {
          return res.status(400).json({
            error: "invalid_image_type",
            message: err.message,
          });
        }

        return res.status(400).json({
          error: "upload_failed",
          message: err.message || "Upload eșuat.",
        });
      }

      if (!req.file?.buffer) {
        return res.status(400).json({
          error: "no_image",
          message: "Atașează o imagine.",
        });
      }

      const t0 = Date.now();
      const emb = await imageToEmbedding(req.file.buffer);
      const t1 = Date.now();

      if (isAllZeroEmbedding(emb)) {
        return res.status(500).json({
          error: "embedding_failed",
          message: "Nu am putut calcula embedding pentru imagine.",
        });
      }

      const pgVec = toPgVectorLiteral(emb);

      const rows = await prisma.$queryRaw`
        SELECT "productId", MIN(embedding <=> CAST(${pgVec} AS vector)) AS score
        FROM public.product_image_embeddings
        GROUP BY "productId"
        ORDER BY score ASC
        LIMIT ${IMAGE_SEARCH_K}
      `;

      const t2 = Date.now();

      const ids = (rows || []).map((r) => String(r.productId));

      console.log("image search timing", {
        uploadBytes: req.file.size,
        embeddingMs: t1 - t0,
        queryMs: t2 - t1,
        totalMs: t2 - startedAt,
        results: ids.length,
        k: IMAGE_SEARCH_K,
      });

      return res.json({
        ids,
        count: ids.length,
        message: ids.length
          ? "Rezultatele sunt ordonate după similaritate vizuală."
          : "Nu am găsit produse similare pentru imaginea trimisă.",
        meta: {
          tookMs: t2 - startedAt,
          embeddingMs: t1 - t0,
          queryMs: t2 - t1,
          k: IMAGE_SEARCH_K,
        },
      });
    } catch (e) {
      console.error("image search error:", e);

      return res.status(500).json({
        error: "server_error",
        message: "Eroare internă.",
      });
    }
  });
});

export default router;