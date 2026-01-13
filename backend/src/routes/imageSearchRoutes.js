import { Router } from "express";
import { prisma } from "../db.js";
import { uploadSearchImage } from "../middleware/imageSearchUpload.js";
import { imageToEmbedding, toPgVectorLiteral } from "../lib/embeddings.js";

const router = Router();

router.post("/search/image", (req, res) => {
  uploadSearchImage(req, res, async (err) => {
    try {
      if (err) {
        console.error("multer error:", err);

        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            error: "payload_too_large",
            message: `Imagine prea mare (max ${process.env.IMAGE_SEARCH_MAX_MB || 8}MB).`,
          });
        }

        // mesajul tău din fileFilter
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
        return res.status(400).json({ error: "no_image", message: "Atașează o imagine." });
      }

      const emb = await imageToEmbedding(req.file.buffer);

      let allZero = true;
      for (let i = 0; i < emb.length; i++) {
        if (emb[i] !== 0) { allZero = false; break; }
      }
      if (allZero) {
        return res.status(500).json({
          error: "embedding_failed",
          message: "Nu am putut calcula embedding pentru imagine.",
        });
      }

      const pgVec = toPgVectorLiteral(emb);
      const k = 100;

     const rows = await prisma.$queryRaw`
  SELECT product_id, (embedding <=> CAST(${pgVec} AS vector)) AS score
  FROM public.product_image_embeddings
  ORDER BY embedding <=> CAST(${pgVec} AS vector)
  LIMIT ${k}
`;

      const ids = (rows || []).map((r) => String(r.product_id));

      return res.json({
        ids,
        count: ids.length,
        message: ids.length
          ? "Rezultatele sunt ordonate după similaritate vizuală."
          : "Nu am găsit produse similare pentru imaginea trimisă.",
      });
    } catch (e) {
      console.error("image search error:", e);
      return res.status(500).json({ error: "server_error", message: "Eroare internă." });
    }
  });
});

export default router;
