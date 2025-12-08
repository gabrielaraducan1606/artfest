// src/controllers/publicProductsController.js
import { prisma } from "../lib/prisma.js";

/**
 * POST /api/public/products/search-by-image
 *
 * Acceptă un fișier "image" (multipart/form-data).
 * Deocamdată nu face similaritate reală – doar returnează produse active/populare.
 * Ulterior poți înlocui partea de "fallback" cu apel la un model de vector search.
 */
export async function searchProductsByImage(req, res) {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        error: "IMAGE_REQUIRED",
        message:
          "Te rugăm să încarci o imagine pentru a căuta produse similare.",
      });
    }

    // 🔹 Dacă vrei doar să verifici că tot flow-ul funcționează:
    // console.log("Image uploaded:", {
    //   originalname: file.originalname,
    //   mimetype: file.mimetype,
    //   size: file.size,
    // });

    /**
     * TODO: aici poți integra:
     *  - upload în storage (S3, Cloudinary etc.)
     *  - trimiterea imaginii către un serviciu de "visual similarity"
     *  - obținerea unui vector / listă de productId-uri similare
     *
     * Exemplu pseudo:
     *
     *   const { embedding } = await someVisionApi(file.buffer);
     *   const similar = await prisma.$queryRaw`
     *     SELECT id FROM "Product"
     *     ORDER BY embedding <-> ${embedding}
     *     LIMIT 48
     *   `;
     *   const ids = similar.map((row) => row.id);
     */

    // 🔹 Fallback simplu: luăm produse active & vizibile, sortate după popularityScore
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        isHidden: false,
      },
      orderBy: [
        { popularityScore: "desc" },
        { createdAt: "desc" },
      ],
      select: { id: true },
      take: 48,
    });

    const ids = products.map((p) => p.id);

    if (!ids.length) {
      return res.status(200).json({
        ids: [],
        message:
          "Momentan nu am găsit produse similare imaginii trimise. Te rugăm să încerci altă imagine sau să folosești căutarea după text.",
      });
    }

    // 🔹 Formatul suportat de hook-ul tău useImageSearch:
    return res.status(200).json({ ids });
  } catch (err) {
    console.error("searchProductsByImage error:", err);
    return res.status(500).json({
      error: "INTERNAL_ERROR",
      message:
        "A apărut o eroare la căutarea după imagine. Te rugăm să încerci din nou.",
    });
  }
}
