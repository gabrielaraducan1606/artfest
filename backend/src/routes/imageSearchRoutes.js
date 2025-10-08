import { Router } from "express";
import multer from "multer";
import { PrismaClient, Prisma } from "@prisma/client";
import { imageToEmbedding, toPgVectorLiteral } from "../lib/embeddings.js";

const prisma = new PrismaClient();
const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith("image/")) return cb(new Error("invalid_image_type"));
    cb(null, true);
  },
});

// POST /api/search/image
router.post("/search/image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "no_image", message: "Atașează o imagine." });
    }

    // 1) calculează embedding
    const emb = await imageToEmbedding(req.file.buffer);
    const pgVec = toPgVectorLiteral(emb); // '[0.1,0.2,...]'

    // 2) caută cele mai similare produse (cosine distance)
    //    folosim $queryRaw deoarece Prisma nu are operatori pgvector
    const k = 100;
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT product_id, (embedding <=> CAST($1 AS vector)) AS score
      FROM product_image_embeddings
      ORDER BY embedding <=> CAST($1 AS vector)
      LIMIT $2
      `,
      pgVec,
      k
    );

    const items = rows.map(r => ({ id: String(r.product_id), score: Number(r.score) }));
    const searchId = `img_${Date.now()}`;

    return res.json({ searchId, items });
  } catch (err) {
    console.error("image search error:", err);
    if (err?.message === "invalid_image_type") {
      return res.status(400).json({ error: "invalid_image_type", message: "Fișierul trebuie să fie o imagine." });
    }
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "payload_too_large", message: "Imagine prea mare (max 8MB)." });
    }
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
