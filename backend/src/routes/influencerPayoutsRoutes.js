// backend/src/routes/influencerPayoutsRoutes.js

/*
 * Fluxul FINAL de facturare pentru influenceri (2026-09-09):
 * Artfest NU emite nicio factură în numele influencerului (vezi
 * adminInfluencerPayoutRoutes.js pentru istoricul deciziei - fostul
 * services/influencerCommissionInvoiceService.js, care apela SmartBill
 * cu credențialele Artfest, a fost ȘTERS complet).
 *
 * În schimb:
 * 1. influencerul vede datele fiscale Artfest (din PlatformBilling,
 *    aceeași sursă unică folosită deja de adminInvoicesRoutes.js/
 *    vendorInvoices.js - NU duplicăm/hardcodăm nimic aici);
 * 2. vede suma/perioada de facturat per InfluencerPayout;
 * 3. își emite EL factura, în afara platformei;
 * 4. o încarcă aici (PDF, + XML opțional) - STRICT stocare, FĂRĂ
 *    OCR/parsare/validare fiscală automată;
 * 5. adminul o verifică manual și marchează plata (vezi
 *    adminInfluencerPayoutActionsRoutes.js /mark-paid).
 *
 * Upload-ul refolosește EXACT pattern-ul existent de fișiere
 * (multer memoryStorage + services/r2Storage.js -> uploadToR2), la
 * fel ca POST /api/upload/support (routes/uploadRoutes.js) - NU
 * inventăm o infrastructură de upload nouă.
 *
 * Salvare fără migrare Prisma: factura încărcată devine un rând
 * `Invoice` obișnuit (provider: LOCAL, NU SmartBill) - toate câmpurile
 * cerute au deja loc:
 *   - payoutId    -> InfluencerPayout.invoiceId (relația inversă,
 *                    deja existentă, unique) - nu era nevoie de o
 *                    coloană nouă pe Invoice.
 *   - invoiceNumber -> Invoice.number (există, obligatoriu)
 *   - invoiceDate   -> Invoice.issueDate (există, obligatoriu)
 *   - fileUrl       -> Invoice.pdfUrl (există, opțional)
 *   - originalFilename / xmlUrl -> Invoice.meta (Json, există deja) -
 *     NU exista o coloană dedicată, dar meta e exact pentru asta.
 *   - uploadedAt    -> Invoice.createdAt (există, automat la creare)
 * totalNet/totalVat/totalGross sunt NOT NULL pe Invoice - formularul
 * NU cere sumă (adminul verifică manual factura reală), deci le
 * populăm din payout.amount (totalVat: 0 - presupunere DOCUMENTATĂ,
 * nu validată fiscal - adminul o corectează manual dacă e cazul,
 * vezi raportul final).
 */

import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import { uploadToR2 } from "../services/r2Storage.js";
import { getPlatformBillingOrThrow } from "../lib/platformBilling.js";
import { listInfluencerPayouts } from "../services/influencerPayoutService.js";

const router = Router();

const SELF_INVOICE_ELIGIBLE_TYPES = new Set(["PFA", "COMPANY"]);

async function requireInfluencer(req, res) {
  const userId = req.user?.sub;

  if (!userId) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }

  const influencer = await prisma.influencerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!influencer) {
    res.status(403).json({ ok: false, error: "influencer_required" });
    return null;
  }

  return influencer;
}

/* =========================================================
   GET /api/influencer/billing-info

   Datele de facturare ALE ARTFEST-ULUI (nu ale influencerului) - ca
   influencerul să le poată copia pe propria factură. Sursă unică:
   PlatformBilling (aceeași folosită de adminInvoicesRoutes.js pentru
   facturile PLATFORM_TO_CLIENT) - fără duplicare/hardcodare.
========================================================= */

router.get(
  "/billing-info",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer = await requireInfluencer(req, res);
      if (!influencer) return;

      const platform = await getPlatformBillingOrThrow();

      return res.json({
        ok: true,
        billing: {
          companyName: platform.companyName,
          legalType: platform.legalType || null,
          cui: platform.cui,
          regCom: platform.regCom || null,
          address: platform.address,
          email: platform.email || null,
        },
      });
    } catch (error) {
      if (error?.code === "PLATFORM_BILLING_MISSING") {
        return res.status(409).json({
          ok: false,
          error: "platform_billing_missing",
        });
      }

      console.error(
        "[influencerPayoutsRoutes] GET /billing-info error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_billing_info_failed",
      });
    }
  }
);

/* =========================================================
   GET /api/influencer/payouts

   Listă proprie de InfluencerPayout ("Sume de facturat" în Setări).
========================================================= */

router.get(
  "/payouts",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer = await requireInfluencer(req, res);
      if (!influencer) return;

      const [payoutProfile, payouts] = await Promise.all([
        prisma.influencerPayoutProfile.findUnique({
          where: { influencerId: influencer.id },
          select: { beneficiaryType: true, isComplete: true },
        }),

        listInfluencerPayouts(influencer.id),
      ]);

      return res.json({
        ok: true,

        beneficiaryType: payoutProfile?.beneficiaryType || null,
        payoutProfileComplete: Boolean(payoutProfile?.isComplete),

        items: payouts.map((p) => ({
          id: p.id,
          periodFrom: p.periodFrom,
          periodTo: p.periodTo,
          currency: p.currency,
          amount: Number(p.amount || 0),
          status: p.status,
          issuedAt: p.issuedAt,
          paidAt: p.paidAt,
          paymentReference: p.paymentReference,
          invoice: p.invoice
            ? {
                id: p.invoice.id,
                number:
                  p.invoice.providerSeries && p.invoice.providerNumber
                    ? `${p.invoice.providerSeries}-${p.invoice.providerNumber}`
                    : p.invoice.series && p.invoice.number
                    ? `${p.invoice.series} ${p.invoice.number}`
                    : p.invoice.number,
                issueDate: p.invoice.issueDate,
                pdfUrl: p.invoice.providerPdfUrl || p.invoice.pdfUrl || null,
                xmlUrl: p.invoice.meta?.xmlUrl || null,
                originalFilename: p.invoice.meta?.originalFilename || null,
                uploadedAt:
                  p.invoice.meta?.uploadedAt || p.invoice.createdAt || null,
              }
            : null,
        })),
      });
    } catch (error) {
      console.error(
        "[influencerPayoutsRoutes] GET /payouts error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_payouts_load_failed",
      });
    }
  }
);

/* =========================================================
   POST /api/influencer/payouts/:payoutId/invoice

   "Trimite factura" - STRICT upload + înregistrare, FĂRĂ OCR, FĂRĂ
   parsare, FĂRĂ validare fiscală automată. Doar PFA/COMPANY (vezi
   SELF_INVOICE_ELIGIBLE_TYPES) - pentru INDIVIDUAL/OTHER, blocat
   explicit mai jos, cu mesajele cerute.
========================================================= */

function getFileExtension(name = "") {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

const uploadInvoiceFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },

  /*
   * Validare STRICTĂ pe ambele - mimetype ȘI extensie (nu doar una),
   * ca la orice document fiscal - un mimetype poate fi falsificat de
   * client, extensia e a doua barieră. Whitelist explicit, deci
   * niciun executabil/script nu poate trece (nu e o blocklist care
   * poate fi ocolită).
   */
  fileFilter(req, file, cb) {
    const mime = String(file.mimetype || "").toLowerCase();
    const ext = getFileExtension(file.originalname || "");

    if (file.fieldname === "file") {
      if (mime !== "application/pdf" || ext !== "pdf") {
        return cb(new Error("INVALID_INVOICE_FILE_TYPE"));
      }
      return cb(null, true);
    }

    if (file.fieldname === "xmlFile") {
      if (
        (mime !== "application/xml" && mime !== "text/xml") ||
        ext !== "xml"
      ) {
        return cb(new Error("INVALID_INVOICE_XML_TYPE"));
      }
      return cb(null, true);
    }

    return cb(new Error("UNEXPECTED_FIELD"));
  },
});

const UploadInvoiceFields = z.object({
  invoiceNumber: z.string().trim().min(1).max(64),
  invoiceDate: z.string().datetime().or(z.string().min(8).max(10)),
});

router.post(
  "/payouts/:payoutId/invoice",
  authRequired,
  enforceTokenVersion,
  (req, res) => {
    uploadInvoiceFiles.fields([
      { name: "file", maxCount: 1 },
      { name: "xmlFile", maxCount: 1 },
    ])(req, res, async (uploadErr) => {
      if (uploadErr) {
        if (uploadErr?.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            ok: false,
            error: "file_too_large",
            message: "Fișierul este prea mare (max 15MB).",
          });
        }

        if (uploadErr?.message === "INVALID_INVOICE_FILE_TYPE") {
          return res.status(415).json({
            ok: false,
            error: "invalid_invoice_file_type",
            message: "Factura trebuie să fie fișier PDF.",
          });
        }

        if (uploadErr?.message === "INVALID_INVOICE_XML_TYPE") {
          return res.status(415).json({
            ok: false,
            error: "invalid_invoice_xml_type",
            message: "Fișierul XML nu are un format valid.",
          });
        }

        console.error(
          "[influencerPayoutsRoutes] upload error:",
          uploadErr
        );

        return res.status(400).json({
          ok: false,
          error: "upload_failed",
        });
      }

      try {
        const influencer = await requireInfluencer(req, res);
        if (!influencer) return;

        const { payoutId } = req.params;

        const parsed = UploadInvoiceFields.safeParse(req.body || {});

        if (!parsed.success) {
          return res.status(400).json({
            ok: false,
            error: "invalid_payload",
            details: parsed.error.flatten(),
          });
        }

        const pdfFile = req.files?.file?.[0];

        if (!pdfFile) {
          return res.status(400).json({
            ok: false,
            error: "missing_invoice_file",
            message: "Atașează factura în format PDF.",
          });
        }

        const payout = await prisma.influencerPayout.findUnique({
          where: { id: payoutId },
          include: {
            influencer: {
              include: { payoutProfile: true },
            },
          },
        });

        if (!payout || payout.influencerId !== influencer.id) {
          return res.status(404).json({
            ok: false,
            error: "payout_not_found",
          });
        }

        if (payout.status !== "UNPAID") {
          return res.status(409).json({
            ok: false,
            error: "payout_not_unpaid",
            message: "Acest payout nu mai este în așteptare de factură.",
          });
        }

        if (payout.invoiceId) {
          return res.status(409).json({
            ok: false,
            error: "payout_already_has_invoice",
            message: "Ai încărcat deja o factură pentru acest payout.",
          });
        }

        const beneficiaryType =
          payout.influencer.payoutProfile?.beneficiaryType || null;

        if (!SELF_INVOICE_ELIGIBLE_TYPES.has(beneficiaryType)) {
          return res.status(409).json({
            ok: false,
            error:
              beneficiaryType === "INDIVIDUAL"
                ? "individual_not_eligible"
                : "beneficiary_type_not_eligible",
            message:
              beneficiaryType === "INDIVIDUAL"
                ? "Plata acestui tip de beneficiar este procesată separat."
                : "Necesită procesare manuală.",
          });
        }

        const uploadedPdf = await uploadToR2({
          file: pdfFile,
          folder: "influencer-invoices",
          userId: req.user.sub,
        });

        let uploadedXml = null;
        const xmlFile = req.files?.xmlFile?.[0];

        if (xmlFile) {
          uploadedXml = await uploadToR2({
            file: xmlFile,
            folder: "influencer-invoices",
            userId: req.user.sub,
            index: "xml",
          });
        }

        const totalNet = Math.round(Number(payout.amount || 0) * 100) / 100;

        const created = await prisma.$transaction(async (tx) => {
          const invoice = await tx.invoice.create({
            data: {
              influencerId: influencer.id,
              direction: "INFLUENCER_TO_PLATFORM",
              type: "INFLUENCER_COMMISSION",
              periodFrom: payout.periodFrom,
              periodTo: payout.periodTo,
              number: parsed.data.invoiceNumber,
              issueDate: new Date(parsed.data.invoiceDate),
              currency: payout.currency,
              totalNet,
              totalVat: 0,
              totalGross: totalNet,
              status: "UNPAID",
              provider: "LOCAL",
              pdfUrl: uploadedPdf.url,
              meta: {
                source: "influencer_self_invoice_upload",
                originalFilename: uploadedPdf.name,
                xmlUrl: uploadedXml?.url || null,
                xmlOriginalFilename: uploadedXml?.name || null,
                uploadedByUserId: req.user.sub,
                uploadedAt: new Date().toISOString(),
              },
            },
          });

          await tx.influencerPayout.update({
            where: { id: payout.id },
            data: { invoiceId: invoice.id },
          });

          return invoice;
        });

        return res.json({
          ok: true,
          invoice: {
            id: created.id,
            number: created.number,
            issueDate: created.issueDate,
            pdfUrl: created.pdfUrl,
          },
        });
      } catch (error) {
        if (error?.code === "upload_content_mismatch") {
          return res.status(415).json({
            ok: false,
            error: "invalid_file_type",
            message:
              "Conținutul fișierului nu corespunde formatului declarat (PDF/XML). Încearcă alt fișier.",
          });
        }

        console.error(
          "[influencerPayoutsRoutes] POST /payouts/:payoutId/invoice error:",
          error
        );

        return res.status(500).json({
          ok: false,
          error: "influencer_invoice_upload_failed",
        });
      }
    });
  }
);

export default router;
