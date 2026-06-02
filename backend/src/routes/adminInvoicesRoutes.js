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
  createSmartBillInvoice,
  getSmartBillInvoicePdfBuffer,
} from "../lib/smartbill.js";
import { sendVendorCommissionInvoiceEmail } from "../lib/mailer.js";

const prisma = new PrismaClient();
const router = express.Router();

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

        return {
          vendorId: v.id,
          displayName: v.displayName,
          email: v.billing?.email || v.email || v.user?.email || null,
          billing: v.billing,
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

const CreateVendorCommissionInvoicePayload = z.object({
  vendorId: z.string().min(6),
  vatRate: z.number().min(0).max(100).default(0),
});

/* =========================================================
   7) POST /api/admin/billing/create-vendor-commission-invoice
   - emite factură SmartBill către vendor
========================================================= */
router.post("/billing/create-vendor-commission-invoice", requireAdmin, async (req, res) => {
  try {
    const { vendorId, vatRate } = CreateVendorCommissionInvoicePayload.parse(req.body || {});

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
  billing: true,
  user: {
    select: { email: true },
  },
  earningEntries: {
          where: {
            payoutId: null,
            type: { in: ["SALE", "REFUND", "ADJUSTMENT"] },
          },
          orderBy: { occurredAt: "asc" },
        },
      },
    });

    if (!vendor) return res.status(404).json({ error: "vendor_not_found" });

    if (!vendor.billing) {
      return res.status(409).json({
        error: "vendor_billing_missing",
        message: "Vendorul nu are date de facturare completate.",
      });
    }

    if (!vendor.earningEntries.length) {
      return res.status(409).json({
        error: "no_entries_to_invoice",
        message: "Nu există comisioane nefacturate pentru acest vendor.",
      });
    }

    const commissionNet = money2(
      vendor.earningEntries.reduce((sum, e) => sum + Number(e.commissionNet || 0), 0)
    );

    if (commissionNet <= 0) {
      return res.status(409).json({
        error: "zero_commission",
        message: "Comisionul calculat este 0.",
      });
    }

    const currency = vendor.earningEntries[0]?.currency || "RON";
    const totalVat = money2((commissionNet * vatRate) / 100);
    const totalGross = money2(commissionNet + totalVat);

    const issueDate = new Date();
    const dueDate = new Date(issueDate);
    dueDate.setDate(dueDate.getDate() + 7);

    const periodFrom = vendor.earningEntries[0].occurredAt;
    const periodTo = vendor.earningEntries[vendor.earningEntries.length - 1].occurredAt;

    const platform = await getPlatformBillingOrThrow();
    const smartBillSeries = process.env.SMARTBILL_SERIES || platform.invoiceSeries || "AF";

    const clientName =
      vendor.billing.companyName ||
      vendor.billing.vendorName ||
      vendor.billing.contactPerson ||
      vendor.displayName;

    const description = `Comision platformă ArtFest pentru ${vendor.earningEntries.length} tranzacții`;

    let smartBill;
    try {
      smartBill = await createSmartBillInvoice({
        client: {
          name: clientName,
          vatCode: vendor.billing.cui || "",
          regCom: vendor.billing.regCom || "",
          address: vendor.billing.address || "",
          email: vendor.billing.email || "",
          isTaxPayer: vendor.billing.vatStatus === "payer",
        },
        issueDate,
        dueDate,
        seriesName: smartBillSeries,
        currency,
        totalNet: commissionNet,
        vatRate,
        description,
      });
    } catch (smartBillErr) {
      console.error("SmartBill invoice create failed:", smartBillErr?.details || smartBillErr);
      return res.status(502).json({
        error: "smartbill_create_failed",
        message:
          smartBillErr?.message ||
          "Factura nu a putut fi emisă în SmartBill. Verifică datele vendorului și credențialele SmartBill.",
        details: smartBillErr?.details || null,
      });
    }

    const providerSeries = smartBill.series || smartBillSeries;
    const providerNumber = String(
      smartBill.number || smartBill.invoiceNumber || smartBill.documentNumber || smartBill.id
    );

    if (!providerNumber || providerNumber === "undefined") {
      return res.status(502).json({
        error: "smartbill_missing_invoice_number",
        message: "SmartBill nu a returnat numărul facturii.",
        details: smartBill,
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.create({
        data: {
          vendorId: vendor.id,
          direction: "PLATFORM_TO_VENDOR",
          type: "COMMISSION",
          periodFrom,
          periodTo,
          series: providerSeries,
          number: providerNumber,
          issueDate,
          dueDate,
          currency,
          clientName,
          clientEmail: vendor.billing.email,
          clientPhone: vendor.billing.phone,
          clientAddress: vendor.billing.address,
          totalNet: commissionNet,
          totalVat,
          totalGross,
          status: "UNPAID",
          provider: "SMARTBILL",
          providerInvoiceId: smartBill.id ? String(smartBill.id) : null,
          providerSeries,
          providerNumber,
          providerStatus: "ISSUED",
          providerPayload: smartBill,
          providerSyncedAt: new Date(),
          lines: {
            create: [
              {
                type: "COMMISSION",
                description,
                quantity: 1,
                unitNet: commissionNet,
                vatRate,
                totalNet: commissionNet,
                totalVat,
                totalGross,
                vendorId: vendor.id,
              },
            ],
          },
        },
        include: { lines: true },
      });

      const payout = await tx.vendorPayout.create({
        data: {
          vendorId: vendor.id,
          periodFrom,
          periodTo,
          currency,
          totalItemsNet: money2(
            vendor.earningEntries.reduce((sum, e) => sum + Number(e.itemsNet || 0), 0)
          ),
          totalCommissionNet: commissionNet,
          totalVendorNet: money2(
            vendor.earningEntries.reduce((sum, e) => sum + Number(e.vendorNet || 0), 0)
          ),
          invoiceId: invoice.id,
          status: "UNPAID",
          issuedAt: issueDate,
        },
      });

      await tx.vendorEarningEntry.updateMany({
        where: {
          id: { in: vendor.earningEntries.map((e) => e.id) },
        },
        data: {
          payoutId: payout.id,
        },
      });

      return invoice;
    });

    let updatedInvoice = created;

    try {
      const pdfBuffer = await getSmartBillInvoicePdfBuffer({
        seriesName: created.providerSeries || created.series,
        number: created.providerNumber || created.number,
      });

      const dir = path.join(process.cwd(), "uploads", "invoices");
      await fs.mkdir(dir, { recursive: true });

      const fileName = `${created.providerSeries || created.series}-${
        created.providerNumber || created.number
      }.pdf`;
      const absPath = path.join(dir, fileName);

      await fs.writeFile(absPath, pdfBuffer);

      const pdfUrl = `/uploads/invoices/${fileName}`;

      updatedInvoice = await prisma.invoice.update({
        where: { id: created.id },
        data: {
          pdfUrl,
          providerPdfUrl: pdfUrl,
        },
        include: { lines: true },
      });
    } catch (pdfErr) {
      console.error("SmartBill PDF save failed:", pdfErr);
    }
try {
  const to =
    vendor.billing?.email ||
    vendor.email ||
    vendor.user?.email;

  if (to) {
    const invoiceNumber = `${updatedInvoice.providerSeries || updatedInvoice.series}-${
  updatedInvoice.providerNumber || updatedInvoice.number
}`;

const pdfPath =
  updatedInvoice.providerPdfUrl || updatedInvoice.pdfUrl
    ? path.join(
        process.cwd(),
        (updatedInvoice.providerPdfUrl || updatedInvoice.pdfUrl).replace(/^\//, "")
      )
    : null;

await sendVendorCommissionInvoiceEmail({
  to,
  vendorName: vendor.displayName || vendor.billing?.vendorName || vendor.billing?.companyName,
  invoiceNumber,
  totalGross: updatedInvoice.totalGross,
  currency: updatedInvoice.currency || "RON",
  attachments: pdfPath
    ? [
        {
          filename: `Factura-comision-${invoiceNumber}.pdf`,
          path: pdfPath,
          contentType: "application/pdf",
        },
      ]
    : [],
});
  }
} catch (emailErr) {
  console.error("Vendor commission invoice email send failed:", emailErr);
}

    return res.json({
      ok: true,
      invoice: updatedInvoice,
    });
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
