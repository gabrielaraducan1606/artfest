// backend/src/services/vendorCommissionInvoiceService.js
//
// FAZA 2 (Model B, facturare lunară comision, 2026-09-07) - logica de
// generare a facturii de comision, extrasă din
// adminInvoicesRoutes.js (POST /billing/create-vendor-commission-invoice)
// într-un singur loc reutilizabil.
//
// IMPORTANT (decizie 2026-09-07): emiterea rămâne STRICT MANUALĂ, din
// admin - NU există (și nu trebuie adăugat) niciun scheduler/cron/job
// automat. Acest fișier există DOAR ca să scoată logica de generare
// din ruta HTTP într-o funcție pură, testabilă determinist, apelată
// de EXACT același endpoint admin de azi - nimic mai mult.
//
// NU duplică nimic din marketplaceCalc.js/Model B (Faza 1) - citește
// STRICT VendorEarningEntry.commissionNet, deja calculat acolo. NU
// atinge Stripe/payout/COD - doar citește entries + scrie Invoice/
// VendorPayout, exact ca fluxul admin existent.

import { prisma } from "../db.js";
import fs from "fs/promises";
import path from "path";
import {
  createSmartBillInvoice,
  getSmartBillInvoicePdfBuffer,
} from "../lib/smartbill.js";
import { sendVendorCommissionInvoiceEmail } from "../lib/mailer.js";

export const EARNING_ENTRY_TYPES = ["SALE", "REFUND", "ADJUSTMENT"];

function money2(n) {
  const v = Number(n || 0);
  return Math.round(v * 100) / 100;
}

/* =========================================================
   LIMITE DE LUNĂ ÎN Europe/Bucharest — determinist, testabil,
   fără nicio dependență nouă (doar Intl, integrat în Node).

   Metodă (standard, fără bibliotecă de timezone):
   1. Aflăm data calendaristică (an/lună/zi) în Bucharest a unui
      instant UTC dat, via Intl.DateTimeFormat.
   2. Pentru a converti "miezul nopții local, ziua D" înapoi într-un
      instant UTC: facem o presupunere inițială (tratăm D ca UTC),
      citim ce oră arată ceasul din Bucharest la acel instant (asta
      ne dă offset-ul REAL, corect inclusiv la schimbarea de oră -
      DST-ul e o proprietate a INSTANTULUI, nu o constantă fixă), apoi
      corectăm presupunerea cu acel offset.

   Precizie: metoda poate fi imprecisă doar în fereastra de ~1h chiar
   în jurul momentului exact al tranziției DST (03:00-04:00 local, în
   ultima duminică din martie/octombrie) - limitele noastre sunt
   mereu la miezul nopții (00:00 local), niciodată în acea fereastră,
   deci corecția într-un singur pas e suficientă și corectă pentru
   acest caz de utilizare (verificat explicit cu teste pe luna
   octombrie, care conține tranziția de toamnă).
========================================================= */

const BUCHAREST_TZ = "Europe/Bucharest";

function getZonedDateParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return parts;
}

function zonedMidnightToUtc(year, monthIndex0, day, timeZone) {
  // Pas 1: presupunere inițială - tratăm miezul nopții local ca UTC.
  const guess = new Date(Date.UTC(year, monthIndex0, day, 0, 0, 0, 0));

  // Pas 2: offset-ul real al fusului orar LA acel instant (surprinde DST).
  const zonedAtGuess = getZonedDateParts(guess, timeZone);
  const asIfUtc = Date.UTC(
    zonedAtGuess.year,
    zonedAtGuess.month - 1,
    zonedAtGuess.day,
    zonedAtGuess.hour,
    zonedAtGuess.minute,
    zonedAtGuess.second
  );
  const offsetMs = asIfUtc - guess.getTime();

  // Pas 3: corectăm presupunerea cu offset-ul găsit.
  return new Date(guess.getTime() - offsetMs);
}

/**
 * Limitele lunii calendaristice (Europe/Bucharest) care conține
 * `referenceDate`, deplasată cu `monthOffset` luni (0 = luna curentă,
 * -1 = luna anterioară). Interval half-open: [periodFrom, periodTo).
 */
export function getBucharestMonthBoundaries(referenceDate = new Date(), monthOffset = 0) {
  const parts = getZonedDateParts(referenceDate, BUCHAREST_TZ);

  const totalMonths = parts.year * 12 + (parts.month - 1) + monthOffset;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex0 = ((totalMonths % 12) + 12) % 12;

  const nextTotalMonths = totalMonths + 1;
  const nextYear = Math.floor(nextTotalMonths / 12);
  const nextMonthIndex0 = ((nextTotalMonths % 12) + 12) % 12;

  return {
    periodFrom: zonedMidnightToUtc(targetYear, targetMonthIndex0, 1, BUCHAREST_TZ),
    periodTo: zonedMidnightToUtc(nextYear, nextMonthIndex0, 1, BUCHAREST_TZ),
  };
}

/** Regula business: "pe data de 1, pentru luna anterioară". */
export function getPreviousBucharestMonthBoundaries(referenceDate = new Date()) {
  return getBucharestMonthBoundaries(referenceDate, -1);
}

/* =========================================================
   GENERARE FACTURĂ - un singur vendor, o singură perioadă.
========================================================= */

/**
 * @param {object} params
 * @param {string} params.vendorId
 * @param {Date} params.periodFrom - inclusiv
 * @param {Date} params.periodTo - exclusiv
 * @param {number} [params.vatRate]
 * @param {boolean} [params.dryRun] - dacă true, NU scrie nimic (fără
 *   Invoice/VendorPayout/payoutId/email) - doar calculează și raportează.
 * @returns {Promise<{status: "CREATED"|"SKIPPED_NO_COMMISSION"|"SKIPPED_ALREADY_EXISTS"|"DRY_RUN"|"ERROR", ...}>}
 */
export async function generateVendorCommissionInvoice({
  vendorId,
  periodFrom,
  periodTo,
  vatRate = 0,
  dryRun = false,
}) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: {
      billing: true,
      user: { select: { email: true } },
      earningEntries: {
        where: {
          payoutId: null,
          type: { in: EARNING_ENTRY_TYPES },
          occurredAt: { gte: periodFrom, lt: periodTo },
        },
        orderBy: { occurredAt: "asc" },
      },
    },
  });

  if (!vendor) {
    return { status: "ERROR", vendorId, reason: "vendor_not_found" };
  }

  if (!vendor.billing) {
    return { status: "ERROR", vendorId, reason: "vendor_billing_missing" };
  }

  if (!vendor.earningEntries.length) {
    return { status: "SKIPPED_NO_COMMISSION", vendorId, reason: "no_entries", periodFrom, periodTo };
  }

  const commissionNet = money2(
    vendor.earningEntries.reduce((sum, e) => sum + Number(e.commissionNet || 0), 0)
  );

  /*
   * Comportament existent, păstrat neschimbat (nu inventez o regulă
   * financiară nouă) - dacă suma comisionului pe perioadă e <= 0
   * (posibil, de exemplu, dacă un refund depășește vânzările din
   * aceeași lună), NU se creează factură.
   */
  if (commissionNet <= 0) {
    return {
      status: "SKIPPED_NO_COMMISSION",
      vendorId,
      reason: "zero_or_negative_commission",
      commissionNet,
      entryCount: vendor.earningEntries.length,
      periodFrom,
      periodTo,
    };
  }

  const currency = vendor.earningEntries[0]?.currency || "RON";
  const totalVat = money2((commissionNet * vatRate) / 100);
  const totalGross = money2(commissionNet + totalVat);

  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setDate(dueDate.getDate() + 7);

  if (dryRun) {
    return {
      status: "DRY_RUN",
      vendorId,
      vendorDisplayName: vendor.displayName,
      periodFrom,
      periodTo,
      entryCount: vendor.earningEntries.length,
      commissionNet,
      totalVat,
      totalGross,
      currency,
    };
  }

  const platform = await prisma.platformBilling.findUnique({ where: { id: "platform" } });
  if (!platform) {
    return { status: "ERROR", vendorId, reason: "platform_billing_missing" };
  }

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
    console.error("[vendorCommissionInvoiceService] SmartBill create failed:", smartBillErr?.details || smartBillErr);
    return {
      status: "ERROR",
      vendorId,
      reason: "smartbill_create_failed",
      error: smartBillErr?.message || String(smartBillErr),
    };
  }

  const providerSeries = smartBill.series || smartBillSeries;
  const providerNumber = String(
    smartBill.number || smartBill.invoiceNumber || smartBill.documentNumber || smartBill.id
  );

  if (!providerNumber || providerNumber === "undefined") {
    return { status: "ERROR", vendorId, reason: "smartbill_missing_invoice_number" };
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
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
        where: { id: { in: vendor.earningEntries.map((e) => e.id) } },
        data: { payoutId: payout.id },
      });

      return invoice;
    });
  } catch (txErr) {
    /*
     * IDEMPOTENCY - reutilizează constrângerea unică EXISTENTĂ din
     * schema Prisma (schema.prisma:1906, @@unique([vendorId, type,
     * periodFrom, periodTo], name: "vendor_monthly_invoice_unique")).
     * Nu am adăugat nimic nou aici - doar acum devine EFECTIVĂ, pentru
     * că periodFrom/periodTo sunt fixe (limitele lunii), nu derivate
     * din entries ca înainte.
     *
     * Formă meta.target la P2002 diferă în funcție de motorul Prisma/
     * versiunea Postgres - poate fi array de câmpuri SAU string cu
     * numele constrângerii. Verificăm ambele forme, STRICT pe
     * constrângerea asta (nu orice P2002).
     */
    const target = txErr?.meta?.target;
    const isThisConstraint =
      txErr?.code === "P2002" &&
      (typeof target === "string"
        ? target.includes("vendor_monthly_invoice_unique")
        : Array.isArray(target) &&
          ["vendorId", "type", "periodFrom", "periodTo"].every((f) => target.includes(f)));

    if (isThisConstraint) {
      return {
        status: "SKIPPED_ALREADY_EXISTS",
        vendorId,
        periodFrom,
        periodTo,
      };
    }

    console.error("[vendorCommissionInvoiceService] invoice transaction failed:", txErr);
    return {
      status: "ERROR",
      vendorId,
      reason: "invoice_create_failed",
      error: txErr?.message || String(txErr),
    };
  }

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
      data: { pdfUrl, providerPdfUrl: pdfUrl },
      include: { lines: true },
    });
  } catch (pdfErr) {
    console.error("[vendorCommissionInvoiceService] PDF save failed:", pdfErr);
  }

  try {
    const to = vendor.billing?.email || vendor.email || vendor.user?.email;

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
                content: await fs.readFile(pdfPath),
                contentType: "application/pdf",
              },
            ]
          : [],
      });
    }
  } catch (emailErr) {
    console.error("[vendorCommissionInvoiceService] email send failed:", emailErr);
  }

  return {
    status: "CREATED",
    vendorId,
    invoice: updatedInvoice,
    commissionNet,
    totalGross,
    currency,
    periodFrom,
    periodTo,
  };
}
