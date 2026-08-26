// backend/src/routes/vendorCostProfitRoutes.js

/*
 * Consolidează în același fișier: cost-items CRUD, product
 * costing (GET/PUT/confirm/recalculate/apply-recommended-price),
 * profitabilitate și recalculare batch - toate rutele REST
 * "clasice" (nu conversaționale) ale modulului Costuri & Profit.
 * Fost în 3 fișiere separate (vendorCostItemsRoutes.js,
 * vendorProductCostingRoutes.js, vendorProductProfitabilityRoutes.js),
 * consolidate ca parte a refactorului de organizare a rutelor -
 * NICIUN URL public, contract de request/response sau logică de
 * business nu s-a schimbat.
 *
 * IMPORTANT: acest fișier trebuie montat ÎNAINTE de
 * vendorProductRoutes (vezi server.js) - GET /products/:id de
 * acolo ar "înghiți" /products/profitability dacă ar fi
 * înregistrat primul (Express potrivește rutele în ordinea
 * înregistrării, iar :id se potrivește cu orice segment).
 */

import { Router } from "express";

import { authRequired } from "../api/auth.js";
import { prisma } from "../db.js";

import {
  resolveVendorByUserId,
  resolveOwnedProduct,
  saveProductCosting,
  recalculateProductCosting,
  confirmProductCosting,
  applyRecommendedPrice,
  recalculateProductsBatch,
  formatCosting,
  CostingValidationError,
  getProductProfitability,
  PROFITABILITY_FILTERS,
  PROFITABILITY_SORT_FIELDS,
  formatCostItem,
} from "../services/costProfitService.js";

const router = Router();

/* ======================================================
   ===================== Cost items ======================
====================================================== */

const COST_ITEM_TYPES = new Set([
  "MATERIAL",
  "PACKAGING",
  "OTHER",
]);

/**
 * Rezolvă vendorul curent STRICT din req.user.sub (JWT).
 * Nu se acceptă niciodată un vendorId trimis de client.
 */
async function resolveVendor(req) {
  return prisma.vendor.findUnique({
    where: {
      userId: req.user.sub,
    },

    select: {
      id: true,
    },
  });
}

function sanitizeName(value) {
  return String(value || "")
    .trim()
    .slice(0, 160);
}

function sanitizeUnit(value) {
  return String(value || "")
    .trim()
    .slice(0, 40);
}

function sanitizeNotes(value) {
  return String(value || "")
    .trim()
    .slice(0, 2000);
}

/**
 * Costul e trimis de client deja convertit în cenți (Int).
 * Aici doar validăm - conversia lei -> cenți se face în UI.
 */
function parseUnitCostCents(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  const rounded = Math.round(numeric);

  if (rounded < 0) {
    return null;
  }

  return rounded;
}

/* ======================================================
   GET /api/vendor/cost-items

   Filtre: type, q, isActive (true | false | all).
   Implicit: doar costurile active.
====================================================== */

router.get(
  "/cost-items",
  authRequired,
  async (req, res) => {
    try {
      const vendor = await resolveVendor(req);

      if (!vendor) {
        return res.status(403).json({
          error: "vendor_not_found",
        });
      }

      const where = {
        vendorId: vendor.id,
      };

      if (req.query.type !== undefined) {
        const type = String(req.query.type || "")
          .trim()
          .toUpperCase();

        if (!COST_ITEM_TYPES.has(type)) {
          return res.status(400).json({
            error: "invalid_type",

            message:
              "Tip invalid. Valori acceptate: MATERIAL, PACKAGING, OTHER.",
          });
        }

        where.type = type;
      }

      const rawIsActive = req.query.isActive;

      if (rawIsActive === undefined || rawIsActive === "true") {
        where.isActive = true;
      } else if (rawIsActive === "false") {
        where.isActive = false;
      } else if (rawIsActive === "all") {
        // fără filtru pe isActive
      } else {
        return res.status(400).json({
          error: "invalid_is_active",

          message:
            "Valoare invalidă pentru isActive. Folosește true, false sau all.",
        });
      }

      const q = String(req.query.q || "")
        .trim()
        .slice(0, 160);

      if (q) {
        where.name = {
          contains: q,
          mode: "insensitive",
        };
      }

      const items = await prisma.vendorCostItem.findMany({
        where,

        orderBy: [
          { type: "asc" },
          { name: "asc" },
        ],
      });

      return res.json({
        items: items.map(formatCostItem),
      });
    } catch (err) {
      console.error(
        "GET /api/vendor/cost-items error:",
        err
      );

      return res.status(500).json({
        error: "server_error",
      });
    }
  }
);

/* ======================================================
   POST /api/vendor/cost-items
====================================================== */

router.post(
  "/cost-items",
  authRequired,
  async (req, res) => {
    try {
      const vendor = await resolveVendor(req);

      if (!vendor) {
        return res.status(403).json({
          error: "vendor_not_found",
        });
      }

      const type = String(req.body?.type || "")
        .trim()
        .toUpperCase();

      if (!COST_ITEM_TYPES.has(type)) {
        return res.status(400).json({
          error: "invalid_type",

          message:
            "Alege un tip valid: material, ambalaj sau alt cost.",
        });
      }

      const name = sanitizeName(req.body?.name);

      if (!name) {
        return res.status(400).json({
          error: "name_required",

          message: "Numele este obligatoriu.",
        });
      }

      const unitCostCents = parseUnitCostCents(
        req.body?.unitCostCents
      );

      if (unitCostCents === null) {
        return res.status(400).json({
          error: "invalid_unit_cost",

          message:
            "Costul unitar trebuie să fie un număr valid, mai mare sau egal cu 0.",
        });
      }

      const unit = sanitizeUnit(req.body?.unit);
      const notes = sanitizeNotes(req.body?.notes);

      /*
       * currency e mereu "RON" în această etapă.
       * source e mereu "MANUAL" - UI-ul nu poate crea
       * costuri AI_SUGGESTED direct.
       */
      const item = await prisma.vendorCostItem.create({
        data: {
          vendorId: vendor.id,

          type,
          name,
          unit: unit || null,
          unitCostCents,
          currency: "RON",
          notes: notes || null,
          source: "MANUAL",
        },
      });

      return res.status(201).json(
        formatCostItem(item)
      );
    } catch (err) {
      console.error(
        "POST /api/vendor/cost-items error:",
        err
      );

      return res.status(500).json({
        error: "server_error",
      });
    }
  }
);

/* ======================================================
   PATCH /api/vendor/cost-items/:id
====================================================== */

router.patch(
  "/cost-items/:id",
  authRequired,
  async (req, res) => {
    try {
      const vendor = await resolveVendor(req);

      if (!vendor) {
        return res.status(403).json({
          error: "vendor_not_found",
        });
      }

      const id = String(req.params.id || "");

      const existing =
        await prisma.vendorCostItem.findUnique({
          where: { id },
        });

      /*
       * Nu dezvăluim dacă id-ul există la alt vendor -
       * răspundem identic (404) pentru inexistent
       * sau neautorizat.
       */
      if (!existing || existing.vendorId !== vendor.id) {
        return res.status(404).json({
          error: "not_found",
        });
      }

      const data = {};

      if (req.body?.type !== undefined) {
        const type = String(req.body.type || "")
          .trim()
          .toUpperCase();

        if (!COST_ITEM_TYPES.has(type)) {
          return res.status(400).json({
            error: "invalid_type",
          });
        }

        data.type = type;
      }

      if (req.body?.name !== undefined) {
        const name = sanitizeName(req.body.name);

        if (!name) {
          return res.status(400).json({
            error: "name_required",
          });
        }

        data.name = name;
      }

      if (req.body?.unit !== undefined) {
        data.unit = sanitizeUnit(req.body.unit) || null;
      }

      if (req.body?.unitCostCents !== undefined) {
        const unitCostCents = parseUnitCostCents(
          req.body.unitCostCents
        );

        if (unitCostCents === null) {
          return res.status(400).json({
            error: "invalid_unit_cost",

            message:
              "Costul unitar trebuie să fie un număr valid, mai mare sau egal cu 0.",
          });
        }

        data.unitCostCents = unitCostCents;
      }

      if (req.body?.notes !== undefined) {
        data.notes = sanitizeNotes(req.body.notes) || null;
      }

      if (req.body?.isActive !== undefined) {
        data.isActive = Boolean(req.body.isActive);
      }

      if (!Object.keys(data).length) {
        return res.status(400).json({
          error: "no_changes",
        });
      }

      const unitCostChanged =
        data.unitCostCents !== undefined &&
        data.unitCostCents !==
          existing.unitCostCents;

      const updated = await prisma.vendorCostItem.update({
        where: { id },
        data,
      });

      /*
       * Costul s-a schimbat -> orice costing salvat care
       * folosește acest item nu mai reflectă prețul curent
       * din bibliotecă. Îl marcăm needsRecalculation, ca
       * vendorul să vadă badge-ul și să poată recalcula
       * explicit (nu se recalculează nimic automat aici).
       */
      if (unitCostChanged) {
        await prisma.productCosting.updateMany({
          where: {
            items: {
              some: {
                costItemId: id,
              },
            },
          },

          data: {
            needsRecalculation: true,
          },
        });
      }

      return res.json(
        formatCostItem(updated)
      );
    } catch (err) {
      console.error(
        "PATCH /api/vendor/cost-items/:id error:",
        err
      );

      return res.status(500).json({
        error: "server_error",
      });
    }
  }
);

/* ======================================================
   DELETE /api/vendor/cost-items/:id

   Soft-delete: isActive = false. Nu se șterge nimic
   fizic, ca să nu rupem ProductCostingItem-uri care
   ar putea referenția deja acest cost.
====================================================== */

router.delete(
  "/cost-items/:id",
  authRequired,
  async (req, res) => {
    try {
      const vendor = await resolveVendor(req);

      if (!vendor) {
        return res.status(403).json({
          error: "vendor_not_found",
        });
      }

      const id = String(req.params.id || "");

      const existing =
        await prisma.vendorCostItem.findUnique({
          where: { id },
        });

      if (!existing || existing.vendorId !== vendor.id) {
        return res.status(404).json({
          error: "not_found",
        });
      }

      const updated = await prisma.vendorCostItem.update({
        where: { id },

        data: {
          isActive: false,
        },
      });

      return res.json(
        formatCostItem(updated)
      );
    } catch (err) {
      console.error(
        "DELETE /api/vendor/cost-items/:id error:",
        err
      );

      return res.status(500).json({
        error: "server_error",
      });
    }
  }
);

/* ======================================================
   =================== Product costing ====================
====================================================== */

/* ======================================================
   Helper comun: rezolvă vendor + produs deținut.

   Scrie direct pe `res` și întoarce null dacă a eșuat,
   ca handler-ul apelant să poată face doar `return`.
====================================================== */

async function requireOwnedProduct(req, res) {
  const vendor = await resolveVendorByUserId(
    req.user.sub
  );

  if (!vendor) {
    res.status(403).json({
      error: "vendor_not_found",
    });

    return null;
  }

  const product = await resolveOwnedProduct(
    req.params.productId,
    vendor.id
  );

  if (!product) {
    res.status(404).json({
      error: "product_not_found",
    });

    return null;
  }

  return { vendor, product };
}

function handleServiceError(res, err, logLabel) {
  if (err instanceof CostingValidationError) {
    return res.status(400).json({
      error: err.code,
      message: err.message,
    });
  }

  console.error(logLabel, err);

  return res.status(500).json({
    error: "server_error",
  });
}

/* ======================================================
   GET /api/vendor/products/:productId/costing
====================================================== */

router.get(
  "/products/:productId/costing",
  authRequired,
  async (req, res) => {
    try {
      const ctx = await requireOwnedProduct(req, res);
      if (!ctx) return;

      const costing = await prisma.productCosting.findUnique({
        where: {
          productId: ctx.product.id,
        },

        include: {
          items: true,
        },
      });

      return res.json({
        costing: formatCosting(costing),
      });
    } catch (err) {
      return handleServiceError(
        res,
        err,
        "GET .../costing error:"
      );
    }
  }
);

/* ======================================================
   PUT /api/vendor/products/:productId/costing

   Creează sau înlocuiește costing-ul (items + parametri).
   Body: { costDraft: {...} } - aceeași formă folosită de
   calculatorul conversațional (materials, packagingCost,
   otherCosts, laborHours, hourlyRate, desiredProfit),
   extinsă opțional cu costItemId pe fiecare linie.
====================================================== */

router.put(
  "/products/:productId/costing",
  authRequired,
  async (req, res) => {
    try {
      const ctx = await requireOwnedProduct(req, res);
      if (!ctx) return;

      const costing = await saveProductCosting({
        productId: ctx.product.id,
        vendorId: ctx.vendor.id,
        rawCostDraft: req.body?.costDraft,
      });

      return res.json({
        costing: formatCosting(costing),
      });
    } catch (err) {
      return handleServiceError(
        res,
        err,
        "PUT .../costing error:"
      );
    }
  }
);

/* ======================================================
   POST /api/vendor/products/:productId/costing/confirm
====================================================== */

router.post(
  "/products/:productId/costing/confirm",
  authRequired,
  async (req, res) => {
    try {
      const ctx = await requireOwnedProduct(req, res);
      if (!ctx) return;

      const costing = await confirmProductCosting({
        productId: ctx.product.id,
      });

      return res.json({
        costing: formatCosting(costing),
      });
    } catch (err) {
      return handleServiceError(
        res,
        err,
        "POST .../costing/confirm error:"
      );
    }
  }
);

/* ======================================================
   POST /api/vendor/products/:productId/costing/recalculate

   Rulează din nou calculul determinist pe liniile deja
   salvate (util, de exemplu, dacă vendorul își schimbă
   planul de abonament și comisionul se schimbă). Nu modifică
   liniile de cost și nu atinge Product.priceCents.
====================================================== */

router.post(
  "/products/:productId/costing/recalculate",
  authRequired,
  async (req, res) => {
    try {
      const ctx = await requireOwnedProduct(req, res);
      if (!ctx) return;

      const costing = await recalculateProductCosting({
        productId: ctx.product.id,
        vendorId: ctx.vendor.id,
      });

      return res.json({
        costing: formatCosting(costing),
      });
    } catch (err) {
      return handleServiceError(
        res,
        err,
        "POST .../costing/recalculate error:"
      );
    }
  }
);

/* ======================================================
   POST /api/vendor/products/:productId/costing/apply-recommended-price

   SINGURA rută din tot modulul care modifică
   Product.priceCents. Modificare publică (afectează ce vede
   clientul) - cere confirmare explicită la nivel de request.

   Body opțional: { acknowledgeStaleData: boolean } - necesar
   dacă costing-ul nu e CONFIRMED sau are needsRecalculation;
   altfel respinge cu 409, ca vendorul să nu aplice un preț
   calculat din date posibil învechite fără să știe.
====================================================== */

router.post(
  "/products/:productId/costing/apply-recommended-price",
  authRequired,
  async (req, res) => {
    try {
      const ctx = await requireOwnedProduct(req, res);
      if (!ctx) return;

      const acknowledgeStaleData = Boolean(
        req.body?.acknowledgeStaleData
      );

      const result = await applyRecommendedPrice({
        productId: ctx.product.id,
        acknowledgeStaleData,
      });

      return res.json(result);
    } catch (err) {
      if (
        err instanceof CostingValidationError &&
        err.code === "requires_acknowledgement"
      ) {
        return res.status(409).json({
          error: err.code,
          message: err.message,
        });
      }

      return handleServiceError(
        res,
        err,
        "POST .../costing/apply-recommended-price error:"
      );
    }
  }
);

/* ======================================================
   POST /api/vendor/products/costing/recalculate-batch

   Recalculare determinist pentru mai multe produse deodată
   (ex: toate produsele care folosesc un anumit cost din
   bibliotecă, sau toate cele cu needsRecalculation). Fiecare
   productId e verificat individual că aparține vendorului
   curent - reutilizează recalculateProductCosting() per
   produs, nu reimplementează nimic. Nu atinge Product.priceCents.

   Body: { productIds: string[] }
====================================================== */

router.post(
  "/products/costing/recalculate-batch",
  authRequired,
  async (req, res) => {
    try {
      const vendor = await resolveVendorByUserId(
        req.user.sub
      );

      if (!vendor) {
        return res.status(403).json({
          error: "vendor_not_found",
        });
      }

      const productIds = Array.isArray(
        req.body?.productIds
      )
        ? req.body.productIds
            .map((id) => String(id || "").trim())
            .filter(Boolean)
            .slice(0, 100)
        : [];

      if (!productIds.length) {
        return res.status(400).json({
          error: "missing_product_ids",

          message:
            "Trimite cel puțin un productId.",
        });
      }

      const results =
        await recalculateProductsBatch({
          productIds,
          vendorId: vendor.id,
        });

      return res.json({ results });
    } catch (err) {
      return handleServiceError(
        res,
        err,
        "POST .../costing/recalculate-batch error:"
      );
    }
  }
);

/* ======================================================
   ===================== Profitabilitate ===================
====================================================== */

/* ======================================================
   GET /api/vendor/products/profitability

   Logica de filtrare/sortare/paginare trăiește în
   costProfitService.js - reutilizată și de
   comenzile conversaționale de administrare costuri.
====================================================== */

router.get(
  "/products/profitability",
  authRequired,
  async (req, res) => {
    try {
      const vendor = await resolveVendorByUserId(
        req.user.sub
      );

      if (!vendor) {
        return res.status(403).json({
          error: "vendor_not_found",
        });
      }

      const rawFilter = String(
        req.query.filter || ""
      ).trim();

      if (
        rawFilter &&
        !PROFITABILITY_FILTERS.has(rawFilter)
      ) {
        return res.status(400).json({
          error: "invalid_filter",

          message:
            "Filtru invalid. Valori acceptate: no_costing, draft, confirmed, needs_recalculation, below_min_price.",
        });
      }

      const sortBy = String(
        req.query.sortBy || "name"
      ).trim();

      if (
        !PROFITABILITY_SORT_FIELDS.has(sortBy)
      ) {
        return res.status(400).json({
          error: "invalid_sort_by",

          message:
            "Sortare invalidă. Valori acceptate: name, totalRealCost, profit, recommendedPrice, lastRecalculated.",
        });
      }

      const sortDir =
        req.query.sortDir === "desc"
          ? "desc"
          : "asc";

      const page = Math.max(
        1,
        parseInt(req.query.page, 10) || 1
      );

      const pageSize = Math.min(
        100,
        Math.max(
          1,
          parseInt(req.query.pageSize, 10) || 20
        )
      );

      const result = await getProductProfitability(
        {
          vendorId: vendor.id,
          filter: rawFilter,
          sortBy,
          sortDir,
          page,
          pageSize,
        }
      );

      return res.json(result);
    } catch (err) {
      console.error(
        "GET /api/vendor/products/profitability error:",
        err
      );

      return res.status(500).json({
        error: "server_error",
      });
    }
  }
);

export default router;
