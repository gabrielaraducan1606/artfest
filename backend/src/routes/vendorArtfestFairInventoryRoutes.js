// backend/src/routes/vendorArtfestFairInventoryRoutes.js
//
// Inventarul vendorului pentru Târgul Artfest. Montat pe /api/vendor/fair/inventory:
//   GET    /                 liniile vendorului + stările de rezervare / etichetă
//   GET    /products         produsele eligibile (cu opțiunile de variantă)
//   POST   /                 linie nouă (DRAFT)
//   PATCH  /:id              editare linie DRAFT
//   DELETE /:id              eliminare linie DRAFT (rămâne în istoric ca CANCELLED)
//   POST   /:id/sync-price   preia prețul curent din Artfest (înainte de termen)
//   POST   /submit           trimite liniile DRAFT + rezervă stocul online
//   POST   /:id/cancel       anulează o linie trimisă, încă nerecepționată (eliberează rezervarea)
//   GET    /labels.pdf       403 - etichetele sunt generate de Artfest (Admin)
//   GET    /:id/label.pdf    403 - idem
//
// Totul e filtrat pe vendorId din sesiune; liniile altui vendor => 404.

import { Router } from "express";
import { authRequired } from "../api/auth.js";
import {
  addInventoryItem,
  getVendorInventoryContext,
  listEligibleProducts,
  listInventory,
  removeInventoryItem,
  submitInventory,
  syncInventoryItemPrice,
  updateInventoryItem,
} from "../services/artfestFairInventoryService.js";
import { cancelSubmittedLine } from "../services/artfestFairReceptionService.js";
import { handleFair, requireVendor } from "./artfestFairHttp.js";

const router = Router();
const handle = (fn) => handleFair(fn, "vendorArtfestFairInventory");

router.use(authRequired, requireVendor);

router.get(
  "/",
  handle(async (req, res) => {
    res.json(await listInventory({ vendorId: req.vendorId }));
  })
);

router.get(
  "/products",
  handle(async (req, res) => {
    res.json({ items: await listEligibleProducts({ vendorId: req.vendorId }) });
  })
);

router.post(
  "/",
  handle(async (req, res) => {
    const item = await addInventoryItem({ vendorId: req.vendorId, userId: req.user.sub, body: req.body || {} });
    res.status(201).json({ ok: true, item });
  })
);

router.post(
  "/submit",
  handle(async (req, res) => {
    res.json({ ok: true, ...(await submitInventory({ vendorId: req.vendorId, userId: req.user.sub })) });
  })
);

// Etichetele sunt generate, imprimate și aplicate de Artfest (Admin -> Târg -> Etichete).
// Vendorul nu le mai poate genera; răspunsul e 403 înainte de orice citire / PDF.
function labelsManagedByArtfest(_req, res) {
  res.status(403).json({
    error: "labels_managed_by_artfest",
    message: "Etichetarea produselor este asigurată de Artfest. Nu trebuie să generezi etichete.",
  });
}

// înaintea rutelor /:id
router.get("/labels.pdf", labelsManagedByArtfest);

router.patch(
  "/:id",
  handle(async (req, res) => {
    const item = await updateInventoryItem({
      vendorId: req.vendorId,
      userId: req.user.sub,
      id: req.params.id,
      body: req.body || {},
    });
    res.json({ ok: true, item });
  })
);

router.delete(
  "/:id",
  handle(async (req, res) => {
    res.json(await removeInventoryItem({ vendorId: req.vendorId, userId: req.user.sub, id: req.params.id }));
  })
);

router.post(
  "/:id/sync-price",
  handle(async (req, res) => {
    const item = await syncInventoryItemPrice({ vendorId: req.vendorId, userId: req.user.sub, id: req.params.id });
    res.json({ ok: true, item });
  })
);

router.post(
  "/:id/cancel",
  handle(async (req, res) => {
    const ctx = await getVendorInventoryContext({ vendorId: req.vendorId });
    if (!ctx.approved) {
      return res.status(403).json({ error: "registration_not_approved", message: "Inventarul este disponibil doar pentru înscrierile aprobate." });
    }
    await cancelSubmittedLine({
      id: req.params.id,
      actor: { type: "vendor", vendorId: req.vendorId, userId: req.user.sub, canEdit: ctx.canEdit },
    });
    res.json({ ok: true });
  })
);

router.get("/:id/label.pdf", labelsManagedByArtfest);

export default router;
