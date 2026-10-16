// backend/src/routes/vendorArtfestFairRoutes.js
//
// Târgul de Crăciun Artfest - partea de vendor. Montat pe /api/vendor/artfest-fair:
//   GET  /                         târgul + înscrierea vendorului autentificat
//   POST /registration             înscriere (sau reînscriere după WITHDRAWN)
//   POST /registration/withdraw    retragere (SUBMITTED / APPROVED, fără inventar trimis)
//   GET  /rules-draft              draftul regulamentului, DOAR pentru citire (nu e versiunea oficială)
//   GET  /sales?date=&from=&to=&page=&limit=   liniile de vânzare ale vendorului (doar ale lui)
//   GET  /reports/daily?date=      raportul zilnic al vendorului (ziua locală a târgului)
//   GET  /reports/daily.csv?date=  același raport, CSV
//   GET  /returns                  retururile Artfest -> vendor (doar ale vendorului autentificat)
//   POST /returns/:id/confirm      Idempotency-Key; confirmarea primirii + readăugarea online
//
// vendorId vine EXCLUSIV din sesiune; orice vendorId din body e ignorat,
// deci un vendor nu poate înscrie / retrage alt vendor.

import { Router } from "express";
import { authRequired } from "../api/auth.js";
import {
  getVendorFairState,
  submitRegistration,
  withdrawRegistration,
} from "../services/artfestFairService.js";
import { confirmReturn, listReturnsForVendor } from "../services/artfestFairReturnService.js";
import { listVendorSales, vendorDailyReport, vendorReportCsv } from "../services/artfestFairReportsService.js";
import { getSettlementForVendor, listSettlementsForVendor, settlementCsv } from "../services/artfestFairSettlementService.js";
import { getRequestIp, handleFair, requireVendor, sendFairRulesDraft } from "./artfestFairHttp.js";

const router = Router();
const handle = (fn) => handleFair(fn, "vendorArtfestFair");

router.use(authRequired, requireVendor);

router.get(
  "/",
  handle(async (req, res) => {
    res.json(await getVendorFairState({ vendorId: req.vendorId, userId: req.user.sub }));
  })
);

router.post(
  "/registration",
  handle(async (req, res) => {
    const registration = await submitRegistration({
      vendorId: req.vendorId,
      userId: req.user.sub,
      body: req.body || {},
      ip: getRequestIp(req),
      ua: req.headers["user-agent"] || null,
    });
    res.status(201).json({
      ok: true,
      registration,
      message: "Înscrierea ta a fost trimisă. Te vom anunța după verificare.",
    });
  })
);

router.post(
  "/registration/withdraw",
  handle(async (req, res) => {
    const registration = await withdrawRegistration({ vendorId: req.vendorId, userId: req.user.sub });
    res.json({ ok: true, registration });
  })
);

router.get("/rules-draft", sendFairRulesDraft);

const q = (v) => (v ? String(v) : null);

router.get(
  "/sales",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(
      await listVendorSales({
        vendorId: req.vendorId,
        date: q(req.query.date),
        from: q(req.query.from),
        to: q(req.query.to),
        page: req.query.page,
        limit: req.query.limit,
      })
    );
  })
);

router.get(
  "/reports/daily",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await vendorDailyReport({ vendorId: req.vendorId, date: q(req.query.date) }));
  })
);

router.get(
  "/reports/daily.csv",
  handle(async (req, res) => {
    const report = await vendorDailyReport({ vendorId: req.vendorId, date: q(req.query.date) });
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="raport-targ-artfest-${report.date}.csv"`);
    res.set("Cache-Control", "no-store");
    res.send(vendorReportCsv(report));
  })
);

/* ---------- deconturi (doar ale vendorului din sesiune, doar finalizate) ---------- */

router.get(
  "/settlements",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await listSettlementsForVendor({ vendorId: req.vendorId }));
  })
);

router.get(
  "/settlements/:id.csv",
  handle(async (req, res) => {
    const d = await getSettlementForVendor({ id: req.params.id, vendorId: req.vendorId });
    res.set("Content-Type", "text/csv; charset=utf-8");
    res.set("Content-Disposition", `attachment; filename="decont-targ-artfest-${d.sequence}.csv"`);
    res.set("Cache-Control", "no-store");
    res.send(settlementCsv(d, { admin: false }));
  })
);

router.get(
  "/settlements/:id",
  handle(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ item: await getSettlementForVendor({ id: req.params.id, vendorId: req.vendorId }) });
  })
);

router.get(
  "/returns",
  handle(async (req, res) => {
    res.json(await listReturnsForVendor({ vendorId: req.vendorId }));
  })
);

router.post(
  "/returns/:id/confirm",
  handle(async (req, res) => {
    const result = await confirmReturn({
      id: req.params.id,
      body: req.body || {},
      idempotencyKey: req.get("Idempotency-Key"),
      actor: { type: "vendor", vendorId: req.vendorId, userId: req.user.sub },
    });
    res.json({ ok: true, ...result });
  })
);

export default router;
