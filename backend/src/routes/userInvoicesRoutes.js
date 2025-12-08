// ==============================
// File: server/routes/userInvoices.js
// ==============================

import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import PDFDocument from "pdfkit"; // dacă nu e deja instalat global

const router = Router();

/* ========= helper: generare PDF (copiat din vendorInvoices, ușor adaptat) ========= */

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
      .text("Nu sunt completate datele de facturare ale vânzătorului.")
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

/* ========= 1) Lista facturilor userului ========= */
/**
 * GET /api/users/me/invoices
 *
 * Facturi create de vendor (direction = VENDOR_TO_CLIENT)
 * pentru comenzile userului logat.
 */
router.get("/users/me/invoices", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;

    const items = await prisma.invoice.findMany({
      where: {
        direction: "VENDOR_TO_CLIENT",
        // ne asigurăm că factura aparține unei comenzi a acestui user
        order: {
          userId,
        },
      },
      include: {
        order: true,
        vendor: true, // dacă vrei să afișezi numele vendorului
      },
      orderBy: { issueDate: "desc" },
    });

    const dto = items.map((inv) => ({
      id: inv.id,
      number: inv.number,
      issueDate: inv.issueDate,
      orderId: inv.orderId || null,
      orderNumber: inv.order?.id || null, // sau .orderNumber dacă ai câmp separat
      totalGross: Number(inv.totalGross || 0),
      currency: inv.currency || "RON",
      status: inv.status,
      // acest URL este folosit în frontend la "Descarcă PDF"
      downloadUrl: `/api/users/me/invoices/${inv.id}/pdf`,
    }));

    res.json({ items: dto });
  } catch (err) {
    console.error("GET /users/me/invoices FAILED:", err);
    res.status(500).json({
      error: "user_invoices_failed",
      message: err?.message || "Nu am putut încărca facturile.",
    });
  }
});

/* ========= 2) PDF pentru o factură a userului ========= */
/**
 * GET /api/users/me/invoices/:id/pdf
 *
 * Userul poate vedea doar facturile aferente comenzilor lui.
 */
router.get("/users/me/invoices/:id/pdf", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const id = String(req.params.id);

    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        direction: "VENDOR_TO_CLIENT",
        order: {
          userId,
        },
      },
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
    console.error("GET /users/me/invoices/:id/pdf FAILED:", err);
    res.status(500).json({
      error: "user_invoice_pdf_failed",
      message: err?.message || "Nu am putut genera PDF-ul facturii.",
    });
  }
});

export default router;
