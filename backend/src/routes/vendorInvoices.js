// backend/src/routes/vendorInvoices.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { z } from "zod";
import PDFDocument from "pdfkit"; // npm install pdfkit
import { notifyUserOnInvoiceIssued } from "../services/notifications.js"; // 🔔 notificare in-app
import { sendInvoiceIssuedEmail } from "../lib/mailer.js"; // ✉️ email factură emisă

const router = Router();

/* ========= helpers ========= */

async function getCurrentVendorByUser(userId) {
  return prisma.vendor.findUnique({
    where: { userId },
    select: { id: true },
  });
}

const InvoiceLineInput = z.object({
  description: z.string().min(1),
  qty: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
  vatRate: z.number().nonnegative(), // procent (ex: 19)
});

const InvoiceInput = z.object({
  series: z.string().optional(),
  number: z.string().optional(),
  issueDate: z.string(), // yyyy-mm-dd
  dueDate: z.string().optional(),
  currency: z.string().default("RON"),
  notes: z.string().optional(),
  customer: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  lines: z.array(InvoiceLineInput).min(1),
});

const InvoicePayload = z.object({
  invoice: InvoiceInput,
  sendEmail: z.boolean().optional(),
});

/* ========= 1) Billing vendor ========= */

/**
 * GET /api/vendors/me/billing
 */
router.get("/vendors/me/billing", authRequired, async (req, res) => {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: req.user.sub },
      include: { billing: true },
    });

    if (!vendor) {
      return res.status(404).json({ error: "not_a_vendor" });
    }

    res.json({ billing: vendor.billing || null });
  } catch (err) {
    console.error("GET /vendors/me/billing FAILED:", err);
    res.status(500).json({
      error: "billing_load_failed",
      message: err?.message || "Nu am putut încărca datele de facturare.",
    });
  }
});

/* ========= 2) Facturi ArtFest → vendor ========= */

/**
 * GET /api/vendors/me/invoices
 * direction = PLATFORM_TO_VENDOR
 */
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
      orderBy: { issueDate: "desc" },
    });

    const dto = items.map((inv) => ({
      id: inv.id,
      number: inv.number,
      issueDate: inv.issueDate,
      type: inv.type,
      periodFrom: inv.periodFrom,
      periodTo: inv.periodTo,
      totalGross: Number(inv.totalGross || 0),
      currency: inv.currency || "RON",
      status: inv.status,
      downloadUrl: `/api/vendor/invoices/${inv.id}/pdf`,
    }));

    res.json({ items: dto });
  } catch (err) {
    console.error("GET /vendors/me/invoices FAILED:", err);
    res.status(500).json({
      error: "vendor_invoices_failed",
      message: err?.message || "Nu am putut încărca facturile.",
    });
  }
});

/* ========= 3) Facturi vendor → clienți ========= */

/**
 * GET /api/vendors/me/client-invoices
 * direction = VENDOR_TO_CLIENT
 */
router.get("/vendors/me/client-invoices", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) {
      return res.status(403).json({ error: "not_a_vendor" });
    }

    const items = await prisma.invoice.findMany({
      where: {
        vendorId: vendor.id,
        direction: "VENDOR_TO_CLIENT",
      },
      include: {
        order: true,
      },
      orderBy: { issueDate: "desc" },
    });

    const dto = items.map((inv) => ({
      id: inv.id,
      number: inv.number,
      issueDate: inv.issueDate,
      clientName: inv.clientName || null,
      clientEmail: inv.clientEmail || null,
      orderId: inv.orderId || null,
      orderNumber: inv.order?.id || null,
      totalGross: Number(inv.totalGross || 0),
      currency: inv.currency || "RON",
      status: inv.status,
      downloadUrl: `/api/vendor/invoices/${inv.id}/pdf`,
    }));

    res.json({ items: dto });
  } catch (err) {
    console.error("GET /vendors/me/client-invoices FAILED:", err);
    res.status(500).json({
      error: "client_invoices_failed",
      message: err?.message || "Nu am putut încărca facturile către clienți.",
    });
  }
});

/* ========= helper map draft ========= */

function mapInvoiceToDraftDto(invoice, billingProfile, order) {
  const vendorDto = billingProfile
    ? {
        name: billingProfile.companyName,
        cui: billingProfile.cui || "",
        regCom: billingProfile.regCom || "",
        address: billingProfile.address || "",
        iban: billingProfile.iban || "",
        bank: billingProfile.bank || "",
      }
    : null;

  const shipping = order?.shippingAddress || {};
  const customerDto = {
    name: invoice.clientName || shipping.name || "",
    email: invoice.clientEmail || shipping.email || "",
    phone: invoice.clientPhone || shipping.phone || "",
    address:
      invoice.clientAddress ||
      shipping.address ||
      [
        shipping.street,
        shipping.city,
        shipping.county,
        shipping.postalCode,
      ]
        .filter(Boolean)
        .join(", "),
  };

  return {
    series: invoice.series || "FA",
    number: invoice.number || "",
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    dueDate: invoice.dueDate
      ? invoice.dueDate.toISOString().slice(0, 10)
      : invoice.issueDate.toISOString().slice(0, 10),
    currency: invoice.currency || "RON",
    notes: invoice.notes || "",
    vendor: vendorDto,
    customer: customerDto,
    lines: (invoice.lines || []).map((ln) => ({
      description: ln.description,
      qty: Number(ln.quantity || 0),
      unitPrice: Number(ln.unitNet || 0),
      vatRate: Number(ln.vatRate || 0),
    })),
  };
}

// număr factură simplu – pentru vendor → client
async function getNextInvoiceNumber(vendorId) {
  const year = new Date().getFullYear();
  const prefix = `AF-${year}-`;

  const last = await prisma.invoice.findFirst({
    where: { vendorId, direction: "VENDOR_TO_CLIENT" },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });

  let nextSeq = 1;
  if (last?.number?.startsWith(prefix)) {
    const n = parseInt(last.number.slice(prefix.length), 10);
    if (Number.isFinite(n)) nextSeq = n + 1;
  }

  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
}

/* ========= 4) Draft factură pentru o comandă ========= */

/**
 * GET /api/vendor/orders/:orderId/invoice
 */
router.get(
  "/vendor/orders/:orderId/invoice",
  authRequired,
  async (req, res) => {
    try {
      const vendor = await getCurrentVendorByUser(req.user.sub);
      if (!vendor) {
        return res.status(403).json({ error: "not_a_vendor" });
      }

      const paramId = String(req.params.orderId);

      // 1) încercăm ca Shipment.id
      let shipment = await prisma.shipment.findFirst({
        where: { id: paramId, vendorId: vendor.id },
        include: {
          order: true,
          items: true,
        },
      });

      // 2) dacă nu găsim, încercăm ca Order.id
      if (!shipment) {
        shipment = await prisma.shipment.findFirst({
          where: { orderId: paramId, vendorId: vendor.id },
          include: {
            order: true,
            items: true,
          },
        });
      }

      if (!shipment) {
        console.warn("[InvoiceDraft] Shipment not found for vendor", {
          vendorId: vendor.id,
          paramId,
        });
        return res.status(404).json({ error: "order_not_found_for_vendor" });
      }

      const order = shipment.order;
      const billingProfile = await prisma.vendorBilling.findUnique({
        where: { vendorId: vendor.id },
      });

      const existing = await prisma.invoice.findFirst({
        where: {
          vendorId: vendor.id,
          orderId: order.id,
          direction: "VENDOR_TO_CLIENT",
        },
        include: { lines: true },
      });

      if (existing) {
        const dto = mapInvoiceToDraftDto(existing, billingProfile, order);
        return res.json({ invoice: dto });
      }

      const lines =
        shipment.items?.length > 0
          ? shipment.items.map((it) => ({
              description: it.title,
              qty: it.qty,
              unitPrice: Number(it.price || 0),
              vatRate: 19,
            }))
          : [
              {
                description: "Produse comandă",
                qty: 1,
                unitPrice: Number(order.total || 0),
                vatRate: 19,
              },
            ];

      const today = new Date().toISOString().slice(0, 10);
      const shipping = order.shippingAddress || {};

      const draft = {
        series: "FA",
        number: "",
        issueDate: today,
        dueDate: today,
        currency: order.currency || "RON",
        notes: "",
        vendor: billingProfile
          ? {
              name: billingProfile.companyName,
              cui: billingProfile.cui || "",
              regCom: billingProfile.regCom || "",
              address: billingProfile.address || "",
              iban: billingProfile.iban || "",
              bank: billingProfile.bank || "",
            }
          : null,
        customer: {
          name: shipping.name || "",
          email: shipping.email || "",
          phone: shipping.phone || "",
          address:
            shipping.address ||
            [
              shipping.street,
              shipping.city,
              shipping.county,
              shipping.postalCode,
            ]
              .filter(Boolean)
              .join(", "),
        },
        lines,
      };

      return res.json({ invoice: draft });
    } catch (err) {
      console.error("GET /vendor/orders/:orderId/invoice FAILED:", err);
      res.status(500).json({
        error: "invoice_draft_failed",
        message: err?.message || "Nu am putut încărca draftul de factură.",
      });
    }
  }
);

/* ========= 5) Salvează & (opțional) trimite factura ========= */

/**
 * POST /api/vendor/orders/:orderId/invoice
 */
router.post(
  "/vendor/orders/:orderId/invoice",
  authRequired,
  async (req, res) => {
    try {
      const vendor = await getCurrentVendorByUser(req.user.sub);
      if (!vendor) {
        return res.status(403).json({ error: "not_a_vendor" });
      }

      const paramId = String(req.params.orderId);
      const { invoice, sendEmail } = InvoicePayload.parse(req.body || {});

      // încercăm mai întâi ca Shipment.id, apoi ca Order.id
      let shipment = await prisma.shipment.findFirst({
        where: { id: paramId, vendorId: vendor.id },
        include: { order: true },
      });

      if (!shipment) {
        shipment = await prisma.shipment.findFirst({
          where: { orderId: paramId, vendorId: vendor.id },
          include: { order: true },
        });
      }

      if (!shipment || !shipment.order) {
        console.warn("[InvoiceSave] Shipment not found for vendor", {
          vendorId: vendor.id,
          paramId,
        });
        return res.status(404).json({ error: "order_not_found_for_vendor" });
      }

      const order = shipment.order;

      // totaluri
      let totalNet = 0;
      let totalVat = 0;

      for (const ln of invoice.lines) {
        const base = Number(ln.qty || 0) * Number(ln.unitPrice || 0);
        const vat = (base * Number(ln.vatRate || 0)) / 100;
        totalNet += base;
        totalVat += vat;
      }
      const totalGross = totalNet + totalVat;

      const issueDate = new Date(invoice.issueDate);
      const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : issueDate;

      let invoiceStatus = "UNPAID";
      if (order.status === "PAID" || order.status === "FULFILLED") {
        invoiceStatus = "PAID";
      }

      const existing = await prisma.invoice.findFirst({
        where: {
          vendorId: vendor.id,
          orderId: order.id,
          direction: "VENDOR_TO_CLIENT",
        },
        include: { lines: true },
      });

      const number =
        invoice.number && invoice.number.trim().length > 0
          ? invoice.number.trim()
          : await getNextInvoiceNumber(vendor.id);

      const commonData = {
        series: invoice.series || "FA",
        number,
        issueDate,
        dueDate,
        currency: invoice.currency || "RON",
        notes: invoice.notes || "",
        clientName: invoice.customer?.name || "",
        clientEmail: invoice.customer?.email || "",
        clientPhone: invoice.customer?.phone || "",
        clientAddress: invoice.customer?.address || "",
        totalNet,
        totalVat,
        totalGross,
        status: invoiceStatus,
        direction: "VENDOR_TO_CLIENT",
        type: "OTHER",
        periodFrom: null,
        periodTo: null,
      };

      const linesCreate = invoice.lines.map((ln) => {
        const qty = Number(ln.qty || 0);
        const unitNet = Number(ln.unitPrice || 0);
        const vatRate = Number(ln.vatRate || 0);
        const base = qty * unitNet;
        const vat = (base * vatRate) / 100;

        return {
          description: ln.description,
          quantity: qty,
          unitNet,
          vatRate,
          totalNet: base,
          totalVat: vat,
          totalGross: base + vat,
        };
      });

      let saved;
      if (existing) {
        saved = await prisma.invoice.update({
          where: { id: existing.id },
          data: {
            ...commonData,
            lines: {
              deleteMany: { invoiceId: existing.id },
              create: linesCreate,
            },
          },
          include: { lines: true },
        });
      } else {
        saved = await prisma.invoice.create({
          data: {
            ...commonData,
            vendorId: vendor.id,
            orderId: order.id,
            lines: {
              create: linesCreate,
            },
          },
          include: { lines: true },
        });
      }

      // 🔔 notificare către user când se emite PRIMA dată factura
      try {
        if (!existing) {
          await notifyUserOnInvoiceIssued(order.id, saved.id);
        }
      } catch (e) {
        console.error("notifyUserOnInvoiceIssued failed:", e);
      }

      // ✉️ opțional: trimite mail clientului cu info despre factură
      if (sendEmail && saved.clientEmail) {
        try {
          const invoiceFrontendPath = `/comanda/${order.id}`; // ajustează dacă ai altă rută

          await sendInvoiceIssuedEmail({
            to: saved.clientEmail,
            orderId: order.id,
            invoiceNumber: saved.number,
            totalGross: saved.totalGross,
            currency: saved.currency || "RON",
            invoiceFrontendPath,
          });
        } catch (e) {
          console.error("Failed to send invoice email:", e);
        }
      }

      res.json({
        ok: true,
        invoiceId: saved.id,
        pdfUrl: `/api/vendor/invoices/${saved.id}/pdf`,
      });
    } catch (err) {
      console.error("POST /vendor/orders/:orderId/invoice FAILED:", err);
      res.status(500).json({
        error: "invoice_save_failed",
        message: err?.message || "Nu am putut salva sau trimite factura.",
      });
    }
  }
);

/* ========= 6) PDF viewer / download ========= */

/**
 * GET /api/vendor/invoices/:id/pdf
 */
router.get("/vendor/invoices/:id/pdf", authRequired, async (req, res) => {
  try {
    const vendor = await getCurrentVendorByUser(req.user.sub);
    if (!vendor) {
      return res.status(403).json({ error: "not_a_vendor" });
    }

    const id = String(req.params.id);

    const invoice = await prisma.invoice.findFirst({
      where: { id, vendorId: vendor.id },
      include: {
        lines: true,
        vendor: {
          include: { billing: true },
        },
        order: true,
      },
    });

    if (!invoice) {
      return res.status(404).json({ error: "invoice_not_found" });
    }

    const billingProfile = invoice.vendor?.billing || null;
    generateInvoicePdfResponse(res, invoice, billingProfile);
  } catch (err) {
    console.error("GET /vendor/invoices/:id/pdf FAILED:", err);
    res.status(500).json({
      error: "invoice_pdf_failed",
      message: err?.message || "Nu am putut genera PDF-ul facturii.",
    });
  }
});

/* ========= helper: generare PDF cu pdfkit ========= */

function generateInvoicePdfResponse(res, invoice, billingProfile) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  const fileName = `Factura-${invoice.series || "FA"}-${
    invoice.number || invoice.id
  }.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${fileName.replace(/"/g, "")}"`
  );

  doc.pipe(res);

  // Header
  doc.fontSize(18).text("FACTURĂ", { align: "right" }).moveDown(0.3);

  doc
    .fontSize(10)
    .text(`Serie: ${invoice.series || "FA"}`, { align: "right" })
    .text(`Număr: ${invoice.number}`, { align: "right" })
    .text(
      `Dată: ${
        invoice.issueDate
          ? new Date(invoice.issueDate).toLocaleDateString("ro-RO")
          : "-"
      }`,
      { align: "right" }
    )
    .moveDown(1);

  // VENDOR
  doc.fontSize(12).text("Vânzător:", { underline: true });
  if (billingProfile) {
    doc
      .fontSize(10)
      .text(billingProfile.companyName || "", { continued: false })
      .text(`CUI: ${billingProfile.cui || "-"}`)
      .text(`Nr. Reg. Com.: ${billingProfile.regCom || "-"}`)
      .text(`Adresă: ${billingProfile.address || "-"}`)
      .text(`IBAN: ${billingProfile.iban || "-"}`)
      .text(`Banca: ${billingProfile.bank || "-"}`)
      .moveDown(1);
  } else {
    doc
      .fontSize(10)
      .text("Nu sunt completate datele de facturare ale vendorului.")
      .moveDown(1);
  }

  // CLIENT
  doc.fontSize(12).text("Cumpărător:", { underline: true });
  doc
    .fontSize(10)
    .text(invoice.clientName || "-", { continued: false })
    .text(`Email: ${invoice.clientEmail || "-"}`)
    .text(`Telefon: ${invoice.clientPhone || "-"}`)
    .text(`Adresă: ${invoice.clientAddress || "-"}`)
    .moveDown(1);

  // Linii
  doc
    .fontSize(11)
    .text("Detalii produse / servicii:", { underline: true })
    .moveDown(0.5);

  const tableTop = doc.y + 5;
  const colX = {
    desc: 50,
    qty: 280,
    unit: 330,
    vat: 400,
    total: 470,
  };

  doc
    .fontSize(9)
    .text("Descriere", colX.desc, tableTop)
    .text("Cant.", colX.qty, tableTop)
    .text("Preț unitar", colX.unit, tableTop)
    .text("TVA %", colX.vat, tableTop)
    .text("Total (cu TVA)", colX.total, tableTop);

  doc.moveTo(40, tableTop - 3).lineTo(555, tableTop - 3).stroke();

  let y = tableTop + 12;
  const lines = invoice.lines || [];
  lines.forEach((ln) => {
    const qty = Number(ln.quantity || 0);
    const unit = Number(ln.unitNet || 0);
    const vatRate = Number(ln.vatRate || 0);
    const base = qty * unit;
    const vat = (base * vatRate) / 100;
    const total = base + vat;

    if (y > 750) {
      doc.addPage();
      y = 60;
    }

    doc
      .fontSize(9)
      .text(ln.description || "", colX.desc, y, { width: 220 })
      .text(qty.toString(), colX.qty, y)
      .text(unit.toFixed(2), colX.unit, y)
      .text(vatRate.toFixed(1), colX.vat, y)
      .text(total.toFixed(2), colX.total, y);

    y += 14;
  });

  doc.moveDown(2);

  // TOTALURI
  const totalNet = Number(invoice.totalNet || 0);
  const totalVat = Number(invoice.totalVat || 0);
  const totalGross = Number(invoice.totalGross || 0);

  doc
    .fontSize(10)
    .text(
      `Total fără TVA: ${totalNet.toFixed(2)} ${
        invoice.currency || "RON"
      }`,
      {
        align: "right",
      }
    )
    .text(
      `TVA: ${totalVat.toFixed(2)} ${invoice.currency || "RON"}`,
      {
        align: "right",
      }
    )
    .fontSize(12)
    .text(
      `Total de plată: ${totalGross.toFixed(2)} ${
        invoice.currency || "RON"
      }`,
      {
        align: "right",
      }
    )
    .moveDown(2);

  if (invoice.notes) {
    doc
      .fontSize(9)
      .text("Mențiuni:", { underline: true })
      .moveDown(0.3)
      .fontSize(9)
      .text(invoice.notes);
  }

  doc.end();
}

export default router;
