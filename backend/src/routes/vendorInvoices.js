// backend/src/routes/vendorPayouts.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { z } from "zod";
import PDFDocument from "pdfkit";

const router = Router();

// ------------------------------
// helpers
// ------------------------------
async function getCurrentVendorByUser(userId) {
  return prisma.vendor.findUnique({
    where: { userId },
    select: { id: true },
  });
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function round2(n) {
  return Number.parseFloat(Number(n || 0).toFixed(2));
}

const isPostgres =
  (process.env.DATABASE_URL || "").startsWith("postgres://") ||
  (process.env.DATABASE_URL || "").startsWith("postgresql://");

// ------------------------------
// Validation
// ------------------------------
const RequestPayoutInput = z.object({
  // dacă vrei vendor-ul să poată alege o perioadă explicită:
  // periodFrom: z.string().optional(),
  // periodTo: z.string().optional(),
}).strict();

// ------------------------------
// Core queries
// ------------------------------
async function getEligibleEntries({ vendorId, currency = null }) {
  // Eligibil = entry nealocat încă unui payout (payoutId null)
  // + (optional) doar SALE/REFUND/ADJUSTMENT
  // + (optional) doar intrări "mature" (ex: occurredAt <= now-30 zile)
  const where = {
    vendorId,
    payoutId: null,
    type: { in: ["SALE", "REFUND", "ADJUSTMENT"] },
  };

  if (currency) where.currency = currency;

  const entries = await prisma.vendorEarningEntry.findMany({
    where,
    orderBy: { occurredAt: "asc" },
    select: {
      id: true,
      vendorId: true,
      shipmentId: true,
      orderId: true,
      type: true,
      occurredAt: true,
      currency: true,
      itemsNet: true,
      commissionNet: true,
      vendorNet: true,
      meta: true,
      createdAt: true,
    },
  });

  return entries;
}

async function computeEligibleTotals({ vendorId }) {
  // dacă ai multi-currency, aici fie:
  // 1) separi pe currency, fie
  // 2) alegi 1 singură currency acceptată
  // Pentru simplitate: presupunem 1 currency (RON).
  const entries = await getEligibleEntries({ vendorId });

  const currency = entries[0]?.currency || "RON";
  const sums = entries.reduce(
    (acc, e) => {
      acc.itemsNet += Number(e.itemsNet || 0);
      acc.commissionNet += Number(e.commissionNet || 0);
      acc.vendorNet += Number(e.vendorNet || 0);
      acc.count += 1;
      return acc;
    },
    { itemsNet: 0, commissionNet: 0, vendorNet: 0, count: 0 }
  );

  return {
    currency,
    eligibleCount: sums.count,
    itemsNet: round2(sums.itemsNet),
    commissionNet: round2(sums.commissionNet),
    vendorNet: round2(sums.vendorNet),
  };
}

async function getLastPayout({ vendorId }) {
  return prisma.vendorPayout.findFirst({
    where: { vendorId },
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      requestedAt: true,
      status: true,
      periodFrom: true,
      periodTo: true,
      amountNet: true,
      currency: true,
    },
  });
}

// regula: o cerere la 30 zile
function computeNextEligibleAt(lastPayout) {
  if (!lastPayout?.requestedAt) return null;
  const dt = new Date(lastPayout.requestedAt);
  dt.setDate(dt.getDate() + 30);
  return dt;
}

// ------------------------------
// 1) SUMMARY
// GET /api/vendor/payouts/summary
// ------------------------------
router.get("/vendor/payouts/summary", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) return res.status(403).json({ error: "not_a_vendor" });

    const [totals, lastPayout] = await Promise.all([
      computeEligibleTotals({ vendorId: vendor.id }),
      getLastPayout({ vendorId: vendor.id }),
    ]);

    const nextEligibleAt = computeNextEligibleAt(lastPayout);

    return res.json({
      currency: totals.currency,
      eligibleCount: totals.eligibleCount,
      availableAmount: totals.vendorNet, // acesta e “îți revine”
      breakdown: {
        itemsNet: totals.itemsNet,
        commissionNet: totals.commissionNet,
        vendorNet: totals.vendorNet,
      },
      nextEligibleAt,
      lastPayout: lastPayout
        ? {
            id: lastPayout.id,
            requestedAt: lastPayout.requestedAt,
            status: lastPayout.status,
            periodFrom: lastPayout.periodFrom,
            periodTo: lastPayout.periodTo,
            amountNet: Number(lastPayout.amountNet || 0),
            currency: lastPayout.currency || totals.currency,
          }
        : null,
    });
  } catch (err) {
    console.error("GET /vendor/payouts/summary FAILED:", err);
    res.status(500).json({
      error: "payout_summary_failed",
      message: err?.message || "Nu am putut încărca sumarul decontărilor.",
    });
  }
});

// ------------------------------
// 2) ENTRIES (eligible)
// GET /api/vendor/payouts/entries?eligible=true
// ------------------------------
router.get("/vendor/payouts/entries", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) return res.status(403).json({ error: "not_a_vendor" });

    const eligible = String(req.query.eligible || "true") === "true";

    const where = {
      vendorId: vendor.id,
      ...(eligible ? { payoutId: null } : {}),
    };

    const items = await prisma.vendorEarningEntry.findMany({
      where,
      orderBy: { occurredAt: "desc" },
      take: 500,
      select: {
        id: true,
        type: true,
        occurredAt: true,
        currency: true,
        itemsNet: true,
        commissionNet: true,
        vendorNet: true,
        orderId: true,
        shipmentId: true,
        meta: true,
      },
    });

    // opțional: dacă vrei orderNumber în UI, îl poți adăuga cu join pe Order
    // rapid: luăm orderIds și mapăm orderNumber
    const orderIds = [...new Set(items.map((x) => x.orderId).filter(Boolean))];

    const orders = orderIds.length
      ? await prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNumber: true },
        })
      : [];

    const orderNumberById = new Map(orders.map((o) => [o.id, o.orderNumber]));

    const dto = items.map((e) => ({
      id: e.id,
      type: e.type,
      occurredAt: e.occurredAt,
      currency: e.currency || "RON",
      itemsNet: Number(e.itemsNet || 0),
      commissionNet: Number(e.commissionNet || 0),
      vendorNet: Number(e.vendorNet || 0),
      orderId: e.orderId || null,
      orderNumber: e.orderId ? orderNumberById.get(e.orderId) || null : null,
      shipmentId: e.shipmentId || null,
      meta: e.meta || null,
    }));

    return res.json({ items: dto });
  } catch (err) {
    console.error("GET /vendor/payouts/entries FAILED:", err);
    res.status(500).json({
      error: "payout_entries_failed",
      message: err?.message || "Nu am putut încărca intrările.",
    });
  }
});

// ------------------------------
// 3) PAYOUTS HISTORY
// GET /api/vendor/payouts
// ------------------------------
router.get("/vendor/payouts", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) return res.status(403).json({ error: "not_a_vendor" });

    const items = await prisma.vendorPayout.findMany({
      where: { vendorId: vendor.id },
      orderBy: { requestedAt: "desc" },
      take: 100,
      select: {
        id: true,
        periodFrom: true,
        periodTo: true,
        requestedAt: true,
        approvedAt: true,
        paidAt: true,
        status: true,
        amountNet: true,
        currency: true,
        statementPdfUrl: true, // optional (string)
      },
    });

    const dto = items.map((p) => ({
      id: p.id,
      periodFrom: p.periodFrom,
      periodTo: p.periodTo,
      requestedAt: p.requestedAt,
      status: p.status,
      amountNet: Number(p.amountNet || 0),
      currency: p.currency || "RON",
      pdfUrl: p.statementPdfUrl || `/api/vendor/payouts/${p.id}/pdf`,
    }));

    res.json({ items: dto });
  } catch (err) {
    console.error("GET /vendor/payouts FAILED:", err);
    res.status(500).json({
      error: "payouts_failed",
      message: err?.message || "Nu am putut încărca istoricul decontărilor.",
    });
  }
});

// ------------------------------
// 4) REQUEST PAYOUT
// POST /api/vendor/payouts/request
// ------------------------------
router.post("/vendor/payouts/request", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) return res.status(403).json({ error: "not_a_vendor" });

    RequestPayoutInput.parse(req.body || {});

    // billing required (ca să poți emite “factura către platformă” / decont)
    const billing = await prisma.vendorBilling.findUnique({
      where: { vendorId: vendor.id },
      select: { id: true },
    });
    if (!billing) {
      return res.status(412).json({
        error: "billing_required",
        message: "Completează datele de facturare înainte de a cere plata.",
      });
    }

    const lastPayout = await getLastPayout({ vendorId: vendor.id });
    const nextEligibleAt = computeNextEligibleAt(lastPayout);

    if (nextEligibleAt && Date.now() < new Date(nextEligibleAt).getTime()) {
      return res.status(409).json({
        error: "PAYOUT_TOO_SOON",
        message: "Poți cere o decontare doar o dată la 30 de zile.",
        nextEligibleAt,
      });
    }

    const eligibleEntries = await getEligibleEntries({ vendorId: vendor.id });

    if (!eligibleEntries.length) {
      return res.status(409).json({
        error: "NOTHING_TO_PAYOUT",
        message: "Nu există intrări eligibile pentru plată momentan.",
      });
    }

    // perioadă = min/max occurredAt
    const periodFrom = startOfDay(
      eligibleEntries.reduce(
        (min, e) => (e.occurredAt < min ? e.occurredAt : min),
        eligibleEntries[0].occurredAt
      )
    );
    const periodTo = endOfDay(
      eligibleEntries.reduce(
        (max, e) => (e.occurredAt > max ? e.occurredAt : max),
        eligibleEntries[0].occurredAt
      )
    );

    // totals
    const currency = eligibleEntries[0].currency || "RON";
    const amountNet = round2(
      eligibleEntries.reduce((s, e) => s + Number(e.vendorNet || 0), 0)
    );

    // tranzacție: creează payout + leagă entries
    const created = await prisma.$transaction(async (tx) => {
      const payout = await tx.vendorPayout.create({
        data: {
          vendorId: vendor.id,
          periodFrom,
          periodTo,
          currency,
          amountNet,
          status: "REQUESTED",
          requestedAt: new Date(),
        },
        select: { id: true },
      });

      await tx.vendorEarningEntry.updateMany({
        where: {
          id: { in: eligibleEntries.map((e) => e.id) },
          vendorId: vendor.id,
          payoutId: null,
        },
        data: { payoutId: payout.id },
      });

      return payout;
    });

    return res.json({
      ok: true,
      payoutId: created.id,
      pdfUrl: `/api/vendor/payouts/${created.id}/pdf`,
    });
  } catch (err) {
    console.error("POST /vendor/payouts/request FAILED:", err);
    res.status(500).json({
      error: "payout_request_failed",
      message: err?.message || "Nu am putut crea cererea de plată.",
    });
  }
});

// ------------------------------
// 5) PAYOUT PDF (statement/decont)
// GET /api/vendor/payouts/:id/pdf
// ------------------------------
router.get("/vendor/payouts/:id/pdf", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) return res.status(403).json({ error: "not_a_vendor" });

    const id = String(req.params.id);

    const payout = await prisma.vendorPayout.findFirst({
      where: { id, vendorId: vendor.id },
      select: {
        id: true,
        vendorId: true,
        periodFrom: true,
        periodTo: true,
        requestedAt: true,
        status: true,
        currency: true,
        amountNet: true,
      },
    });
    if (!payout) return res.status(404).json({ error: "payout_not_found" });

    // intrările incluse în payout
    const entries = await prisma.vendorEarningEntry.findMany({
      where: { vendorId: vendor.id, payoutId: payout.id },
      orderBy: { occurredAt: "asc" },
      select: {
        id: true,
        type: true,
        occurredAt: true,
        currency: true,
        itemsNet: true,
        commissionNet: true,
        vendorNet: true,
        orderId: true,
        shipmentId: true,
      },
    });

    const orderIds = [...new Set(entries.map((x) => x.orderId).filter(Boolean))];
    const orders = orderIds.length
      ? await prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNumber: true },
        })
      : [];
    const orderNumberById = new Map(orders.map((o) => [o.id, o.orderNumber]));

    // billing
    const billing = await prisma.vendorBilling.findUnique({
      where: { vendorId: vendor.id },
      select: {
        companyName: true,
        cui: true,
        regCom: true,
        address: true,
        iban: true,
        bank: true,
      },
    });

    // generate PDF
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const fileName = `Decont-${payout.id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${fileName.replace(/"/g, "")}"`
    );

    doc.pipe(res);

    doc.fontSize(18).text("DECONT / CERERE PLATĂ", { align: "right" });
    doc.moveDown(0.5);

    doc.fontSize(10).text(`ID decont: ${payout.id}`);
    doc.text(`Status: ${payout.status}`);
    doc.text(
      `Perioadă: ${new Date(payout.periodFrom).toLocaleDateString("ro-RO")} – ${new Date(
        payout.periodTo
      ).toLocaleDateString("ro-RO")}`
    );
    doc.text(
      `Data cererii: ${new Date(payout.requestedAt).toLocaleString("ro-RO")}`
    );
    doc.moveDown(1);

    doc.fontSize(12).text("Date vendor:", { underline: true });
    doc.fontSize(10);
    if (billing) {
      doc.text(billing.companyName || "—");
      doc.text(`CUI: ${billing.cui || "—"}`);
      doc.text(`Reg. Com.: ${billing.regCom || "—"}`);
      doc.text(`Adresă: ${billing.address || "—"}`);
      doc.text(`IBAN: ${billing.iban || "—"}`);
      doc.text(`Banca: ${billing.bank || "—"}`);
    } else {
      doc.text("Date de facturare lipsă.");
    }
    doc.moveDown(1);

    // Totals
    const sums = entries.reduce(
      (acc, e) => {
        acc.itemsNet += Number(e.itemsNet || 0);
        acc.commissionNet += Number(e.commissionNet || 0);
        acc.vendorNet += Number(e.vendorNet || 0);
        return acc;
      },
      { itemsNet: 0, commissionNet: 0, vendorNet: 0 }
    );

    doc.fontSize(12).text("Totaluri:", { underline: true });
    doc.fontSize(10);
    doc.text(`Items net: ${round2(sums.itemsNet).toFixed(2)} ${payout.currency}`);
    doc.text(
      `Comision net: ${round2(sums.commissionNet).toFixed(2)} ${payout.currency}`
    );
    doc
      .fontSize(12)
      .text(
        `Îți revine: ${round2(sums.vendorNet).toFixed(2)} ${payout.currency}`,
        { align: "left" }
      );

    doc.moveDown(1);

    // Table header
    doc.fontSize(11).text("Intrări incluse:", { underline: true });
    doc.moveDown(0.5);

    const col = { date: 48, type: 130, order: 220, vendorNet: 450 };
    const y0 = doc.y;

    doc.fontSize(9);
    doc.text("Data", col.date, y0);
    doc.text("Tip", col.type, y0);
    doc.text("Comandă", col.order, y0);
    doc.text("Îți revine", col.vendorNet, y0);

    doc.moveTo(48, y0 + 12).lineTo(560, y0 + 12).stroke();

    let y = y0 + 18;
    for (const e of entries) {
      if (y > 760) {
        doc.addPage();
        y = 60;
      }
      const orderNumber = e.orderId ? orderNumberById.get(e.orderId) : null;

      doc.text(new Date(e.occurredAt).toLocaleDateString("ro-RO"), col.date, y);
      doc.text(e.type, col.type, y);
      doc.text(orderNumber || e.orderId || "—", col.order, y, { width: 220 });
      doc.text(
        `${round2(Number(e.vendorNet || 0)).toFixed(2)} ${e.currency || payout.currency}`,
        col.vendorNet,
        y
      );
      y += 14;
    }

    doc.end();
  } catch (err) {
    console.error("GET /vendor/payouts/:id/pdf FAILED:", err);
    res.status(500).json({
      error: "payout_pdf_failed",
      message: err?.message || "Nu am putut genera PDF-ul decontului.",
    });
  }
});

export default router;
