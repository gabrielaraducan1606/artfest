// backend/src/routes/customizationQuantityRoutes.js
//
// POST /api/public/customization-quantity/:productId
// Folosită de pagina produsului DOAR când clientul are mai multe fotografii
// decât bucăți și regulile locale nu au putut decide. Corpul cererii e
// ignorat: nu primim fotografii, linkuri sau date ale clientului.
// Răspuns: { kind: "per_photo" | "single_product" | "unclear" }.
//
// Protecție: limită per IP (10 / 10 min), plafon orar de apeluri AI și
// cache per produs în services/customizationQuantityCheck.js. Peste limită
// -> 429; frontend-ul trece atunci la confirmarea simplă a clientului.

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db.js";
import { clientIpKey } from "../middleware/customizationUploadRateLimit.js";
import { createQuantityChecker } from "../services/customizationQuantityCheck.js";

export function createCustomizationQuantityRouter({
  db = prisma,
  checker = createQuantityChecker(),
  limit = Number(process.env.RATE_CUSTOMIZATION_QTY_IP_MAX || 10),
} = {}) {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    // clientIpKey = ipKeyGenerator(ip, 56) - vezi customizationUploadRateLimit.js
    keyGenerator: (req) => `qty:${clientIpKey(req.ip /* ipKeyGenerator */)}`,
    handler: (_req, res) => res.status(429).json({ kind: "unclear", error: "rate_limited" }),
  });

  router.post("/:productId", limiter, async (req, res) => {
    const productId = String(req.params.productId || "").trim();

    if (!productId || productId.length > 64) {
      return res.status(400).json({ kind: "unclear", error: "invalid_product" });
    }

    try {
      const product = await db.product.findFirst({
        where: { id: productId, isActive: true, isHidden: false, moderationStatus: "APPROVED" },
        select: {
          id: true,
          title: true,
          description: true,
          category: true,
          customSchema: true,
          updatedAt: true,
        },
      });

      if (!product) {
        return res.status(404).json({ kind: "unclear", error: "product_not_found" });
      }

      const { kind } = await checker.classify(product);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ kind });
    } catch (err) {
      console.warn("[customization-qty] eroare:", err?.message || err);
      return res.json({ kind: "unclear" });
    }
  });

  return router;
}

export default createCustomizationQuantityRouter();
