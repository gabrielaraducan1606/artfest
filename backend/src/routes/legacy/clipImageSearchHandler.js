// backend/src/routes/legacy/clipImageSearchHandler.js
//
// PĂSTRAT pentru o reimplementare viitoare - NU e montat nicăieri.
//
// Fostul handler POST /api/public/products/search-by-image (căutare după
// imagine cu modelul CLIP + tabela public.product_image_embeddings), mutat
// NESCHIMBAT din publicProductRoutes.js la 2026-11-13. Ruta publică răspunde
// acum 410 (vezi publicProductRoutes.js): modelul CLIP ocupă ~650 MB RAM și
// depășește singur instanța Render de 512 MB, iar căutarea vizuală din
// aplicație se face prin Asistentul AI (/api/assistant/products/search-by-image).
//
// Reactivare (doar pe o instanță / serviciu cu memorie suficientă):
//   1. în publicProductRoutes.js:
//        router.post("/products/search-by-image", uploadSearchImage, clipSearchByImageHandler);
//   2. CLIP_MODEL_ENABLED=1 (altfel lib/embeddings.js nu încarcă modelul);
//   3. embedding-urile produselor: src/scripts/backfillImageEmbeddings.js.

import { prisma } from "../../db.js";
import { imageToEmbedding, toPgVectorLiteral } from "../../lib/embeddings.js";

export async function clipSearchByImageHandler(req, res) {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        error: "IMAGE_REQUIRED",
        message: "Te rugăm să încarci o imagine pentru a căuta produse similare.",
      });
    }

    const emb = await imageToEmbedding(file.buffer);

    let allZero = true;
    for (let i = 0; i < emb.length; i++) {
      if (emb[i] !== 0) {
        allZero = false;
        break;
      }
    }

    if (allZero) {
      return res.status(500).json({
        error: "EMBEDDING_FAILED",
        message: "Nu am putut calcula embedding pentru imagine.",
      });
    }

    const pgVec = toPgVectorLiteral(emb);
    const k = 100;

    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT "productId", MIN(embedding <=> CAST($1 AS vector)) AS score
      FROM public.product_image_embeddings
      GROUP BY "productId"
      ORDER BY score ASC
      LIMIT $2
      `,
      pgVec,
      k
    );

    const ids = (rows || []).map((r) => String(r.productId));

    return res.json({
      ids,
      count: ids.length,
      message: ids.length
        ? "Rezultatele sunt ordonate după similaritate vizuală."
        : "Nu am găsit produse similare pentru imaginea trimisă.",
    });
  } catch (e) {
    console.error("ERROR /api/public/products/search-by-image", e);
    return res.status(500).json({
      error: "IMAGE_SEARCH_ERROR",
      message: "A apărut o eroare la căutarea după imagine.",
    });
  }
}
