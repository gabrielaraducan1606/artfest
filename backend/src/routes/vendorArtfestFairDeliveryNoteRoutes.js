// backend/src/routes/vendorArtfestFairDeliveryNoteRoutes.js
//
// Avize de însoțire a mărfii pentru Târgul Artfest. Montat pe /api/vendor/fair/delivery-notes:
//   GET  /preview      date precompletate (emitent, destinatar, adresă, produse, serii) + blocaje
//   GET  /             istoricul avizelor vendorului
//   POST /preview.pdf  PDF „PREVIZUALIZARE – NEEMIS” din datele formularului (fără nicio scriere)
//   POST /             emitere; header Idempotency-Key (dublu-click => același aviz, 200 duplicate)
//   GET  /:id          detaliu
//   GET  /:id/pdf      PDF A4 din datele înghețate (fără renumerotare)
//   POST /:id/cancel   { reason } - anulare trasabilă (numărul nu se reutilizează)
//
// Totul e filtrat pe vendorId din sesiune; avizul altui vendor => 404.
// Nu modifică inventarul, stocurile, vânzările, facturile sau deconturile.

import { Router } from "express";
import { authRequired } from "../api/auth.js";
import {
  cancelDeliveryNote,
  getDeliveryNote,
  getDeliveryNotePreview,
  issueDeliveryNote,
  listDeliveryNotes,
  previewDeliveryNoteDraft,
  serializeNote,
} from "../services/artfestFairDeliveryNoteService.js";
import { renderDeliveryNotePdf } from "../lib/fairDeliveryNotePdf.js";
import { handleFair, requireVendor } from "./artfestFairHttp.js";

const router = Router();
const handle = (fn) => handleFair(fn, "vendorArtfestFairDeliveryNotes");

router.use(authRequired, requireVendor);

router.get(
  "/preview",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await getDeliveryNotePreview({ vendorId: req.vendorId }));
  })
);

// PDF de previzualizare din datele formularului: „PREVIZUALIZARE – NEEMIS”, fără
// serie / număr; NU scrie nimic (nu creează aviz, nu consumă număr din serie)
router.post(
  "/preview.pdf",
  handle(async (req, res) => {
    const draft = await previewDeliveryNoteDraft({ vendorId: req.vendorId, body: req.body || {} });
    const pdf = await renderDeliveryNotePdf(draft);
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", 'inline; filename="aviz-previzualizare-neemis.pdf"');
    res.set("Cache-Control", "private, no-store");
    res.send(Buffer.from(pdf));
  })
);

router.get(
  "/",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await listDeliveryNotes({ vendorId: req.vendorId }));
  })
);

router.post(
  "/",
  handle(async (req, res) => {
    const { note, duplicate } = await issueDeliveryNote({
      vendorId: req.vendorId,
      userId: req.user.sub,
      idempotencyKey: req.get("Idempotency-Key"),
      body: req.body || {},
    });
    res.status(duplicate ? 200 : 201).json({ ok: true, note, duplicate });
  })
);

router.get(
  "/:id",
  handle(async (req, res) => {
    res.json({ note: serializeNote(await getDeliveryNote({ vendorId: req.vendorId, id: req.params.id })) });
  })
);

router.get(
  "/:id/pdf",
  handle(async (req, res) => {
    const note = serializeNote(await getDeliveryNote({ vendorId: req.vendorId, id: req.params.id }));
    const pdf = await renderDeliveryNotePdf(note);
    const name = `aviz-${note.series}-${note.number}${note.status === "CANCELLED" ? "-ANULAT" : ""}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_");
    res.set("Content-Type", "application/pdf");
    res.set("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${name}"`);
    res.set("Cache-Control", "private, no-store");
    res.send(Buffer.from(pdf));
  })
);

router.post(
  "/:id/cancel",
  handle(async (req, res) => {
    const note = await cancelDeliveryNote({
      vendorId: req.vendorId,
      userId: req.user.sub,
      id: req.params.id,
      reason: req.body?.reason,
    });
    res.json({ ok: true, note });
  })
);

export default router;
