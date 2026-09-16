// backend/src/services/influencerPayoutService.js

/*
 * Logică de payout pentru influenceri - STRICT tracking-ul câștigurilor
 * NEPROCESATE (InfluencerEarningEntry.payoutId = null) și plata MANUALĂ
 * prin IBAN (nu Stripe, nu transfer bancar automat).
 *
 * Mirror STRUCTURAL al VendorEarningEntry.payoutId / VendorPayout (vezi
 * ensureInfluencerSaleLedgerEntry/ensureInfluencerRefundLedgerEntry din
 * vendorOrdersRoutes.js pentru sursa lui earningNet) - dar simplificat:
 * un singur `amount` (nu split items/comision/vendor, nu există la
 * influencer), fără Stripe, `paymentReference` pentru referința
 * transferului bancar manual.
 *
 * IMPORTANT: earningNet e deja NET (SALE pozitiv, REFUND negativ - vezi
 * ensureInfluencerRefundLedgerEntry, care scrie earningNet NEGATIV la
 * creare). NU recalculăm comisionul din commissionBpsSnapshot aici - un
 * simplu SUM(earningNet) e sursa corectă, exact cum face deja
 * getInfluencerConfirmedTotals (influencerEarnings.js), doar cu filtrul
 * suplimentar payoutId: null (acolo nu există filtru - e totalul
 * istoric, folosit DOAR pentru afișare "Câștig confirmat total", NU
 * pentru payout).
 */

import { prisma } from "../db.js";

function money2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

/**
 * Suma NEPROCESATĂ (disponibilă pentru un payout nou) - STRICT
 * InfluencerEarningEntry cu payoutId: null. Diferit de
 * getInfluencerConfirmedTotals (istoric complet, fără acest filtru).
 */
export async function getInfluencerAvailableForPayout(influencerId) {
  const [agg, currencyRow] = await Promise.all([
    prisma.influencerEarningEntry.aggregate({
      where: { influencerId, payoutId: null },
      _sum: { earningNet: true },
      _count: true,
    }),

    prisma.influencerEarningEntry.findFirst({
      where: { influencerId, payoutId: null },
      select: { currency: true },
    }),
  ]);

  return {
    amount: money2(agg._sum.earningNet || 0),
    entryCount: agg._count,
    currency: currencyRow?.currency || "RON",
  };
}

export async function getInfluencerLastPayout(influencerId) {
  return prisma.influencerPayout.findFirst({
    where: { influencerId },
    orderBy: { createdAt: "desc" },
  });
}

export async function listInfluencerPayouts(influencerId) {
  return prisma.influencerPayout.findMany({
    where: { influencerId },
    orderBy: { createdAt: "desc" },

    include: {
      invoice: {
        select: {
          id: true,
          series: true,
          number: true,
          providerSeries: true,
          providerNumber: true,
          issueDate: true,
          totalGross: true,
          pdfUrl: true,
          providerPdfUrl: true,
          meta: true,
          createdAt: true,
        },
      },
    },
  });
}

/**
 * "Pregătește plata" - creează un InfluencerPayout din TOATE
 * earning entries curent neprocesate (payoutId: null), le leagă de
 * payout în ACEEAȘI tranzacție, izolare Serializable ca să nu poată
 * două apeluri concurente include aceleași entries în două payout-uri
 * (Postgres respinge unul dintre ele cu eroare de conflict - o
 * prindem explicit mai jos și raportăm curat, nu lăsăm coruperea
 * datelor să depindă doar de "nu se întâmplă des").
 *
 * @returns {Promise<{status: "CREATED"|"NO_ENTRIES"|"ZERO_OR_NEGATIVE"|"CONCURRENT_CONFLICT", ...}>}
 */
export async function prepareInfluencerPayout({ influencerId }) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const entries = await tx.influencerEarningEntry.findMany({
          where: { influencerId, payoutId: null },
          select: {
            id: true,
            earningNet: true,
            currency: true,
            occurredAt: true,
          },
          orderBy: { occurredAt: "asc" },
        });

        if (!entries.length) {
          return { status: "NO_ENTRIES" };
        }

        const amount = money2(
          entries.reduce((sum, e) => sum + Number(e.earningNet || 0), 0)
        );

        /*
         * Regulă business explicită (cerută): dacă suma netă e <= 0
         * (posibil dacă refund-urile depășesc vânzările nefacturate
         * încă), NU se creează payout - entries rămân payoutId: null,
         * se vor compensa automat la următorul payout cu sumă pozitivă.
         */
        if (amount <= 0) {
          return {
            status: "ZERO_OR_NEGATIVE",
            amount,
            entryCount: entries.length,
          };
        }

        const currency = entries[0].currency || "RON";
        const periodFrom = entries[0].occurredAt;
        const periodTo = new Date();

        const payout = await tx.influencerPayout.create({
          data: {
            influencerId,
            periodFrom,
            periodTo,
            currency,
            amount,
            status: "UNPAID",
            issuedAt: periodTo,
          },
        });

        await tx.influencerEarningEntry.updateMany({
          where: { id: { in: entries.map((e) => e.id) } },
          data: { payoutId: payout.id },
        });

        return { status: "CREATED", payout, entryCount: entries.length };
      },
      { isolationLevel: "Serializable" }
    );
  } catch (err) {
    /*
     * P2034 - conflict de scriere sub Serializable (Postgres a
     * respins tranzacția pentru că alta, concurentă, a atins
     * aceleași rânduri primă). Raportăm curat - adminul reîncearcă,
     * nu există risc de dublă includere a acelorași entries.
     */
    if (err?.code === "P2034") {
      return { status: "CONCURRENT_CONFLICT" };
    }

    throw err;
  }
}

export class InfluencerPayoutStateError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/**
 * "Marchează ca plătit" - STRICT bookkeeping manual, NU declanșează
 * niciun transfer (Stripe/bancar). Doar UNPAID -> PAID e permis;
 * idempotent pe un payout deja PAID (nu suprascrie paidAt/referința
 * dintr-un al doilea click accidental).
 */
export async function markInfluencerPayoutAsPaid({
  payoutId,
  paidAt,
  paymentReference,
}) {
  const payout = await prisma.influencerPayout.findUnique({
    where: { id: payoutId },
  });

  if (!payout) {
    throw new InfluencerPayoutStateError(
      "payout_not_found",
      "Payout-ul nu a fost găsit."
    );
  }

  if (payout.status === "PAID") {
    return payout;
  }

  if (payout.status === "CANCELLED") {
    throw new InfluencerPayoutStateError(
      "payout_cancelled",
      "Payout-ul este anulat - nu poate fi marcat ca plătit."
    );
  }

  const resolvedPaidAt = paidAt ? new Date(paidAt) : new Date();
  const resolvedReference = paymentReference?.trim() || null;

  const [updatedPayout] = await prisma.$transaction([
    prisma.influencerPayout.update({
      where: { id: payoutId },
      data: {
        status: "PAID",
        paidAt: resolvedPaidAt,
        paymentReference: resolvedReference,
      },
    }),

    /*
     * Sincronizăm și Invoice.status, dacă payout-ul are o factură
     * legată (încărcată de influencer) - altfel factura ar rămâne
     * UNPAID lângă un payout PAID, ceea ce ar deruta orice listă
     * generică de facturi (GET /api/admin/invoices).
     */
    ...(payout.invoiceId
      ? [
          prisma.invoice.update({
            where: { id: payout.invoiceId },
            data: { status: "PAID", paidAt: resolvedPaidAt },
          }),
        ]
      : []),
  ]);

  return updatedPayout;
}
