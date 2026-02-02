// backend/src/routes/adminInvoicesRoutes.js
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import fs from "fs/promises";
import path from "path";

import { htmlToPdfBuffer } from "../lib/htmlToPdf.js";
import { renderInvoiceHtml } from "../lib/invoiceHtmlTemplate.js";

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
  // mapați PlatformBilling -> ce așteaptă template-ul tău (invoiceHtmlTemplate)
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
          user: { select: { id: true, email: true, name: true, firstName: true, lastName: true, phone: true } },
          shipments: { select: { id: true, status: true, awb: true, courierProvider: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);

    const items = (rows || []).map((o) => {
      const addr = o.shippingAddress || {};
      const customerName =
        addr?.name || o.user?.name || [o.user?.firstName, o.user?.lastName].filter(Boolean).join(" ") || "";

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
          addr?.address || [addr?.street, addr?.city, addr?.county, addr?.postalCode].filter(Boolean).join(", "),

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
    return res.status(500).json({ error: "server_error", message: err?.message || "Internal Server Error" });
  }
});

/* =========================================================
   2) GET /api/admin/invoices (platform->client)
========================================================= */
router.get("/invoices", requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();
    const direction = String(req.query.direction || "PLATFORM_TO_CLIENT").trim();
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
          ],
        }
      : null;

    const where = {
      direction,
      ...(status ? { status } : {}),
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
          series: true,
          number: true,
          issueDate: true,
          currency: true,
          totalNet: true,
          totalVat: true,
          totalGross: true,
          status: true,
          pdfUrl: true,
          clientName: true,
          clientEmail: true,
          clientPhone: true,
        },
      }),
      prisma.invoice.count({ where }),
    ]);

    return res.json({ total, items: rows || [] });
  } catch (err) {
    console.error("GET /api/admin/invoices FAILED:", err);
    return res.status(500).json({ error: "server_error", message: err?.message || "Internal Server Error" });
  }
});

/* =========================================================
   3) GET /api/admin/invoices/:id (details + lines)
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
    return res.status(500).json({ error: "server_error", message: err?.message || "Internal Server Error" });
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
      return res.status(409).json({ error: "PLATFORM_BILLING_MISSING", message: "Lipsește PlatformBilling (id='platform')." });
    }
    return res.status(500).json({ error: "server_error", message: err?.message || "Internal Server Error" });
  }
});

/* =========================================================
   4) POST /api/admin/billing/create-invoice-from-order
   + generate PDF + save pdfUrl
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

    // 1) Create in DB
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

    // 2) Generate PDF + store + update pdfUrl
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
      return res.status(409).json({ error: "PLATFORM_BILLING_MISSING", message: "Lipsește PlatformBilling (id='platform')." });
    }
    if (err?.code === "PLATFORM_VENDOR_MISSING") {
      return res.status(409).json({ error: "PLATFORM_VENDOR_MISSING", message: "Lipsește Vendor-ul platformei (id='platform'). Rulează seed-ul." });
    }
    return res.status(500).json({ error: "server_error", message: err?.message || "Internal Server Error" });
  }
});

/* =========================================================
   5) GET /api/admin/invoices/:id/pdf
   - serve PDF (preferă pdfUrl, altfel regenerează)
========================================================= */
router.get("/invoices/:id/pdf", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);

    const inv = await prisma.invoice.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!inv) return res.status(404).json({ error: "not_found" });

    const platform = await getPlatformBillingOrThrow();
    const billingProfile = toBillingProfileFromPlatform(platform, 0);
    const platformMeta = getPlatformMeta();

    const html = renderInvoiceHtml({ invoice: inv, billingProfile, platform: platformMeta });
    const pdf = await htmlToPdfBuffer(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${inv.series || "FA"}-${inv.number || inv.id}.pdf"`);
    return res.send(pdf);
  } catch (err) {
    console.error("GET /api/admin/invoices/:id/pdf FAILED:", err);
    return res.status(500).json({ error: "server_error", message: err?.message || "Internal Server Error" });
  }
});

export default router;
