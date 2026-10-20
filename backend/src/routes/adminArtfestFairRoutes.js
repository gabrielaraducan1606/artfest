// backend/src/routes/adminArtfestFairRoutes.js
//
// Admin -> Târg Artfest. Montat pe /api/admin/artfest-fair:
//   GET  /registrations             listă (filtre: status, participationType)
//   GET  /registrations/:id         detaliu
//   POST /registrations/:id/approve
//   POST /registrations/:id/reject  { reason? } - motiv intern, nu se arată vendorului
//   GET  /invite/preview            număr estimat de destinatari
//   POST /invite/send               { confirm: <campaignKey> } - pornește invitația
//   GET  /invite/status             progresul / rezultatul ultimei rulări
//
// Invitația pentru magazinele NEACTIVATE (doar email, pornită manual):
//   GET  /activation-invite/preview        destinatari eligibili (+ stare livrare) și excluși pe motive
//   GET  /activation-invite/email-preview  emailul HTML (exemplu)
//   POST /activation-invite/send           { confirm: <campaignKey>, vendorIds: [...] } - în fundal
//   GET  /activation-invite/status         progresul / rezultatul ultimei rulări
//
// Recepția inventarului (etapa 2):
//   GET  /inventory?filter=&q=                 linii (toate / de recepționat / cu diferențe ...)
//   GET  /inventory/by-barcode/:barcode         scanare (scaner USB 1D)
//   GET  /inventory/:id/label.pdf                o etichetă 70 × 37 mm (reimprimare = același cod)
//   GET  /inventory/labels.pdf?vendorId=&copies= etichetele unui vendor / ale târgului (A4 3 × 8)
//   POST /inventory/labels.pdf                   { ids, copies: declared|received|one } - selecție
//   Etichetele se generează DOAR din Admin (vendorii nu mai au acces).
//   GET  /inventory/:id                          detaliu + jurnal de stoc
//   POST /inventory/photos                       fotografii (R2) pentru refuz / deteriorare
//   POST /inventory/:id/receive                  Idempotency-Key; receivedQty, rejectedQty, ...
//   POST /inventory/:id/damage                   Idempotency-Key; quantity, reason, photoUrls
//   POST /inventory/:id/block | /unblock         blocare / deblocare de la vânzare
//   POST /inventory/:id/cancel                   anulare linie trimisă, nerecepționată
//                                                { releaseOnline:false } = colet pierdut (stocul nu revine online)
//
// Anularea participării (APPROVED -> CANCELLED, separată de reject):
//   GET  /registrations/:id/events               istoricul deciziilor
//   GET  /registrations/:id/cancellation-preview regula taxei / returului + ce se întâmplă cu inventarul
//   POST /registrations/:id/cancel               Idempotency-Key; cause, reason, messageForVendor?, goodsAlreadyShipped
//
// Returul către vendor:
//   GET   /returns/candidates?registrationId=     ce poate pleca în retur
//   GET   /returns?registrationId=&status=
//   GET   /returns/:id
//   POST  /returns                               registrationId, reason, method, lines[], costPayer?/costPayerReason
//   PATCH /returns/:id                           doar PREPARING
//   POST  /returns/:id/cancel                    doar PREPARING (stocul nu se atinge)
//   POST  /returns/:id/ship                      Idempotency-Key; expediere / predare (mișcă stocul fizic)
//   POST  /returns/:id/confirm-on-behalf         Idempotency-Key; min. 7 zile după expediere, motiv obligatoriu
//
// POS intern (MVP, fără fiscalizare):
//   GET  /pos/status                             salesOpen + comision
//   POST /pos/status                             { salesOpen } - deschide / închide vânzările
//   GET  /pos/scan?barcode=                       produsul scanat + dacă e vandabil (nu modifică nimic)
//   POST /pos/preview                            { lines:[{inventoryItemId, quantity}] } - calcul pe server
//   POST /pos/sales                              Idempotency-Key; { lines, paymentMethod: CASH|CARD, note? }
//   GET  /pos/sales, GET /pos/sales/:id          istoric / detaliu (cu retururi)
//   POST /pos/sales/:id/void                     Idempotency-Key; { reason } - anulare integrală (RESTOCKED)
//   POST /pos/sales/:id/returns                  Idempotency-Key; { reason, refundMethod, lines:[{saleLineId, quantity, disposition, conditionNote?}] }
//   POST /pos/sales/:id/returns/preview          { type: VOID|RETURN, ... } - sumele inversate + efectul pe stoc, fără scriere
//   Deconturi (fără fiscalizare / factură / plată reală):
//   POST /settlements/preview                    { vendorId, periodFrom, periodTo } (AAAA-LL-ZZ, zile locale inclusiv) - fără scriere
//   POST /settlements                            creează DRAFT (max. unul pe vendor)
//   GET  /settlements, GET /settlements/:id(.csv)
//   POST /settlements/:id/recalculate|adjustments|finalize|mark-paid|cancel
//
// Invitația pornește DOAR de aici (acțiune manuală a adminului).

import { Router } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import {
  getRegistrationForAdmin,
  listRegistrationEvents,
  listRegistrationsForAdmin,
  reviewRegistration,
} from "../services/artfestFairService.js";
import { cancelParticipation, previewCancellation } from "../services/artfestFairCancellationService.js";
import {
  cancelReturn,
  confirmReturn,
  createReturn,
  getReturnForAdmin,
  listReturnCandidates,
  listReturnsForAdmin,
  shipReturn,
  updateReturn,
} from "../services/artfestFairReturnService.js";
import { getInviteStatus, previewInvite, startInvite } from "../services/artfestFairInviteService.js";
import { ARTFEST_FAIR_ACTIVATION_INVITE_CAMPAIGN_KEY, ARTFEST_FAIR_INVITE_CAMPAIGN_KEY } from "../config/artfestFair.js";
import {
  FAIR_PHOTO_FOLDER,
  blockSale,
  cancelSubmittedLine,
  getAdminInventoryLine,
  listAdminInventory,
  lookupByBarcode,
  markDamaged,
  receiveInventoryLine,
  unblockSale,
} from "../services/artfestFairReceptionService.js";
import { createSale, getPosStatus, getSale, listSales, previewSale, scanBarcode, setSalesOpen } from "../services/artfestFairPosService.js";
import { buildPublicUrl, uploadToR2 } from "../services/r2Storage.js";
import { getAdminLabelItems, markLabelsGenerated } from "../services/artfestFairInventoryService.js";
import { adminDailyReport, adminReportCsv } from "../services/artfestFairReportsService.js";
import { previewSaleReturn, returnSale, voidSale } from "../services/artfestFairSaleReturnService.js";
import {
  addAdjustment,
  cancelSettlementDraft,
  createSettlementDraft,
  finalizeSettlement,
  getSettlementForAdmin,
  listSettlementsForAdmin,
  markSettlementPaid,
  previewSettlement,
  recalculateSettlement,
  settlementCsv,
} from "../services/artfestFairSettlementService.js";
import { LABEL_COPY_MODES, applyLabelCopies, renderLabelSheetPdf, renderSingleLabelPdf } from "../lib/fairLabels.js";
import { FairError } from "../services/artfestFairService.js";
import { handleFair, sendFairRulesDraft } from "./artfestFairHttp.js";

const router = Router();

function adminOnly(req, res, next) {
  if (!req.user?.sub) return res.status(401).json({ error: "unauthorized" });

  prisma.user
    .findUnique({ where: { id: req.user.sub }, select: { id: true, role: true } })
    .then((user) => {
      if (!user) return res.status(401).json({ error: "user_not_found" });
      if (user.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
      req.adminUser = user;
      next();
    })
    .catch((error) => {
      console.error("[adminArtfestFair] adminOnly error:", error);
      res.status(500).json({ error: "auth_check_failed" });
    });
}

const handle = (fn) => handleFair(fn, "adminArtfestFair");

// fotografiile de la recepție: doar imagini, max 10 MB / fișier, max 6 deodată
const uploadPhotos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => cb(null, String(file.mimetype || "").toLowerCase().startsWith("image/")),
});

// doar URL-urile din folderul recepției sunt acceptate pe mișcările de stoc
const photoPrefix = () => buildPublicUrl(`${FAIR_PHOTO_FOLDER}/`);

router.use(authRequired, adminOnly);

router.get(
  "/registrations",
  handle(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const participationType = req.query.participationType ? String(req.query.participationType) : null;
    res.json(await listRegistrationsForAdmin({ status, participationType }));
  })
);

router.get(
  "/registrations/:id",
  handle(async (req, res) => {
    res.json({ item: await getRegistrationForAdmin({ id: req.params.id }) });
  })
);

router.post(
  "/registrations/:id/approve",
  handle(async (req, res) => {
    const item = await reviewRegistration({ id: req.params.id, action: "approve", adminId: req.adminUser.id });
    res.json({ ok: true, item });
  })
);

router.post(
  "/registrations/:id/reject",
  handle(async (req, res) => {
    const item = await reviewRegistration({
      id: req.params.id,
      action: "reject",
      adminId: req.adminUser.id,
      reason: req.body?.reason ?? null,
    });
    res.json({ ok: true, item });
  })
);

// draftul regulamentului, doar pentru citire (nu e versiunea oficială)
router.get("/rules-draft", sendFairRulesDraft);

/* ===================== POS (vânzare la stand) ===================== */

router.get(
  "/pos/status",
  handle(async (_req, res) => {
    res.json(await getPosStatus());
  })
);

router.post(
  "/pos/status",
  handle(async (req, res) => {
    res.json(await setSalesOpen({ open: req.body?.salesOpen, adminId: req.adminUser.id }));
  })
);

router.get(
  "/pos/scan",
  handle(async (req, res) => {
    res.json({ item: await scanBarcode({ barcode: String(req.query.barcode || "") }) });
  })
);

router.post(
  "/pos/preview",
  handle(async (req, res) => {
    res.json(await previewSale({ body: req.body || {} }));
  })
);

router.get(
  "/pos/sales",
  handle(async (req, res) => {
    res.json(await listSales({ limit: req.query.limit }));
  })
);

router.get(
  "/pos/reports/daily",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await adminDailyReport({ date: req.query.date ? String(req.query.date) : null }));
  })
);

router.get(
  "/pos/reports/daily.csv",
  handle(async (req, res) => {
    const report = await adminDailyReport({ date: req.query.date ? String(req.query.date) : null });
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="raport-admin-targ-artfest-${report.date}.csv"`);
    res.set("Cache-Control", "no-store");
    res.send(adminReportCsv(report));
  })
);

router.get(
  "/pos/sales/:id",
  handle(async (req, res) => {
    res.json({ item: await getSale({ id: req.params.id }) });
  })
);

router.post(
  "/pos/sales",
  handle(async (req, res) => {
    const result = await createSale({
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key"),
      adminId: req.adminUser.id,
    });
    res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
  })
);

/* ===================== Retururi / anulări (clienți) ===================== */

router.post(
  "/pos/sales/:id/returns/preview",
  handle(async (req, res) => {
    res.json(await previewSaleReturn({ saleId: req.params.id, type: req.body?.type, body: req.body || {} }));
  })
);

router.post(
  "/pos/sales/:id/void",
  handle(async (req, res) => {
    const result = await voidSale({
      saleId: req.params.id,
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key"),
      adminId: req.adminUser.id,
    });
    res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
  })
);

router.post(
  "/pos/sales/:id/returns",
  handle(async (req, res) => {
    const result = await returnSale({
      saleId: req.params.id,
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key"),
      adminId: req.adminUser.id,
    });
    res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
  })
);

/* ===================== Deconturi ===================== */

router.post(
  "/settlements/preview",
  handle(async (req, res) => {
    res.json(await previewSettlement({ body: req.body || {} }));
  })
);

router.get(
  "/settlements",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await listSettlementsForAdmin({ vendorId: req.query.vendorId ? String(req.query.vendorId) : null, status: req.query.status ? String(req.query.status) : null }));
  })
);

router.post(
  "/settlements",
  handle(async (req, res) => {
    res.status(201).json({ ok: true, item: await createSettlementDraft({ body: req.body || {}, adminId: req.adminUser.id }) });
  })
);

router.get(
  "/settlements/:id.csv",
  handle(async (req, res) => {
    const d = await getSettlementForAdmin({ id: req.params.id });
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="decont-admin-targ-artfest-${d.sequence}-${d.vendorId}.csv"`);
    res.set("Cache-Control", "no-store");
    res.send(settlementCsv(d, { admin: true }));
  })
);

router.get(
  "/settlements/:id",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ item: await getSettlementForAdmin({ id: req.params.id }) });
  })
);

router.post(
  "/settlements/:id/recalculate",
  handle(async (req, res) => {
    res.json({ ok: true, item: await recalculateSettlement({ id: req.params.id }) });
  })
);

router.post(
  "/settlements/:id/adjustments",
  handle(async (req, res) => {
    res.status(201).json({ ok: true, item: await addAdjustment({ id: req.params.id, body: req.body || {}, adminId: req.adminUser.id }) });
  })
);

router.post(
  "/settlements/:id/finalize",
  handle(async (req, res) => {
    res.json({ ok: true, item: await finalizeSettlement({ id: req.params.id, adminId: req.adminUser.id }) });
  })
);

router.post(
  "/settlements/:id/mark-paid",
  handle(async (req, res) => {
    res.json({ ok: true, item: await markSettlementPaid({ id: req.params.id, body: req.body || {}, adminId: req.adminUser.id }) });
  })
);

router.post(
  "/settlements/:id/cancel",
  handle(async (req, res) => {
    res.json({ ok: true, item: await cancelSettlementDraft({ id: req.params.id }) });
  })
);

/* ===================== Anularea participării ===================== */

router.get(
  "/registrations/:id/events",
  handle(async (req, res) => {
    res.json({ items: await listRegistrationEvents({ id: req.params.id }) });
  })
);

router.get(
  "/registrations/:id/cancellation-preview",
  handle(async (req, res) => {
    res.json(await previewCancellation({ id: req.params.id }));
  })
);

router.post(
  "/registrations/:id/cancel",
  handle(async (req, res) => {
    const result = await cancelParticipation({
      id: req.params.id,
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key"),
      adminId: req.adminUser.id,
    });
    res.json({ ok: true, ...result });
  })
);

/* ===================== Returul către vendor ===================== */

router.get(
  "/returns/candidates",
  handle(async (req, res) => {
    res.json(await listReturnCandidates({ registrationId: String(req.query.registrationId || "") }));
  })
);

router.get(
  "/returns",
  handle(async (req, res) => {
    res.json(
      await listReturnsForAdmin({
        registrationId: req.query.registrationId ? String(req.query.registrationId) : null,
        status: req.query.status ? String(req.query.status) : null,
      })
    );
  })
);

router.get(
  "/returns/:id",
  handle(async (req, res) => {
    res.json({ item: await getReturnForAdmin({ id: req.params.id }) });
  })
);

router.post(
  "/returns",
  handle(async (req, res) => {
    res.status(201).json({ ok: true, item: await createReturn({ body: req.body || {}, adminId: req.adminUser.id }) });
  })
);

router.patch(
  "/returns/:id",
  handle(async (req, res) => {
    res.json({ ok: true, item: await updateReturn({ id: req.params.id, body: req.body || {}, adminId: req.adminUser.id }) });
  })
);

router.post(
  "/returns/:id/cancel",
  handle(async (req, res) => {
    res.json({
      ok: true,
      item: await cancelReturn({ id: req.params.id, reason: req.body?.reason ?? null, adminId: req.adminUser.id }),
    });
  })
);

router.post(
  "/returns/:id/ship",
  handle(async (req, res) => {
    const result = await shipReturn({
      id: req.params.id,
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key"),
      adminId: req.adminUser.id,
    });
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/returns/:id/confirm-on-behalf",
  handle(async (req, res) => {
    const result = await confirmReturn({
      id: req.params.id,
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key"),
      actor: { type: "admin", userId: req.adminUser.id },
    });
    res.json({ ok: true, ...result });
  })
);

router.get(
  "/invite/preview",
  handle(async (_req, res) => {
    res.json({ ...(await previewInvite()), status: getInviteStatus() });
  })
);

router.post(
  "/invite/send",
  handle(async (req, res) => {
    // confirmare explicită: un POST accidental (fără cheie) nu trimite nimic
    if (req.body?.confirm !== ARTFEST_FAIR_INVITE_CAMPAIGN_KEY) {
      return res.status(400).json({ error: "confirmation_required", message: "Confirmarea lipsește." });
    }

    const outcome = startInvite({ adminId: req.adminUser.id });
    if (!outcome.started) {
      return res.status(409).json({
        error: "already_running",
        message: "Invitația se trimite deja.",
        status: outcome.status,
      });
    }
    res.status(202).json({ ok: true, status: outcome.status });
  })
);

router.get(
  "/invite/status",
  handle(async (_req, res) => {
    res.json(getInviteStatus());
  })
);

/* ===================== Invitație: magazine neactivate ===================== */

// încărcat la prima folosire: restul rutelor Târgului nu depind de șablonul noului email
const activationInvite = () => import("../services/artfestFairActivationInviteService.js");

router.get(
  "/activation-invite/preview",
  handle(async (_req, res) => {
    const svc = await activationInvite();
    res.json({ ...(await svc.previewActivationInvite()), status: svc.getActivationInviteStatus() });
  })
);

router.get(
  "/activation-invite/email-preview",
  handle(async (req, res) => {
    const ctaPath = req.query.ctaPath === "/onboarding/details" ? "/onboarding/details" : "/onboarding";
    res.set("Cache-Control", "no-store");
    res.json((await activationInvite()).renderActivationInvitePreview({ ctaPath }));
  })
);

router.post(
  "/activation-invite/send",
  handle(async (req, res) => {
    // confirmare explicită: un POST accidental (fără cheie) nu trimite nimic
    if (req.body?.confirm !== ARTFEST_FAIR_ACTIVATION_INVITE_CAMPAIGN_KEY) {
      return res.status(400).json({ error: "confirmation_required", message: "Confirmarea lipsește." });
    }
    const outcome = (await activationInvite()).startActivationInvite({ adminId: req.adminUser.id, vendorIds: req.body?.vendorIds });
    if (!outcome.started) {
      return res.status(409).json({ error: "already_running", message: "Invitațiile se trimit deja.", status: outcome.status });
    }
    res.status(202).json({ ok: true, status: outcome.status });
  })
);

router.get(
  "/activation-invite/status",
  handle(async (_req, res) => {
    res.json((await activationInvite()).getActivationInviteStatus());
  })
);


/* ===================== Recepția inventarului ===================== */

router.get(
  "/inventory",
  handle(async (req, res) => {
    res.json(await listAdminInventory({ filter: String(req.query.filter || "all"), q: String(req.query.q || "") }));
  })
);

router.get(
  "/inventory/by-barcode/:barcode",
  handle(async (req, res) => {
    res.json({ item: await lookupByBarcode({ barcode: req.params.barcode }) });
  })
);

router.post("/inventory/photos", (req, res) => {
  uploadPhotos.array("files", 6)(req, res, async (err) => {
    if (err) {
      const tooLarge = err.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "file_too_large" : "upload_failed",
        message: tooLarge ? "Fotografia este prea mare (max 10 MB)." : "Nu am putut încărca fotografiile.",
      });
    }
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) return res.status(400).json({ error: "no_file", message: "Alege cel puțin o fotografie." });
    try {
      const uploaded = [];
      for (const [index, file] of files.entries()) {
        uploaded.push(await uploadToR2({ file, folder: FAIR_PHOTO_FOLDER, userId: req.adminUser.id, index }));
      }
      res.json({ ok: true, urls: uploaded.map((u) => u.url) });
    } catch (error) {
      console.error("[adminArtfestFair] photo upload:", error?.message || error);
      res.status(500).json({ error: "upload_failed", message: "Nu am putut încărca fotografiile." });
    }
  });
});

/* ===================== Etichete (același generator ca la vendor) ===================== */

function sendPdf(res, pdf, filename) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(Buffer.from(pdf));
}

// câte etichete pe linie: declared (implicit) | received | one
function labelCopyMode(value) {
  const mode = value ? String(value) : "declared";
  if (!LABEL_COPY_MODES.includes(mode)) {
    throw new FairError(400, "invalid_copy_mode", "Alege câte etichete se imprimă pentru fiecare produs.");
  }
  return mode;
}

async function sendLabelSheet(req, res, items, mode, filename) {
  const withCopies = applyLabelCopies(items, mode);
  if (!withCopies.length) {
    throw new FairError(409, "no_received_items", "Niciun produs selectat nu are bucăți recepționate.");
  }
  const { pdf } = await renderLabelSheetPdf(withCopies);
  await markLabelsGenerated({ items: withCopies, userId: req.adminUser.id });
  sendPdf(res, pdf, filename);
}

// ?vendorId= -> etichetele unui vendor; fără parametru -> toate etichetele târgului (A4 3 × 8)
// ?copies=declared|received|one
router.get(
  "/inventory/labels.pdf",
  handle(async (req, res) => {
    const vendorId = req.query.vendorId ? String(req.query.vendorId) : null;
    const mode = labelCopyMode(req.query.copies);
    const items = await getAdminLabelItems({ vendorId });
    await sendLabelSheet(req, res, items, mode, vendorId ? "etichete-vendor-targ-artfest.pdf" : "etichete-targ-artfest.pdf");
  })
);

// produsele selectate în Admin -> Etichete: { ids: [...], copies? } (A4 3 × 8).
// Reimprimarea folosește codurile existente; nu se generează coduri noi.
router.post(
  "/inventory/labels.pdf",
  handle(async (req, res) => {
    const mode = labelCopyMode(req.body?.copies);
    const items = await getAdminLabelItems({ ids: Array.isArray(req.body?.ids) ? req.body.ids : [] });
    await sendLabelSheet(req, res, items, mode, "etichete-selectate-targ-artfest.pdf");
  })
);

router.get(
  "/inventory/:id/label.pdf",
  handle(async (req, res) => {
    const [item] = await getAdminLabelItems({ id: req.params.id });
    const pdf = await renderSingleLabelPdf(item);
    await markLabelsGenerated({ items: [item], userId: req.adminUser.id });
    sendPdf(res, pdf, `eticheta-${item.barcode}.pdf`);
  })
);

router.get(
  "/inventory/:id",
  handle(async (req, res) => {
    res.json({ item: await getAdminInventoryLine({ id: req.params.id }) });
  })
);

router.post(
  "/inventory/:id/receive",
  handle(async (req, res) => {
    const result = await receiveInventoryLine({
      id: req.params.id,
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key"),
      adminId: req.adminUser.id,
      photoPrefix: photoPrefix(),
    });
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/inventory/:id/damage",
  handle(async (req, res) => {
    const result = await markDamaged({
      id: req.params.id,
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key"),
      adminId: req.adminUser.id,
      photoPrefix: photoPrefix(),
    });
    res.json({ ok: true, ...result });
  })
);

router.post(
  "/inventory/:id/block",
  handle(async (req, res) => {
    res.json({ ok: true, item: await blockSale({ id: req.params.id, reason: req.body?.reason, adminId: req.adminUser.id }) });
  })
);

router.post(
  "/inventory/:id/unblock",
  handle(async (req, res) => {
    res.json({ ok: true, item: await unblockSale({ id: req.params.id, adminId: req.adminUser.id }) });
  })
);

router.post(
  "/inventory/:id/cancel",
  handle(async (req, res) => {
    await cancelSubmittedLine({
      id: req.params.id,
      actor: { type: "admin", userId: req.adminUser.id },
      reason: req.body?.reason ?? null,
      releaseOnline: req.body?.releaseOnline !== false,
    });
    res.json({ ok: true, item: await getAdminInventoryLine({ id: req.params.id }) });
  })
);

export default router;
