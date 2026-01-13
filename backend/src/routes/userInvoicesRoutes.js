// server/routes/userInvoices.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { renderInvoiceHtml } from "../lib/invoiceHtmlTemplate.js";
import { htmlToPdfBuffer } from "../lib/htmlToPdf.js";

const router = Router();

/* ========= 1) Lista facturilor userului ========= */

router.get("/users/me/invoices", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;

    const items = await prisma.invoice.findMany({
      where: {
        direction: "VENDOR_TO_CLIENT",
        order: { userId },
      },
      include: { order: true, vendor: true },
      orderBy: { issueDate: "desc" },
    });

    const dto = items.map((inv) => ({
      id: inv.id,
      number: inv.number,
      issueDate: inv.issueDate,
      orderId: inv.orderId || null,
      orderNumber: inv.order?.id || null,
      totalGross: Number(inv.totalGross || 0),
      currency: inv.currency || "RON",
      status: inv.status,
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

/* ========= 2) PDF pentru o factură a userului (HTML → PDF) ========= */

router.get("/users/me/invoices/:id/pdf", authRequired, async (req, res) => {
  try {
    const userId = req.user.sub;
    const id = String(req.params.id);

    const invoice = await prisma.invoice.findFirst({
      where: {
        id,
        direction: "VENDOR_TO_CLIENT",
        order: { userId },
      },
      include: {
        lines: true,
        vendor: { include: { billing: true } },
        order: true,
      },
    });

    if (!invoice) return res.status(404).json({ error: "invoice_not_found" });

    const billingProfile = invoice.vendor?.billing || null;

    const html = renderInvoiceHtml({ invoice, billingProfile });
    const pdfBuffer = await htmlToPdfBuffer(html);

    const fileName = `Factura-${invoice.series || "FA"}-${invoice.number || invoice.id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${fileName.replace(/"/g, "")}"`
    );

    res.send(pdfBuffer);
  } catch (err) {
    console.error("GET /users/me/invoices/:id/pdf FAILED:", err);
    res.status(500).json({
      error: "user_invoice_pdf_failed",
      message: err?.message || "Nu am putut genera PDF-ul facturii.",
    });
  }
});

export default router;
