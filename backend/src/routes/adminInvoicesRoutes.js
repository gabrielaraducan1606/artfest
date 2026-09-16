// backend/src/routes/adminInvoicesRoutes.js
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import fs from "fs/promises";
import path from "path";

import { htmlToPdfBuffer } from "../lib/htmlToPdf.js";
import { renderInvoiceHtml } from "../lib/invoiceHtmlTemplate.js";
import {
  generateVendorCommissionInvoice,
  getPreviousBucharestMonthBoundaries,
} from "../services/vendorCommissionInvoiceService.js";
import {
  notifyVendorPayoutInvoiceRequested,
  notifyVendorPayoutFiscalDocsRequested,
  buildVendorPayoutPeriodKey,
  VENDOR_PAYOUT_INVOICE_REQUEST_PREFIX,
  VENDOR_PAYOUT_FISCAL_DOCS_REQUEST_PREFIX,
} from "../services/notifications.js";
import {
  sendVendorPayoutInvoiceRequestEmail,
  sendVendorPayoutFiscalDocsRequestEmail,
} from "../lib/mailer.js";

const prisma = new PrismaClient();
const router = express.Router();

/*
 * Clasificare fiscală vendor (audit 2026-09-16, Artfest DATOREAZĂ
 * vendorului) - STRICT pe baza VendorBilling.sellerType, câmp
 * EXISTENT deja, validat la salvare (billingRoutes.js:
 * ALLOWED_SELLER_TYPES=["independent_creator","verified_business"],
 * "verified_business" cere obligatoriu legalType/companyName/cui/
 * regCom/vatStatus - "independent_creator" NU cere niciunul din
 * astea). NU inventăm niciun proxy nou - dacă billing lipsește sau
 * sellerType nu e una din cele două valori cunoscute, întoarcem
 * explicit UNKNOWN (fail-closed pentru trimiterea cererii, NU
 * presupunem nimic despre capacitatea fiscală a vendorului).
 */
const LEGAL_TYPE_LABELS = {
  SRL: "SRL",
  PFA: "PFA",
  II: "Întreprindere Individuală",
  IF: "Întreprindere Familială",
};

function classifyVendorFiscalType(billing) {
  if (!billing || !billing.sellerType) {
    return { category: "UNKNOWN", label: null };
  }

  if (billing.sellerType === "verified_business") {
    return {
      category: "LEGAL_ENTITY",
      label: LEGAL_TYPE_LABELS[billing.legalType] || "Persoană juridică",
    };
  }

  if (billing.sellerType === "independent_creator") {
    return {
      category: "INDEPENDENT_PF",
      label: "Persoană fizică (fără formă juridică)",
    };
  }

  return { category: "UNKNOWN", label: null };
}

/* ---------------------------
   Attach req.user from token
---------------------------- */
router.use(async (req, _res, next) => {
  try {
    const cookieToken = req.cookies?.token || req.cookies?.access_token;
    const hdr = req.headers?.authorization || "";
    const headerToken = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    const token = cookieToken || headerToken;
    if (!token) return next();

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true },
    });

    if (user) req.user = user;
  } catch {
    // ignore
  }
  next();
});

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function money2(n) {
  const v = Number(n || 0);
  return Math.round(v * 100) / 100;
}

function computeTotals(lines) {
  const totalNet = money2(lines.reduce((s, l) => s + Number(l.totalNet || 0), 0));
  const totalVat = money2(lines.reduce((s, l) => s + Number(l.totalVat || 0), 0));
  const totalGross = money2(lines.reduce((s, l) => s + Number(l.totalGross || 0), 0));
  return { totalNet, totalVat, totalGross };
}

function isDelivered(order) {
  const allDelivered =
    (order.shipments || []).length > 0 &&
    (order.shipments || []).every((s) => s.status === "DELIVERED");
  return order.status === "FULFILLED" || allDelivered;
}

async function getPlatformBillingOrThrow() {
  const platform = await prisma.platformBilling.findUnique({ where: { id: "platform" } });
  if (!platform) {
    const err = new Error("PLATFORM_BILLING_MISSING");
    err.code = "PLATFORM_BILLING_MISSING";
    throw err;
  }
  return platform;
}

async function getPlatformVendorIdOrThrow() {
  const v = await prisma.vendor.findUnique({ where: { id: "platform" }, select: { id: true } });
  if (!v) {
    const err = new Error("PLATFORM_VENDOR_MISSING");
    err.code = "PLATFORM_VENDOR_MISSING";
    throw err;
  }
  return v.id;
}

function resolveClient(order) {
  const addr = order.shippingAddress || {};
  const clientName =
    addr?.name ||
    order.user?.name ||
    [order.user?.firstName, order.user?.lastName].filter(Boolean).join(" ") ||
    "Client";

  const clientEmail = addr?.email || order.user?.email || null;
  const clientPhone = addr?.phone || order.user?.phone || null;
  const clientAddress =
    addr?.address ||
    [addr?.street, addr?.city, addr?.county, addr?.postalCode].filter(Boolean).join(", ") ||
    null;

  return { clientName, clientEmail, clientPhone, clientAddress };
}

function buildLinesFromShipments(order, vatRate) {
  const linesDraft = [];

  for (const sh of order.shipments || []) {
    for (const it of sh.items || []) {
      const unitNet = money2(it.price);
      const qty = Number(it.qty || 1);

      const totalNet = money2(unitNet * qty);
      const totalVat = money2((totalNet * Number(vatRate || 0)) / 100);
      const totalGross = money2(totalNet + totalVat);

      linesDraft.push({
        type: "PRODUCT",
        description: it.title,
        quantity: qty,
        unitNet,
        vatRate: money2(vatRate),
        totalNet,
        totalVat,
        totalGross,
        vendorId: sh.vendorId || null,
        productId: it.productId || null,
        orderItemId: it.id || null,
      });
    }
  }

  if (linesDraft.length === 0) {
    const totalNet = money2(order.total);
    const totalVat = money2((totalNet * Number(vatRate || 0)) / 100);
    const totalGross = money2(totalNet + totalVat);

    linesDraft.push({
      type: "OTHER",
      description: `Comandă ${order.orderNumber}`,
      quantity: 1,
      unitNet: totalNet,
      vatRate: money2(vatRate),
      totalNet,
      totalVat,
      totalGross,
      vendorId: null,
      productId: null,
      orderItemId: null,
    });
  }

  return linesDraft;
}

/* ---------------------------
   PDF helpers
---------------------------- */
function toBillingProfileFromPlatform(platform, vatRate = 0) {
  return {
    vendorName: "ArtFest",
    companyName: platform.companyName,
    legalType: platform.legalType,
    cui: platform.cui,
    regCom: platform.regCom,
    address: platform.address,
    iban: platform.iban,
    bank: platform.bank,
    email: platform.email,
    phone: platform.phone,
    contactPerson: "",
    vatStatus: platform.vatPayer ? "payer" : "non_payer",
    vatRate: Number(vatRate || 0),
  };
}

function getPlatformMeta() {
  return {
    name: "ArtFest",
    supportEmail: "support@artfest.ro",
    website: "artfest.ro",
  };
}

async function savePdfAndGetUrl(invoice, billingProfile, platformMeta) {
  const html = renderInvoiceHtml({ invoice, billingProfile, platform: platformMeta });
  const pdfBuffer = await htmlToPdfBuffer(html);

  const dir = path.join(process.cwd(), "uploads", "invoices");
  await fs.mkdir(dir, { recursive: true });

  const safeSeries = invoice.series || "FA";
  const safeNumber = invoice.number || invoice.id;
  const fileName = `${safeSeries}-${safeNumber}.pdf`;

  const absPath = path.join(dir, fileName);
  await fs.writeFile(absPath, pdfBuffer);

  return `/uploads/invoices/${fileName}`;
}

/* =========================================================
   1) GET /api/admin/billing/to-invoice
========================================================= */
router.get("/billing/to-invoice", requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "20", 10)));

    const deliveredWhere = {
      OR: [{ status: "FULFILLED" }, { shipments: { every: { status: "DELIVERED" } } }],
    };

    const qWhere = q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { orderNumber: { contains: q, mode: "insensitive" } },
            {
              user: {
                is: {
                  OR: [
                    { email: { contains: q, mode: "insensitive" } },
                    { name: { contains: q, mode: "insensitive" } },
                    { firstName: { contains: q, mode: "insensitive" } },
                    { lastName: { contains: q, mode: "insensitive" } },
                    { phone: { contains: q, mode: "insensitive" } },
                  ],
                },
              },
            },
          ],
        }
      : null;

    const where = {
      ...deliveredWhere,
      invoices: { none: { direction: "PLATFORM_TO_CLIENT" } },
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: endOfDay(to) } : {}),
            },
          }
        : {}),
      ...(qWhere ? qWhere : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          createdAt: true,
          total: true,
          currency: true,
          paymentMethod: true,
          shippingAddress: true,
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
          shipments: { select: { id: true, status: true, awb: true, courierProvider: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    const items = (rows || []).map((o) => {
      const addr = o.shippingAddress || {};
      const customerName =
        addr?.name ||
        o.user?.name ||
        [o.user?.firstName, o.user?.lastName].filter(Boolean).join(" ") ||
        "";

      return {
        orderId: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        createdAt: o.createdAt,
        total: o.total,
        currency: o.currency,
        paymentMethod: o.paymentMethod,
        customerName,
        customerEmail: addr?.email || o.user?.email || "",
        customerPhone: addr?.phone || o.user?.phone || "",
        customerCity: addr?.city || "",
        customerAddress:
          addr?.address ||
          [addr?.street, addr?.city, addr?.county, addr?.postalCode].filter(Boolean).join(", "),
        shipments: (o.shipments || []).map((s) => ({
          shipmentId: s.id,
          status: s.status,
          awb: s.awb,
          courierProvider: s.courierProvider,
        })),
      };
    });

    return res.json({ total, items });
  } catch (err) {
    console.error("GET /api/admin/billing/to-invoice FAILED:", err);
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "Internal Server Error",
    });
  }
});

/* =========================================================
   2) GET /api/admin/invoices
========================================================= */
router.get("/invoices", requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();
    const direction = String(req.query.direction || "PLATFORM_TO_VENDOR").trim();
    const type = String(req.query.type || "").trim();
    const provider = String(req.query.provider || "").trim();

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "20", 10)));

    const qWhere = q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { number: { contains: q, mode: "insensitive" } },
            { series: { contains: q, mode: "insensitive" } },
            { orderId: { contains: q, mode: "insensitive" } },
            { clientName: { contains: q, mode: "insensitive" } },
            { clientEmail: { contains: q, mode: "insensitive" } },
            { providerSeries: { contains: q, mode: "insensitive" } },
            { providerNumber: { contains: q, mode: "insensitive" } },
          ],
        }
      : null;

    const where = {
      direction,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(provider ? { provider } : {}),
      ...(from || to
        ? {
            issueDate: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: endOfDay(to) } : {}),
            },
          }
        : {}),
      ...(qWhere ? qWhere : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { issueDate: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderId: true,
          direction: true,
          type: true,
          series: true,
          number: true,
          issueDate: true,
          dueDate: true,
          currency: true,
          totalNet: true,
          totalVat: true,
          totalGross: true,
          status: true,
          pdfUrl: true,
          paymentUrl: true,
          clientName: true,
          clientEmail: true,
          clientPhone: true,
          provider: true,
          providerInvoiceId: true,
          providerSeries: true,
          providerNumber: true,
          providerStatus: true,
          providerPdfUrl: true,
          providerSyncedAt: true,
          paidAt: true,
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    return res.json({ total, items: rows || [] });
  } catch (err) {
    console.error("GET /api/admin/invoices FAILED:", err);
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "Internal Server Error",
    });
  }
});

/* =========================================================
   3) GET /api/admin/invoices/:id
========================================================= */
router.get("/invoices/:id", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);

    const inv = await prisma.invoice.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!inv) return res.status(404).json({ error: "not_found" });

    return res.json({ invoice: inv, lines: inv.lines || [] });
  } catch (err) {
    console.error("GET /api/admin/invoices/:id FAILED:", err);
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "Internal Server Error",
    });
  }
});

/* =========================================================
   3.5) GET /api/admin/billing/preview-invoice-from-order
========================================================= */
router.get("/billing/preview-invoice-from-order", requireAdmin, async (req, res) => {
  try {
    const orderId = String(req.query.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "missing_orderId" });

    const vatRate = req.query.vatRate != null ? Number(req.query.vatRate) : 0;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        shipments: { include: { items: true } },
        user: true,
      },
    });
    if (!order) return res.status(404).json({ error: "order_not_found" });

    const platform = await getPlatformBillingOrThrow();

    const delivered = isDelivered(order);
    const { clientName, clientEmail, clientPhone, clientAddress } = resolveClient(order);

    const lines = buildLinesFromShipments(order, vatRate);
    const totals = computeTotals(lines);

    const nextSeq = Number(platform.lastInvoiceSeq || 0) + 1;
    const series = platform.invoiceSeries || "AF";
    const number = String(nextSeq).padStart(6, "0");

    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 14);

    return res.json({
      ok: true,
      meta: {
        delivered,
        willCreate: delivered,
        willCreateNumber: `${series}${number}`,
      },
      issuer: {
        companyName: platform.companyName,
        legalType: platform.legalType,
        cui: platform.cui,
        regCom: platform.regCom,
        address: platform.address,
        iban: platform.iban,
        bank: platform.bank,
        email: platform.email,
        phone: platform.phone,
        vatPayer: platform.vatPayer,
      },
      draft: {
        direction: "PLATFORM_TO_CLIENT",
        status: "DRAFT",
        series,
        number,
        issueDate,
        dueDate,
        currency: order.currency || "RON",
        clientName,
        clientEmail,
        clientPhone,
        clientAddress,
        totals,
        lines: lines.map((l) => ({
          type: l.type,
          description: l.description,
          quantity: l.quantity,
          unitNet: l.unitNet,
          vatRate: l.vatRate,
          totalNet: l.totalNet,
          totalVat: l.totalVat,
          totalGross: l.totalGross,
        })),
        notes: `Comandă ${order.orderNumber || order.id}`,
      },
    });
  } catch (err) {
    console.error("GET /billing/preview-invoice-from-order FAILED:", err);
    const code = err?.code;
    if (code === "PLATFORM_BILLING_MISSING") {
      return res.status(409).json({
        error: "PLATFORM_BILLING_MISSING",
        message: "Lipsește PlatformBilling (id='platform').",
      });
    }
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "Internal Server Error",
    });
  }
});

/* =========================================================
   4) POST /api/admin/billing/create-invoice-from-order
========================================================= */
const CreateFromOrderPayload = z.object({
  orderId: z.string().min(6),
  vatRate: z.number().min(0).max(100).optional(),
  series: z.string().trim().min(1).max(16).optional(),
});

router.post("/billing/create-invoice-from-order", requireAdmin, async (req, res) => {
  try {
    const { orderId, vatRate = 0, series } = CreateFromOrderPayload.parse(req.body || {});

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        invoices: true,
        shipments: { include: { items: true } },
        user: true,
      },
    });
    if (!order) return res.status(404).json({ error: "order_not_found" });

    const delivered = isDelivered(order);
    if (!delivered) {
      return res.status(409).json({
        error: "ORDER_NOT_DELIVERED",
        message: "Comanda nu este livrată încă. Factura se poate crea doar după DELIVERED.",
      });
    }

    const existing = (order.invoices || []).find((x) => x.direction === "PLATFORM_TO_CLIENT");
    if (existing) {
      return res.status(409).json({
        error: "INVOICE_EXISTS",
        invoiceId: existing.id,
        message: "Există deja o factură PLATFORM_TO_CLIENT pentru această comandă.",
      });
    }

    const platform = await getPlatformBillingOrThrow();
    const platformVendorId = await getPlatformVendorIdOrThrow();

    const { clientName, clientEmail, clientPhone, clientAddress } = resolveClient(order);
    const linesDraft = buildLinesFromShipments(order, vatRate);
    const totals = computeTotals(linesDraft);

    const created = await prisma.$transaction(async (tx) => {
      const updatedPlatform = await tx.platformBilling.update({
        where: { id: "platform" },
        data: { lastInvoiceSeq: { increment: 1 }, updatedAt: new Date() },
      });

      const seq = updatedPlatform.lastInvoiceSeq;
      const finalSeries = series || platform.invoiceSeries || "AF";
      const number = String(seq).padStart(6, "0");

      const issueDate = new Date();
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + 14);

      const inv = await tx.invoice.create({
        data: {
          vendorId: platformVendorId,
          direction: "PLATFORM_TO_CLIENT",
          type: "OTHER",
          orderId: order.id,
          series: finalSeries,
          number,
          issueDate,
          dueDate,
          currency: order.currency || "RON",
          clientName,
          clientEmail,
          clientPhone,
          clientAddress,
          totalNet: totals.totalNet,
          totalVat: totals.totalVat,
          totalGross: totals.totalGross,
          status: "UNPAID",
          pdfUrl: null,
          lines: {
            create: linesDraft.map((l) => ({
              type: l.type,
              description: l.description,
              quantity: l.quantity,
              unitNet: l.unitNet,
              vatRate: l.vatRate,
              totalNet: l.totalNet,
              totalVat: l.totalVat,
              totalGross: l.totalGross,
              vendorId: l.vendorId,
              orderItemId: l.orderItemId,
              productId: l.productId,
            })),
          },
        },
        include: { lines: true },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { invoiceNumber: `${finalSeries}${number}`, invoiceDate: issueDate },
      });

      return inv;
    });

    const billingProfile = toBillingProfileFromPlatform(platform, vatRate);
    const platformMeta = getPlatformMeta();
    const pdfUrl = await savePdfAndGetUrl(created, billingProfile, platformMeta);

    const updated = await prisma.invoice.update({
      where: { id: created.id },
      data: { pdfUrl },
      include: { lines: true },
    });

    return res.json({ ok: true, invoice: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid_payload", details: err.errors });
    }
    console.error("POST /api/admin/billing/create-invoice-from-order FAILED:", err);
    if (err?.code === "PLATFORM_BILLING_MISSING") {
      return res.status(409).json({
        error: "PLATFORM_BILLING_MISSING",
        message: "Lipsește PlatformBilling (id='platform').",
      });
    }
    if (err?.code === "PLATFORM_VENDOR_MISSING") {
      return res.status(409).json({
        error: "PLATFORM_VENDOR_MISSING",
        message: "Lipsește Vendor-ul platformei (id='platform'). Rulează seed-ul.",
      });
    }
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "Internal Server Error",
    });
  }
});

/* =========================================================
   5) GET /api/admin/invoices/:id/pdf
========================================================= */
router.get("/invoices/:id/pdf", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);

    const inv = await prisma.invoice.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!inv) {
      return res.status(404).json({ error: "not_found" });
    }

    // Facturi Stripe: PDF-ul este URL extern, nu fișier local
    if (inv.provider === "STRIPE" && inv.providerPdfUrl) {
      return res.redirect(inv.providerPdfUrl);
    }

    if (inv.provider === "STRIPE" && inv.paymentUrl) {
      return res.redirect(inv.paymentUrl);
    }

    // PDF SmartBill/local salvat local
    if (inv.providerPdfUrl) {
      const absPath = path.join(process.cwd(), inv.providerPdfUrl.replace(/^\//, ""));

      try {
        await fs.access(absPath);
        return res.sendFile(absPath);
      } catch {
        console.warn("PDF local missing:", absPath);
      }
    }

    if (inv.pdfUrl) {
      const absPath = path.join(process.cwd(), inv.pdfUrl.replace(/^\//, ""));

      try {
        await fs.access(absPath);
        return res.sendFile(absPath);
      } catch {
        console.warn("PDF local missing:", absPath);
      }
    }

    const platform = await getPlatformBillingOrThrow();
    const billingProfile = toBillingProfileFromPlatform(platform, 0);
    const platformMeta = getPlatformMeta();

    const html = renderInvoiceHtml({
      invoice: inv,
      billingProfile,
      platform: platformMeta,
    });

    const pdf = await htmlToPdfBuffer(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${inv.series || "FA"}-${inv.number || inv.id}.pdf"`
    );

    return res.send(pdf);
  } catch (err) {
    console.error("GET /api/admin/invoices/:id/pdf FAILED:", err);

    return res.status(500).json({
      error: "server_error",
      message: err?.message || "Internal Server Error",
    });
  }
});

/* =========================================================
   6) GET /api/admin/billing/vendors-due
========================================================= */
router.get("/billing/vendors-due", requireAdmin, async (_req, res) => {
  try {
    const vendors = await prisma.vendor.findMany({
      where: { isActive: true },
      select: {
        id: true,
        displayName: true,
        email: true,
        user: {
          select: {
            email: true,
          },
        },
        billing: {
          select: {
            sellerType: true,
            legalType: true,
            companyName: true,
            vendorName: true,
            cui: true,
            regCom: true,
            address: true,
            email: true,
            contactPerson: true,
            phone: true,
            vatStatus: true,
          },
        },
        earningEntries: {
          where: {
            payoutId: null,
            type: { in: ["SALE", "REFUND", "ADJUSTMENT"] },
          },
          select: {
            id: true,
            currency: true,
            itemsNet: true,
            commissionNet: true,
            vendorNet: true,
            occurredAt: true,
          },
        },
        invoices: {
          where: {
            direction: "PLATFORM_TO_VENDOR",
            status: { in: ["UNPAID", "OVERDUE"] },
          },
          select: {
            id: true,
            number: true,
            providerSeries: true,
            providerNumber: true,
            totalGross: true,
            dueDate: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    /*
     * Status "Factură solicitată" / "Documente solicitate" (audit
     * 2026-09-16, verificare finală) - derivat STRICT din date deja
     * existente (Notification.dedupeKey + createdAt, EmailLog),
     * FĂRĂ niciun câmp nou în Prisma. Perioada e ACEEAȘI folosită la
     * trimiterea cererii (getPreviousBucharestMonthBoundaries) - un
     * vendor cu cerere pentru luna trecută NU apare "deja solicitat"
     * luna curentă (dedupeKey diferă pe periodKey).
     */
    const payoutPeriod = getPreviousBucharestMonthBoundaries();
    const payoutPeriodKey = buildVendorPayoutPeriodKey(payoutPeriod.periodFrom, payoutPeriod.periodTo);

    const relevantVendorIds = vendors.filter((v) => v.id !== "platform").map((v) => v.id);
    const payoutDedupeKeys = relevantVendorIds.flatMap((id) => [
      `${VENDOR_PAYOUT_INVOICE_REQUEST_PREFIX}:${id}:${payoutPeriodKey}`,
      `${VENDOR_PAYOUT_FISCAL_DOCS_REQUEST_PREFIX}:${id}:${payoutPeriodKey}`,
    ]);

    const payoutNotifications = payoutDedupeKeys.length
      ? await prisma.notification.findMany({
          where: { dedupeKey: { in: payoutDedupeKeys } },
          select: { vendorId: true, dedupeKey: true, createdAt: true },
        })
      : [];

    const payoutNotificationByVendorId = new Map(
      payoutNotifications.map((n) => [n.vendorId, n])
    );

    /*
     * Status email (audit 2026-09-16) - corelat STRICT prin date deja
     * existente (EmailLog.template + toEmail + createdAt aproape de
     * cel al notificării - NU există FK direct Notification<->EmailLog,
     * dar ordinea de scriere e garantată: notificarea se creează
     * ÎNAINTE de trimiterea emailului, în același request). Doar
     * pentru vendorii cu o cerere deja făcută - nu interogăm EmailLog
     * pentru restul.
     */
    const payoutEmailStatusByVendorId = new Map();

    await Promise.all(
      payoutNotifications.map(async (n) => {
        const vendorRow = vendors.find((v) => v.id === n.vendorId);
        const toEmail = vendorRow?.billing?.email || vendorRow?.email || vendorRow?.user?.email || null;
        if (!toEmail) return;

        const template = n.dedupeKey.startsWith(`${VENDOR_PAYOUT_INVOICE_REQUEST_PREFIX}:`)
          ? "vendor_payout_invoice_request"
          : "vendor_payout_fiscal_docs_request";

        const emailLog = await prisma.emailLog.findFirst({
          where: {
            template,
            toEmail,
            createdAt: { gte: new Date(n.createdAt.getTime() - 5000) },
          },
          orderBy: { createdAt: "asc" },
          select: { status: true, error: true },
        });

        if (emailLog) {
          payoutEmailStatusByVendorId.set(n.vendorId, emailLog);
        }
      })
    );

    const items = vendors
      .filter((v) => v.id !== "platform")
      .map((v) => {
        const currency = v.earningEntries[0]?.currency || "RON";
        const entryCount = v.earningEntries.length;
        const commissionNet = money2(
          v.earningEntries.reduce((sum, e) => sum + Number(e.commissionNet || 0), 0)
        );
        const totalSalesNet = money2(
          v.earningEntries.reduce((sum, e) => sum + Number(e.itemsNet || 0), 0)
        );
        const vendorNet = money2(
          v.earningEntries.reduce((sum, e) => sum + Number(e.vendorNet || 0), 0)
        );
        const unpaidGross = money2(
          v.invoices.reduce((sum, inv) => sum + Number(inv.totalGross || 0), 0)
        );

        const payoutNotification = payoutNotificationByVendorId.get(v.id) || null;
        const payoutEmailLog = payoutEmailStatusByVendorId.get(v.id) || null;

        const payoutRequestStatus = payoutNotification
          ? {
              type: payoutNotification.dedupeKey.startsWith(`${VENDOR_PAYOUT_INVOICE_REQUEST_PREFIX}:`)
                ? "INVOICE"
                : "FISCAL_DOCS",
              requestedAt: payoutNotification.createdAt,
              emailStatus: payoutEmailLog?.status || null,
              emailError: payoutEmailLog?.error || null,
            }
          : null;

        return {
          vendorId: v.id,
          displayName: v.displayName,
          email: v.billing?.email || v.email || v.user?.email || null,
          billing: v.billing,
          fiscalType: classifyVendorFiscalType(v.billing),
          payoutRequestStatus,
          entryCount,
          currency,
          totalSalesNet,
          commissionNet,
          vendorNet,
          alreadyUnpaidGross: unpaidGross,
          unpaidInvoices: v.invoices.map((inv) => ({
            id: inv.id,
            number:
              inv.providerSeries && inv.providerNumber
                ? `${inv.providerSeries}-${inv.providerNumber}`
                : inv.number,
            totalGross: Number(inv.totalGross || 0),
            dueDate: inv.dueDate,
            status: inv.status,
          })),
          canInvoice: entryCount > 0 && commissionNet > 0 && !!v.billing,
          missingBilling: !v.billing,
        };
      })
      .filter((x) => x.entryCount > 0 || x.alreadyUnpaidGross > 0);

    return res.json({ total: items.length, items });
  } catch (err) {
    console.error("GET /api/admin/billing/vendors-due FAILED:", err);
    return res.status(500).json({
      error: "vendors_due_failed",
      message: err?.message || "Nu am putut încărca sumele datorate de vendori.",
    });
  }
});

const RequestVendorPayoutPayload = z.object({
  vendorId: z.string().min(6),
  amount: z.number(),
  currency: z.string().trim().min(1).max(8).default("RON"),
});

/* =========================================================
   6.4) POST /api/admin/billing/request-vendor-payout
   (audit 2026-09-16, Artfest DATOREAZĂ vendorului)

   STRICT o notificare + un email - NU:
   - payout automat;
   - modificare ledger (VendorEarningEntry/VendorPayout neatinse);
   - SmartBill;
   - schimbare de sold.

   Fiscal type decis STRICT server-side, din VendorBilling.sellerType
   FRESH din DB (NU se are încredere în ce trimite clientul) - dacă
   tipul fiscal nu e cunoscut (billing lipsă sau sellerType gol),
   respinge explicit cu 409 "fiscal_type_unknown" - NU trimite nimic,
   NU presupune că poate emite factură.

   Idempotent: notifyVendor...Requested foloseste dedupeKey unic pe
   vendor+interval+tip cerere (Notification.dedupeKey e @unique în
   Prisma, deja existent) - a doua cerere pentru ACELAȘI interval
   întoarce `null` (P2002 înghițit de createVendorNotification), caz
   în care NU se mai trimite nici emailul (altfel ar duplica emailul
   chiar dacă notificarea in-app e deduplicată).

   PERIOADA (audit 2026-09-16, fix găsit la verificarea finală):
   NU se mai ia din body-ul clientului - se calculează STRICT
   server-side, cu ACEEAȘI funcție (getPreviousBucharestMonthBoundaries)
   folosită și de statusul afișat mai jos (GET /billing/vendors-due) -
   altfel un dedupeKey calculat din limite de lună ușor diferite
   (fus orar/rotunjire pe client) ar putea să nu se mai potrivească
   niciodată cu statusul căutat ulterior.
========================================================= */
router.post("/billing/request-vendor-payout", requireAdmin, async (req, res) => {
  try {
    const parsed = RequestVendorPayoutPayload.parse(req.body || {});
    const { vendorId, amount, currency } = parsed;
    const { periodFrom, periodTo } = getPreviousBucharestMonthBoundaries();

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        billing: { select: { sellerType: true, legalType: true, email: true } },
        user: { select: { email: true } },
      },
    });

    if (!vendor) return res.status(404).json({ error: "vendor_not_found" });

    const fiscalType = classifyVendorFiscalType(vendor.billing);

    if (fiscalType.category === "UNKNOWN") {
      return res.status(409).json({
        error: "fiscal_type_unknown",
        message: "Tipul fiscal al vendorului nu este cunoscut sau nu este complet. Verifică datele fiscale înainte de a trimite o solicitare.",
      });
    }

    const periodLabel = `${periodFrom.toLocaleDateString("ro-RO")} - ${periodTo.toLocaleDateString("ro-RO")}`;
    const to = vendor.billing?.email || vendor.email || vendor.user?.email || null;

    let notification = null;
    let emailSent = false;

    if (fiscalType.category === "LEGAL_ENTITY") {
      notification = await notifyVendorPayoutInvoiceRequested(vendorId, {
        periodFrom,
        periodTo,
        amount,
        currency,
      });

      if (notification && to) {
        try {
          await sendVendorPayoutInvoiceRequestEmail({
            to,
            vendorName: vendor.displayName,
            periodLabel,
            amount,
            currency,
          });
          emailSent = true;
        } catch (emailErr) {
          /*
           * Non-fatal, IDENTIC ca strategie cu
           * vendorCommissionInvoiceService.js (emailErr nu anulează
           * factura deja creată) - notificarea in-app (sursa
           * "oficială" a cererii, deja creată mai sus) rămâne
           * valabilă chiar dacă providerul de email eșuează temporar.
           */
          console.error("[adminInvoices] sendVendorPayoutInvoiceRequestEmail FAILED:", emailErr);
        }
      }
    } else {
      notification = await notifyVendorPayoutFiscalDocsRequested(vendorId, {
        periodFrom,
        periodTo,
        amount,
        currency,
      });

      if (notification && to) {
        try {
          await sendVendorPayoutFiscalDocsRequestEmail({
            to,
            vendorName: vendor.displayName,
            periodLabel,
            amount,
            currency,
          });
          emailSent = true;
        } catch (emailErr) {
          console.error("[adminInvoices] sendVendorPayoutFiscalDocsRequestEmail FAILED:", emailErr);
        }
      }
    }

    return res.json({
      ok: true,
      fiscalType: fiscalType.category,
      alreadyRequested: !notification,
      emailSent,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid_payload", details: err.errors });
    }

    console.error("POST /api/admin/billing/request-vendor-payout FAILED:", err);
    return res.status(500).json({
      error: "request_vendor_payout_failed",
      message: err?.message || "Nu am putut trimite solicitarea către vendor.",
    });
  }
});

/* =========================================================
   6.5) GET /api/admin/billing/vendor-commission-breakdown
   (audit 2026-09-15, Admin Billing - transparență comision)

   STRICT READ-ONLY - NU calculează nimic financiar nou. Citește
   EXCLUSIV ce e deja scris în ledger la DELIVERED/RETURNED/REFUSED
   (VendorEarningEntry / VendorReferralEarningEntry /
   InfluencerEarningEntry, create în vendorOrdersRoutes.js) - aceeași
   sursă folosită de generateVendorCommissionInvoice (comisionul
   FACTURAT vendorului) și de Admin Order Details
   (buildShipmentFinancialsForAdmin, adminOrdersRoutes.js). Nici o
   valoare de aici NU poate diferi de acele două surse pentru
   aceeași perioadă/shipment - dacă diferă, e bug, nu feature nou.

   Reconciliere SALE + REFUND (regulă EXISTENTĂ, neschimbată):
   - VendorEarningEntry(REFUND) are shipmentId=null (coloana e
     @unique), legătura la shipment-ul original e prin
     meta.refShipmentId - vezi ensureRefundLedgerEntry.
   - VendorReferralEarningEntry/InfluencerEarningEntry(REFUND) au
     aceeași convenție. earningNet e deja SEMNAT (SALE pozitiv,
     REFUND negativ) - SUM simplu netește corect (identic cu
     influencerPayoutService.js / getVendorReferralConfirmedTotals).

   "Artfest net final" per shipment = commissionNet (facturat
   vendorului, NESCHIMBAT de promoter) - promoterEarningNet (SALE+
   REFUND netate) - EXACT formula deja folosită în
   vendorFinancials.netArtfestAfterAttribution (adminOrdersRoutes.js),
   nu o formulă nouă.
========================================================= */
router.get("/billing/vendor-commission-breakdown", requireAdmin, async (req, res) => {
  try {
    const vendorId = String(req.query.vendorId || "").trim();
    if (!vendorId) {
      return res.status(400).json({ error: "missing_vendorId" });
    }

    const periodFrom = req.query.periodFrom ? new Date(String(req.query.periodFrom)) : null;
    const periodTo = req.query.periodTo ? new Date(String(req.query.periodTo)) : null;

    if (!periodFrom || !periodTo || Number.isNaN(periodFrom.getTime()) || Number.isNaN(periodTo.getTime())) {
      return res.status(400).json({ error: "invalid_period" });
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, displayName: true },
    });
    if (!vendor) return res.status(404).json({ error: "vendor_not_found" });

    const entries = await prisma.vendorEarningEntry.findMany({
      where: {
        vendorId,
        type: { in: ["SALE", "REFUND", "ADJUSTMENT"] },
        occurredAt: { gte: periodFrom, lt: periodTo },
      },
      orderBy: { occurredAt: "asc" },
    });

    const saleEntries = entries.filter((e) => e.type === "SALE" && e.shipmentId);
    const adjustmentEntries = entries.filter((e) => e.type === "ADJUSTMENT");

    const refundByOriginalShipmentId = new Map();
    for (const e of entries) {
      const refShipmentId = e.type === "REFUND" ? e?.meta?.refShipmentId : null;
      if (refShipmentId) refundByOriginalShipmentId.set(refShipmentId, e);
    }

    const currency = entries[0]?.currency || "RON";
    const shipmentIds = saleEntries.map((e) => e.shipmentId);
    const orderIds = [...new Set(saleEntries.map((e) => e.orderId).filter(Boolean))];

    const [shipments, referralEntries, influencerEntries] = await Promise.all([
      prisma.shipment.findMany({
        where: { id: { in: shipmentIds } },
        select: {
          id: true,
          orderId: true,
          order: { select: { orderNumber: true } },
          campaignId: true,
          referrerVendorId: true,
          referrerVendor: { select: { id: true, displayName: true } },
          referrerVendorCommissionBpsSnapshot: true,
          referrerVendorReferralCodeSnapshot: true,
          influencerId: true,
          influencer: { select: { id: true, displayName: true } },
          influencerCommissionBpsSnapshot: true,
        },
      }),
      orderIds.length
        ? prisma.vendorReferralEarningEntry.findMany({ where: { orderId: { in: orderIds } } })
        : Promise.resolve([]),
      orderIds.length
        ? prisma.influencerEarningEntry.findMany({ where: { orderId: { in: orderIds } } })
        : Promise.resolve([]),
    ]);

    const shipmentById = new Map(shipments.map((s) => [s.id, s]));

    /*
     * Netează SALE + REFUND pentru un promoter (vendor referral SAU
     * influencer) pe un shipment dat - identic ca strategie cu
     * getVendorReferralConfirmedTotals/influencerPayoutService.js
     * (SUM(earningNet), REFUND deja negativ).
     */
    function netPromoterEarningForShipment(list, shipmentId) {
      let sum = 0;
      for (const e of list) {
        if (e.type === "SALE" && e.shipmentId === shipmentId) {
          sum += Number(e.earningNet || 0);
        } else if (e.type === "REFUND" && e?.meta?.refShipmentId === shipmentId) {
          sum += Number(e.earningNet || 0);
        }
      }
      return money2(sum);
    }

    function attributionSourceLabel(snapshot) {
      if (typeof snapshot === "string" && snapshot.startsWith("COLLECTION:")) {
        return { source: "VENDOR_COLLECTION_REFERRAL", collectionSlug: snapshot.slice("COLLECTION:".length) || null };
      }
      return { source: "VENDOR_REFERRAL", collectionSlug: null };
    }

    const COMMISSION_SOURCE_LABELS = {
      plan: "Comenzi normale (plan standard)",
      vendor_referral_own_sale: "Vendor own-sale (cod personal)",
      vendor_collection_own_sale: "VendorCollection own-sale",
      campaign: "Campanie vendor",
      mixed: "Comision mixt",
    };

    const shipmentRows = [];
    const bySourceMap = new Map();

    function addToBySource(commissionSourceKey, row) {
      const key = commissionSourceKey || "plan";
      if (!bySourceMap.has(key)) {
        bySourceMap.set(key, {
          source: key,
          label: COMMISSION_SOURCE_LABELS[key] || key,
          count: 0,
          commissionGross: 0,
          platformSubsidyAmount: 0,
          commissionNet: 0,
        });
      }
      const bucket = bySourceMap.get(key);
      bucket.count += 1;
      bucket.commissionGross = money2(bucket.commissionGross + row.commissionGross);
      bucket.platformSubsidyAmount = money2(bucket.platformSubsidyAmount + row.platformSubsidyAmount);
      bucket.commissionNet = money2(bucket.commissionNet + row.commissionNetBilled);
    }

    const promoterBreakdown = {
      VENDOR_REFERRAL: { count: 0, artfestCommissionNet: 0, earningNet: 0 },
      VENDOR_COLLECTION_REFERRAL: { count: 0, artfestCommissionNet: 0, earningNet: 0 },
      INFLUENCER: { count: 0, artfestCommissionNet: 0, earningNet: 0 },
    };

    for (const sale of saleEntries) {
      const shipment = shipmentById.get(sale.shipmentId);
      const refund = refundByOriginalShipmentId.get(sale.shipmentId) || null;
      const isReversed = Boolean(refund);

      const commissionNetBilled = money2(
        Number(sale.commissionNet || 0) + Number(refund?.commissionNet || 0)
      );

      const commissionSourceKey = sale.meta?.commissionSource || "plan";

      let promoterType = null;
      let promoterId = null;
      let promoterName = null;
      let promoterBps = null;
      let promoterEarningNet = 0;

      if (shipment?.referrerVendorId) {
        const { source } = attributionSourceLabel(shipment.referrerVendorReferralCodeSnapshot);
        promoterType = source; // VENDOR_REFERRAL | VENDOR_COLLECTION_REFERRAL
        promoterId = shipment.referrerVendorId;
        promoterName = shipment.referrerVendor?.displayName || null;
        promoterBps = shipment.referrerVendorCommissionBpsSnapshot ?? null;
        promoterEarningNet = netPromoterEarningForShipment(referralEntries, sale.shipmentId);

        promoterBreakdown[source].count += 1;
        promoterBreakdown[source].artfestCommissionNet = money2(
          promoterBreakdown[source].artfestCommissionNet + commissionNetBilled
        );
        promoterBreakdown[source].earningNet = money2(
          promoterBreakdown[source].earningNet + promoterEarningNet
        );
      } else if (shipment?.influencerId) {
        promoterType = "INFLUENCER";
        promoterId = shipment.influencerId;
        promoterName = shipment.influencer?.displayName || null;
        promoterBps = shipment.influencerCommissionBpsSnapshot ?? null;
        promoterEarningNet = netPromoterEarningForShipment(influencerEntries, sale.shipmentId);

        promoterBreakdown.INFLUENCER.count += 1;
        promoterBreakdown.INFLUENCER.artfestCommissionNet = money2(
          promoterBreakdown.INFLUENCER.artfestCommissionNet + commissionNetBilled
        );
        promoterBreakdown.INFLUENCER.earningNet = money2(
          promoterBreakdown.INFLUENCER.earningNet + promoterEarningNet
        );
      }

      const row = {
        orderNumber: shipment?.order?.orderNumber || null,
        orderId: sale.orderId,
        shipmentId: sale.shipmentId,
        source: commissionSourceKey,
        commissionSource: commissionSourceKey,
        commissionBps: sale.meta?.commissionBps ?? null,
        isMixedCommission: Boolean(sale.meta?.isMixedCommission),
        commissionGross: Number(sale.meta?.commissionAmount || 0),
        platformSubsidyAmount: Number(sale.meta?.platformSubsidyAmount || 0),
        commissionNetBilled,
        promoterType,
        promoterId,
        promoterName,
        promoterBps,
        promoterEarningNet,
        isReversed,
        artfestNetFinal: money2(commissionNetBilled - promoterEarningNet),
        occurredAt: sale.occurredAt,
      };

      shipmentRows.push(row);
      addToBySource(commissionSourceKey, row);
    }

    const adjustmentCommissionNet = money2(
      adjustmentEntries.reduce((sum, e) => sum + Number(e.commissionNet || 0), 0)
    );

    const totalItemsNet = money2(
      entries.reduce((sum, e) => sum + Number(e.itemsNet || 0), 0)
    );
    const grossSales = money2(
      saleEntries.reduce((s, e) => s + Number(e.meta?.commissionBaseGross || 0), 0)
    );
    const refundsItemsNet = money2(
      entries
        .filter((e) => e.type === "REFUND")
        .reduce((s, e) => s + Number(e.itemsNet || 0), 0)
    );
    const totalCommissionGross = money2(
      shipmentRows.reduce((s, r) => s + r.commissionGross, 0)
    );
    const totalPlatformSubsidy = money2(
      shipmentRows.reduce((s, r) => s + r.platformSubsidyAmount, 0)
    );
    const totalCommissionNetBilled = money2(
      money2(shipmentRows.reduce((s, r) => s + r.commissionNetBilled, 0)) + adjustmentCommissionNet
    );
    const totalPromoterEarnings = money2(
      shipmentRows.reduce((s, r) => s + r.promoterEarningNet, 0)
    );
    const artfestNetFinal = money2(totalCommissionNetBilled - totalPromoterEarnings);

    const refundsCount = shipmentRows.filter((r) => r.isReversed).length;

    return res.json({
      vendor,
      period: { from: periodFrom, to: periodTo },
      currency,
      summary: {
        entryCount: saleEntries.length,
        refundsCount,
        grossSales,
        refundsItemsNet,
        netSales: totalItemsNet,
        commissionGross: totalCommissionGross,
        platformFundedDiscounts: totalPlatformSubsidy,
        commissionNetBilled: totalCommissionNetBilled,
        promoterEarnings: totalPromoterEarnings,
        artfestNetFinal,
        adjustmentCommissionNet,
      },
      bySource: [...bySourceMap.values()],
      promoterBreakdown: {
        VENDOR_REFERRAL: promoterBreakdown.VENDOR_REFERRAL,
        VENDOR_COLLECTION_REFERRAL: promoterBreakdown.VENDOR_COLLECTION_REFERRAL,
        INFLUENCER: promoterBreakdown.INFLUENCER,
      },
      shipments: shipmentRows,
    });
  } catch (err) {
    console.error("GET /api/admin/billing/vendor-commission-breakdown FAILED:", err);
    return res.status(500).json({
      error: "vendor_commission_breakdown_failed",
      message: err?.message || "Nu am putut încărca detaliile de comision.",
    });
  }
});

const CreateVendorCommissionInvoicePayload = z.object({
  vendorId: z.string().min(6),
  vatRate: z.number().min(0).max(100).default(0),

  /*
   * FAZA 2 (2026-09-07) - perioadă EXPLICITĂ, opțională. Dacă lipsesc,
   * default determinist: luna calendaristică anterioară, Europe/
   * Bucharest (vezi getPreviousBucharestMonthBoundaries). Nu se mai
   * derivează din min/max al entry-urilor nefacturate.
   */
  periodFrom: z.string().datetime().optional(),
  periodTo: z.string().datetime().optional(),
});

/* =========================================================
   7) POST /api/admin/billing/create-vendor-commission-invoice
   - emite factură SmartBill către vendor - STRICT manual, apăsat de
     admin; nu există (și nu se adaugă aici) niciun scheduler/cron.
   - Deleagă generarea efectivă către
     services/vendorCommissionInvoiceService.js (aceeași funcție ar
     putea fi apelată și de un job automat în viitor, dacă se decide
     asta - NU e cazul acum).
========================================================= */
router.post("/billing/create-vendor-commission-invoice", requireAdmin, async (req, res) => {
  try {
    const parsed = CreateVendorCommissionInvoicePayload.parse(req.body || {});
    const { vendorId, vatRate } = parsed;

    const { periodFrom, periodTo } =
      parsed.periodFrom && parsed.periodTo
        ? { periodFrom: new Date(parsed.periodFrom), periodTo: new Date(parsed.periodTo) }
        : getPreviousBucharestMonthBoundaries();

    const result = await generateVendorCommissionInvoice({
      vendorId,
      periodFrom,
      periodTo,
      vatRate,
    });

    switch (result.status) {
      case "CREATED":
        return res.json({ ok: true, invoice: result.invoice });

      case "SKIPPED_ALREADY_EXISTS":
        return res.status(409).json({
          error: "already_invoiced_for_period",
          message: "Există deja o factură de comision pentru acest vendor și această perioadă.",
          periodFrom: result.periodFrom,
          periodTo: result.periodTo,
        });

      case "SKIPPED_NO_COMMISSION":
        if (result.reason === "zero_or_negative_commission") {
          return res.status(409).json({
            error: "zero_commission",
            message: "Comisionul calculat este 0.",
          });
        }
        return res.status(409).json({
          error: "no_entries_to_invoice",
          message: "Nu există comisioane nefacturate pentru acest vendor în perioada selectată.",
        });

      case "ERROR":
        if (result.reason === "vendor_not_found") {
          return res.status(404).json({ error: "vendor_not_found" });
        }
        if (result.reason === "vendor_billing_missing") {
          return res.status(409).json({
            error: "vendor_billing_missing",
            message: "Vendorul nu are date de facturare completate.",
          });
        }
        if (result.reason === "smartbill_create_failed") {
          return res.status(502).json({
            error: "smartbill_create_failed",
            message:
              result.error ||
              "Factura nu a putut fi emisă în SmartBill. Verifică datele vendorului și credențialele SmartBill.",
          });
        }
        if (result.reason === "smartbill_missing_invoice_number") {
          return res.status(502).json({
            error: "smartbill_missing_invoice_number",
            message: "SmartBill nu a returnat numărul facturii.",
          });
        }

        console.error("POST /billing/create-vendor-commission-invoice:", result);
        return res.status(500).json({
          error: "create_vendor_commission_invoice_failed",
          message: result.error || "Nu am putut crea factura de comision.",
        });

      default:
        return res.status(500).json({
          error: "create_vendor_commission_invoice_failed",
          message: "Stare neașteptată la generarea facturii.",
        });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid_payload", details: err.errors });
    }

    console.error("POST /api/admin/billing/create-vendor-commission-invoice FAILED:", err);

    return res.status(500).json({
      error: "create_vendor_commission_invoice_failed",
      message: err?.message || "Nu am putut crea factura de comision.",
    });
  }
});

export default router;
