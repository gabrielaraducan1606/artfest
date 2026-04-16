// backend/src/routes/vendorPayouts.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import PDFDocument from "pdfkit";
import { renderInvoiceHtml } from "../lib/invoiceHtmlTemplate.js";
import { htmlToPdfBuffer } from "../lib/htmlToPdf.js";
import { getPlatformBillingOrThrow } from "../lib/platformBilling.js";

const router = Router();

// ------------------------------
// Constants / labels
// ------------------------------
const ENTRY_TYPE_LABELS = {
  SALE: "Comandă",
  REFUND: "Corecție",
  ADJUSTMENT: "Ajustare",
};

const STATEMENT_STATUS_LABELS = {
  DRAFT: "Ciornă",
  UNPAID: "Neplătit",
  OVERDUE: "Scadent",
  PAID: "Plătit",
  CANCELLED: "Anulat",
};

const INVOICE_STATUS_LABELS = {
  DRAFT: "Ciornă",
  UNPAID: "Neplătită",
  OVERDUE: "Scadentă",
  PAID: "Plătită",
  CANCELLED: "Anulată",
};

// ------------------------------
// Helpers
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

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function round2(n) {
  return Number.parseFloat(Number(n || 0).toFixed(2));
}

function formatMoney(value, currency = "RON") {
  return `${round2(value).toFixed(2)} ${currency}`;
}

function getEntryTypeLabel(type) {
  return ENTRY_TYPE_LABELS[type] || type || "—";
}

function getStatementStatusLabel(status) {
  return STATEMENT_STATUS_LABELS[status] || status || "—";
}

function getInvoiceStatusLabel(status) {
  return INVOICE_STATUS_LABELS[status] || status || "—";
}

function getInvoiceDirectionLabel(direction) {
  switch (direction) {
    case "PLATFORM_TO_VENDOR":
      return "Emisă de platformă";
    case "VENDOR_TO_PLATFORM":
      return "Emisă de vendor";
    case "VENDOR_TO_CLIENT":
      return "Emisă către client";
    case "PLATFORM_TO_CLIENT":
      return "Emisă către client";
    default:
      return direction || "—";
  }
}

function getInvoiceTypeLabel(type) {
  switch (type) {
    case "COMMISSION":
      return "Comision";
    case "SUBSCRIPTION":
      return "Abonament";
    case "SHIPPING":
      return "Curierat";
    case "OTHER":
      return "Altele";
    default:
      return type || "—";
  }
}

function toPlatformBillingProfile(platform) {
  return {
    vendorName: platform.companyName || "ArtFest",
    companyName: platform.companyName || "ArtFest",
    legalType: platform.legalType || null,
    cui: platform.cui || null,
    regCom: platform.regCom || null,
    address: platform.address || null,
    iban: platform.iban || null,
    bank: platform.bank || null,
    email: platform.email || null,
    phone: platform.phone || null,
    vatStatus: platform.vatPayer ? "payer" : "non_payer",
    vatRate: platform.vatPayer ? 21 : 0,
  };
}

async function getOrderNumberMap(orderIds) {
  const uniqueOrderIds = [...new Set((orderIds || []).filter(Boolean))];

  if (!uniqueOrderIds.length) {
    return new Map();
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: uniqueOrderIds } },
    select: { id: true, orderNumber: true },
  });

  return new Map(orders.map((o) => [o.id, o.orderNumber]));
}

// ------------------------------
// Core queries
// ------------------------------
async function getOpenLedgerEntries({ vendorId, currency = null }) {
  const where = {
    vendorId,
    payoutId: null,
    type: { in: ["SALE", "REFUND", "ADJUSTMENT"] },
  };

  if (currency) where.currency = currency;

  return prisma.vendorEarningEntry.findMany({
    where,
    orderBy: { occurredAt: "desc" },
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
}

async function computeOpenLedgerTotals({ vendorId }) {
  const entries = await getOpenLedgerEntries({ vendorId });
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

async function getLastStatement({ vendorId }) {
  return prisma.vendorPayout.findFirst({
    where: { vendorId },
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      issuedAt: true,
      paidAt: true,
      status: true,
      periodFrom: true,
      periodTo: true,
      totalItemsNet: true,
      totalCommissionNet: true,
      totalVendorNet: true,
      currency: true,
      invoiceId: true,
    },
  });
}

function computeNextStatementAt(lastStatement) {
  if (!lastStatement?.issuedAt) return null;
  return addDays(lastStatement.issuedAt, 30);
}

async function getVendorBillingSummary({ vendorId }) {
  const invoices = await prisma.invoice.findMany({
    where: {
      vendorId,
      direction: "PLATFORM_TO_VENDOR",
    },
    orderBy: [{ dueDate: "asc" }, { issueDate: "desc" }],
    select: {
      id: true,
      number: true,
      issueDate: true,
      dueDate: true,
      currency: true,
      status: true,
      totalGross: true,
      type: true,
    },
  });

  const currency = invoices[0]?.currency || "RON";

  const totals = invoices.reduce(
    (acc, inv) => {
      const gross = Number(inv.totalGross || 0);
      acc.totalInvoiced += gross;

      if (inv.status === "PAID") acc.totalPaid += gross;
      if (inv.status === "UNPAID" || inv.status === "OVERDUE") acc.totalDue += gross;
      if (inv.status === "OVERDUE") acc.totalOverdue += gross;

      return acc;
    },
    { totalInvoiced: 0, totalPaid: 0, totalDue: 0, totalOverdue: 0 }
  );

  const now = Date.now();
  const nextDueInvoice =
    invoices.find((inv) => {
      if (!(inv.status === "UNPAID" || inv.status === "OVERDUE")) return false;
      if (!inv.dueDate) return false;
      const t = new Date(inv.dueDate).getTime();
      return Number.isFinite(t) && t >= now;
    }) ||
    invoices.find((inv) => inv.status === "UNPAID" || inv.status === "OVERDUE") ||
    null;

  return {
    currency,
    invoiceCount: invoices.length,
    unpaidCount: invoices.filter((inv) => inv.status === "UNPAID" || inv.status === "OVERDUE")
      .length,
    totalInvoiced: round2(totals.totalInvoiced),
    totalPaid: round2(totals.totalPaid),
    totalDue: round2(totals.totalDue),
    totalOverdue: round2(totals.totalOverdue),
    nextDueAt: nextDueInvoice?.dueDate || null,
    nextDueInvoiceId: nextDueInvoice?.id || null,
    nextDueInvoiceNumber: nextDueInvoice?.number || null,
  };
}

// ------------------------------
// 1) SUMMARY
// GET /api/vendor/payouts/summary
// ------------------------------
router.get("/vendor/payouts/summary", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) {
      return res.status(403).json({ error: "not_a_vendor" });
    }

    const [openTotals, billingSummary, lastStatement] = await Promise.all([
      computeOpenLedgerTotals({ vendorId: vendor.id }),
      getVendorBillingSummary({ vendorId: vendor.id }),
      getLastStatement({ vendorId: vendor.id }),
    ]);

    const nextStatementAt = computeNextStatementAt(lastStatement);

    return res.json({
      currency: openTotals.currency,
      currentPeriod: {
        entryCount: openTotals.eligibleCount,
        salesNet: openTotals.itemsNet,
        commissionNet: openTotals.commissionNet,
        vendorNetInformative: openTotals.vendorNet,
        currency: openTotals.currency,
      },
      billing: billingSummary,
      nextStatementAt,
      lastStatement: lastStatement
        ? {
            id: lastStatement.id,
            issuedAt: lastStatement.issuedAt,
            paidAt: lastStatement.paidAt,
            status: lastStatement.status,
            statusLabel: getStatementStatusLabel(lastStatement.status),
            periodFrom: lastStatement.periodFrom,
            periodTo: lastStatement.periodTo,
            totalItemsNet: Number(lastStatement.totalItemsNet || 0),
            totalCommissionNet: Number(lastStatement.totalCommissionNet || 0),
            totalVendorNet: Number(lastStatement.totalVendorNet || 0),
            currency: lastStatement.currency || openTotals.currency,
            invoiceId: lastStatement.invoiceId || null,
          }
        : null,
    });
  } catch (err) {
    console.error("GET /vendor/payouts/summary FAILED:", err);
    return res.status(500).json({
      error: "vendor_billing_summary_failed",
      message: err?.message || "Nu am putut încărca sumarul financiar.",
    });
  }
});

// ------------------------------
// 1b) VENDOR INVOICES
// GET /api/vendors/me/invoices
// ------------------------------
router.get("/vendors/me/invoices", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) {
      return res.status(403).json({ error: "not_a_vendor" });
    }

    const items = await prisma.invoice.findMany({
      where: {
        vendorId: vendor.id,
        direction: "PLATFORM_TO_VENDOR",
      },
      include: { order: true },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });

    const dto = items.map((inv) => ({
      id: inv.id,
      number: inv.number,
      series: inv.series || null,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate || null,
      periodFrom: inv.periodFrom || null,
      periodTo: inv.periodTo || null,
      type: inv.type || "OTHER",
      typeLabel: getInvoiceTypeLabel(inv.type),
      direction: inv.direction,
      directionLabel: getInvoiceDirectionLabel(inv.direction),
      orderId: inv.orderId || null,
      orderNumber: inv.order?.orderNumber || null,
      totalNet: Number(inv.totalNet || 0),
      totalVat: Number(inv.totalVat || 0),
      totalGross: Number(inv.totalGross || 0),
      currency: inv.currency || "RON",
      status: inv.status,
      statusLabel: getInvoiceStatusLabel(inv.status),
      downloadUrl: inv.pdfUrl || `/api/vendors/me/invoices/${inv.id}/pdf`,
    }));

    return res.json({ items: dto });
  } catch (err) {
    console.error("GET /vendors/me/invoices FAILED:", err);
    return res.status(500).json({
      error: "vendor_invoices_failed",
      message: err?.message || "Nu am putut încărca facturile vendorului.",
    });
  }
});

// ------------------------------
// 2) CURRENT PERIOD ENTRIES
// GET /api/vendor/payouts/entries?eligible=true
// ------------------------------
router.get("/vendor/payouts/entries", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) {
      return res.status(403).json({ error: "not_a_vendor" });
    }

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

    const orderNumberById = await getOrderNumberMap(items.map((x) => x.orderId));

    const dto = items.map((e) => ({
      id: e.id,
      type: e.type,
      typeLabel: getEntryTypeLabel(e.type),
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
    return res.status(500).json({
      error: "vendor_billing_entries_failed",
      message: err?.message || "Nu am putut încărca comenzile incluse în calcul.",
    });
  }
});

// ------------------------------
// 3) STATEMENTS HISTORY
// GET /api/vendor/payouts
// ------------------------------
router.get("/vendor/payouts", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) {
      return res.status(403).json({ error: "not_a_vendor" });
    }

    const items = await prisma.vendorPayout.findMany({
      where: { vendorId: vendor.id },
      orderBy: { issuedAt: "desc" },
      take: 100,
      select: {
        id: true,
        periodFrom: true,
        periodTo: true,
        issuedAt: true,
        paidAt: true,
        status: true,
        totalItemsNet: true,
        totalCommissionNet: true,
        totalVendorNet: true,
        currency: true,
        invoiceId: true,
      },
    });

    const dto = items.map((p) => ({
      id: p.id,
      periodFrom: p.periodFrom,
      periodTo: p.periodTo,
      issuedAt: p.issuedAt,
      paidAt: p.paidAt,
      status: p.status,
      statusLabel: getStatementStatusLabel(p.status),
      totalItemsNet: Number(p.totalItemsNet || 0),
      totalCommissionNet: Number(p.totalCommissionNet || 0),
      totalVendorNet: Number(p.totalVendorNet || 0),
      currency: p.currency || "RON",
      invoiceId: p.invoiceId || null,
      pdfUrl: `/api/vendor/payouts/${p.id}/pdf`,
    }));

    return res.json({ items: dto });
  } catch (err) {
    console.error("GET /vendor/payouts FAILED:", err);
    return res.status(500).json({
      error: "vendor_statements_failed",
      message: err?.message || "Nu am putut încărca istoricul situațiilor lunare.",
    });
  }
});

// ------------------------------
// 4) REQUEST PAYOUT
// POST /api/vendor/payouts/request
// ------------------------------
// Business actual:
// vendorul încasează direct banii de la client,
// iar platforma facturează comisionul și abonamentul.
// Prin urmare vendorul NU solicită o plată de la platformă.
router.post("/vendor/payouts/request", authRequired, async (_req, res) => {
  return res.status(410).json({
    error: "payout_request_not_supported",
    message:
      "Vendorul încasează direct comenzile. Platforma nu procesează cereri de plată pentru vendor; această secțiune afișează doar situația comisioanelor și facturile emise.",
  });
});

// ------------------------------
// 5) STATEMENT PDF
// GET /api/vendor/payouts/:id/pdf
// ------------------------------
router.get("/vendor/payouts/:id/pdf", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) {
      return res.status(403).json({ error: "not_a_vendor" });
    }

    const id = String(req.params.id);

    const statement = await prisma.vendorPayout.findFirst({
      where: { id, vendorId: vendor.id },
      select: {
        id: true,
        vendorId: true,
        periodFrom: true,
        periodTo: true,
        issuedAt: true,
        paidAt: true,
        status: true,
        currency: true,
        totalItemsNet: true,
        totalCommissionNet: true,
        totalVendorNet: true,
      },
    });

    if (!statement) {
      return res.status(404).json({ error: "statement_not_found" });
    }

    const entries = await prisma.vendorEarningEntry.findMany({
      where: { vendorId: vendor.id, payoutId: statement.id },
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

    const orderNumberById = await getOrderNumberMap(entries.map((x) => x.orderId));

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

    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const fileName = `Situatie-comision-${statement.id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${fileName.replace(/"/g, "")}"`
    );

    doc.pipe(res);

    doc.fontSize(18).text("SITUAȚIE LUNARĂ COMISIOANE", { align: "right" });
    doc.moveDown(0.5);

    doc.fontSize(10).text(`ID document: ${statement.id}`);
    doc.text(`Status: ${getStatementStatusLabel(statement.status)}`);
    doc.text(
      `Perioadă: ${new Date(statement.periodFrom).toLocaleDateString("ro-RO")} – ${new Date(
        statement.periodTo
      ).toLocaleDateString("ro-RO")}`
    );
    doc.text(
      `Data emiterii: ${new Date(statement.issuedAt).toLocaleString("ro-RO")}`
    );
    if (statement.paidAt) {
      doc.text(`Data plății: ${new Date(statement.paidAt).toLocaleString("ro-RO")}`);
    }
    doc.moveDown(1);

    doc.fontSize(12).text("Date vendor", { underline: true });
    doc.fontSize(10);

    if (billing) {
      doc.text(billing.companyName || "—");
      doc.text(`CUI: ${billing.cui || "—"}`);
      doc.text(`Nr. Reg. Com.: ${billing.regCom || "—"}`);
      doc.text(`Adresă: ${billing.address || "—"}`);
      doc.text(`IBAN: ${billing.iban || "—"}`);
      doc.text(`Banca: ${billing.bank || "—"}`);
    } else {
      doc.text("Date de facturare lipsă.");
    }

    doc.moveDown(1);

    doc.fontSize(12).text("Sumar perioadă", { underline: true });
    doc.fontSize(10);
    doc.text(
      `Valoare produse net: ${formatMoney(
        Number(statement.totalItemsNet || 0),
        statement.currency
      )}`
    );
    doc.text(
      `Comision net datorat platformei: ${formatMoney(
        Number(statement.totalCommissionNet || 0),
        statement.currency
      )}`
    );
    doc.text(
      `Net vendor informativ: ${formatMoney(
        Number(statement.totalVendorNet || 0),
        statement.currency
      )}`
    );

    doc.moveDown(1);

    doc.fontSize(12).text("Comenzi incluse în calcul", { underline: true });
    doc.moveDown(0.5);

    const col = { date: 48, type: 120, order: 210, itemsNet: 360, commission: 450 };
    let y = doc.y;

    function drawTableHeader(atY) {
      doc.fontSize(9);
      doc.text("Data", col.date, atY);
      doc.text("Tip", col.type, atY);
      doc.text("Comandă", col.order, atY);
      doc.text("Net produse", col.itemsNet, atY);
      doc.text("Comision", col.commission, atY);
      doc.moveTo(48, atY + 12).lineTo(560, atY + 12).stroke();
      return atY + 18;
    }

    y = drawTableHeader(y);

    for (const e of entries) {
      if (y > 760) {
        doc.addPage();
        y = drawTableHeader(60);
      }

      const orderNumber = e.orderId ? orderNumberById.get(e.orderId) : null;

      doc.text(new Date(e.occurredAt).toLocaleDateString("ro-RO"), col.date, y);
      doc.text(getEntryTypeLabel(e.type), col.type, y);
      doc.text(orderNumber || e.orderId || "—", col.order, y, { width: 135 });
      doc.text(
        formatMoney(Number(e.itemsNet || 0), e.currency || statement.currency),
        col.itemsNet,
        y
      );
      doc.text(
        formatMoney(Number(e.commissionNet || 0), e.currency || statement.currency),
        col.commission,
        y
      );

      y += 14;
    }

    doc.moveDown(2);
    doc.fontSize(9).text(
      "Acest document reprezintă o situație informativă a comenzilor și comisionului calculat pentru perioadă.",
      48,
      y + 10
    );

    doc.end();
  } catch (err) {
    console.error("GET /vendor/payouts/:id/pdf FAILED:", err);
    return res.status(500).json({
      error: "statement_pdf_failed",
      message: err?.message || "Nu am putut genera PDF-ul situației lunare.",
    });
  }
});

// ------------------------------
// 6) VENDOR INVOICE PDF
// GET /api/vendors/me/invoices/:id/pdf
// ------------------------------
router.get("/vendors/me/invoices/:id/pdf", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) {
      return res.status(403).json({ error: "not_a_vendor" });
    }

    const id = String(req.params.id);

    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        vendorId: vendor.id,
        direction: "PLATFORM_TO_VENDOR",
      },
      include: {
        lines: true,
        order: true,
        vendor: { include: { billing: true } },
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: "invoice_not_found" });
    }

    if (invoice.pdfUrl && /^https?:\/\//i.test(invoice.pdfUrl)) {
      return res.redirect(invoice.pdfUrl);
    }

    const platformBilling = await getPlatformBillingOrThrow();
    const billingProfile = toPlatformBillingProfile(platformBilling);
    const platform = {
      name: "ArtFest",
      supportEmail: platformBilling.email || "support@artfest.ro",
      website: "artfest.ro",
    };

    const html = renderInvoiceHtml({ invoice, billingProfile, platform });
    const pdfBuffer = await htmlToPdfBuffer(html);
    const fileName = `Factura-${invoice.series || "AF"}-${invoice.number || invoice.id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${fileName.replace(/"/g, "")}"`
    );

    return res.send(pdfBuffer);
  } catch (err) {
    console.error("GET /vendors/me/invoices/:id/pdf FAILED:", err);
    return res.status(500).json({
      error: "vendor_invoice_pdf_failed",
      message: err?.message || "Nu am putut genera PDF-ul facturii.",
    });
  }
});

export default router;