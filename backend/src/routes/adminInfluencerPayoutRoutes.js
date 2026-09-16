// backend/src/routes/adminInfluencerPayoutRoutes.js

/*
 * Admin - vizibilitate asupra InfluencerPayoutProfile + creare/listare
 * InfluencerPayout, pentru subtab-ul „Fiscalizare & plăți” din
 * Admin -> Marketing -> Influenceri.
 *
 * AUDIT (înainte de a scrie acest fișier, faza inițială read-only):
 * - GET /api/admin/influencers (adminInfluencersRoutes.js) e deja
 *   greu (N+1 cu getInfluencerConfirmedTotals per influencer) și
 *   servește o pagină diferită (Marketing - listă/invitații/
 *   remunerație) - a-l extinde cu date de payout ar amesteca două
 *   concernuri fără legătură.
 * - GET /api/admin/legal/influencers (adminInfluencerTermsRoutes.js)
 *   e dedicat statusului Acordului de Influenceri (UserConsent) și
 *   include deja `payoutProfile` doar ca rezumat minim (fără
 *   detalii) - a-l extinde cu un endpoint de DETALII fiscale ar
 *   amesteca "acorduri legale" cu "date fiscale/bancare", două
 *   concernuri separate cu audiențe UI diferite.
 *
 * Concluzie: fișier NOU, dedicat, montat tot la /api/admin/influencers
 * (ca router sibling lui adminInfluencersRoutes.js - fără coliziune
 * de rute: acela expune doar "/", "/invite", "/invite/:id",
 * "/:id/commission-agreement[/:agreementId]", "/test").
 *
 * FAZA 2 (2026-09-09) - payout-uri: profilul fiscal rămâne read-only
 * (editarea e exclusiv acțiunea influencerului, GET/PATCH
 * /api/influencer/payout-profile). Ce se ADAUGĂ aici e strict
 * crearea/listarea InfluencerPayout (câștiguri neprocesate ->
 * payout UNPAID) - logica reală trăiește în
 * services/influencerPayoutService.js, ruta doar validează + mapează
 * status -> HTTP. NU implementează plată efectivă (Stripe/bancar) -
 * doar bookkeeping manual (vezi adminInfluencerPayoutActionsRoutes.js
 * pentru mark-paid, scoped pe :payoutId, nu :influencerId).
 *
 * FAZA 3 (2026-09-09) - FLUX FINAL: Artfest NU mai emite nicio
 * factură în numele influencerului (services/influencerCommissionInvoiceService.js
 * a fost ȘTERS - reprezenta sensul economic greșit, Artfest -> influencer,
 * cu credențialele SmartBill ale Artfest). Influencerul își încarcă
 * PROPRIA factură din contul lui (POST /api/influencer/payouts/:id/invoice) -
 * adminul doar VEDE/descarcă (GET /api/admin/invoices/:id/pdf, deja
 * existent, owner-agnostic) și marchează plătit. Câmpurile
 * `invoiceEligible`/`invoiceBlockedReason` din lista de mai jos au
 * fost eliminate odată cu fluxul vechi.
 */

import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, requireRole } from "../api/auth.js";

import {
  serializePayoutProfileFull,
} from "../services/influencerPayoutProfile.js";

import {
  getInfluencerConfirmedTotals,
} from "../services/influencerEarnings.js";

import {
  getInfluencerAvailableForPayout,
  getInfluencerLastPayout,
  listInfluencerPayouts,
  prepareInfluencerPayout,
} from "../services/influencerPayoutService.js";

const router = Router();

router.use(authRequired, requireRole("ADMIN"));

/*
 * GET /api/admin/influencers/payout-profiles
 *
 * Listă read-only, per influencer, cu statusul de completitudine
 * fiscală/bancară + câștigul confirmat. NU include NICIODATĂ IBAN
 * complet, taxId complet sau adresa fiscală completă - doar
 * `serializePayoutProfileFull` (folosit exclusiv de endpointul de
 * DETALII, mai jos) are acces la acele câmpuri.
 */
router.get("/payout-profiles", async (_req, res) => {
  try {
    const profiles = await prisma.influencerProfile.findMany({
      orderBy: { createdAt: "desc" },

      select: {
        id: true,
        userId: true,
        displayName: true,

        user: {
          select: {
            email: true,
            name: true,
            firstName: true,
            lastName: true,
          },
        },

        payoutProfile: {
          select: {
            beneficiaryType: true,
            isComplete: true,
            verificationStatus: true,
            updatedAt: true,
          },
        },
      },
    });

    const items = await Promise.all(
      profiles.map(async (profile) => {
        const [totals, available, lastPayout] = await Promise.all([
          getInfluencerConfirmedTotals(profile.id),
          getInfluencerAvailableForPayout(profile.id),
          getInfluencerLastPayout(profile.id),
        ]);

        const fallbackName = [
          profile.user?.firstName,
          profile.user?.lastName,
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

        return {
          influencerId: profile.id,
          userId: profile.userId,

          displayName:
            profile.displayName ||
            profile.user?.name ||
            fallbackName ||
            profile.user?.email ||
            "Influencer",

          email: profile.user?.email || "",

          beneficiaryType:
            profile.payoutProfile?.beneficiaryType || null,

          isComplete: Boolean(
            profile.payoutProfile?.isComplete
          ),

          verificationStatus:
            profile.payoutProfile?.verificationStatus ||
            "INCOMPLETE",

          updatedAt: profile.payoutProfile?.updatedAt || null,

          /*
           * Istoric complet, TOATE entries (folosit doar ca reper
           * informativ "Câștig confirmat total") - NU e suma
           * disponibilă pentru un payout nou, vezi availableForPayout.
           */
          confirmedEarningsAmount:
            totals.confirmedEarningsAmount,

          /*
           * STRICT InfluencerEarningEntry cu payoutId: null - suma
           * reală pe care un "Pregătește plata" ar crea-o ACUM.
           */
          availableForPayout: available.amount,
          availableEntryCount: available.entryCount,

          lastPayout: lastPayout
            ? {
                id: lastPayout.id,
                amount: Number(lastPayout.amount || 0),
                currency: lastPayout.currency,
                status: lastPayout.status,
                paidAt: lastPayout.paidAt,
                issuedAt: lastPayout.issuedAt,
                hasInvoice: Boolean(lastPayout.invoiceId),
              }
            : null,
        };
      })
    );

    return res.json({ ok: true, items });
  } catch (error) {
    console.error(
      "[adminInfluencerPayoutRoutes] GET /payout-profiles error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "admin_influencer_payout_profiles_failed",
    });
  }
});

/*
 * GET /api/admin/influencers/:id/payout-profile
 *
 * Detalii COMPLETE (inclusiv IBAN/taxId/adresă fiscală) pentru UN
 * influencer - doar ADMIN, doar pentru drawer-ul de detalii, NU
 * pentru listă.
 */
router.get("/:id/payout-profile", async (req, res) => {
  try {
    const { id } = req.params;

    const profile = await prisma.influencerProfile.findUnique({
      where: { id },

      select: {
        id: true,
        displayName: true,
        payoutProfile: true,
      },
    });

    if (!profile) {
      return res.status(404).json({
        ok: false,
        error: "influencer_not_found",
      });
    }

    return res.json({
      ok: true,
      influencerId: profile.id,
      displayName: profile.displayName || null,
      profile: serializePayoutProfileFull(profile.payoutProfile),
    });
  } catch (error) {
    console.error(
      "[adminInfluencerPayoutRoutes] GET /:id/payout-profile error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "admin_influencer_payout_profile_failed",
    });
  }
});

/*
 * GET /api/admin/influencers/:id/payouts
 *
 * Istoric complet InfluencerPayout pentru UN influencer, desc după
 * createdAt - folosit de secțiunea "Istoric plăți" din drawer.
 */
router.get("/:id/payouts", async (req, res) => {
  try {
    const { id } = req.params;

    const influencer = await prisma.influencerProfile.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!influencer) {
      return res.status(404).json({
        ok: false,
        error: "influencer_not_found",
      });
    }

    const payouts = await listInfluencerPayouts(id);

    return res.json({
      ok: true,
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
              totalGross: Number(p.invoice.totalGross || 0),
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
      "[adminInfluencerPayoutRoutes] GET /:id/payouts error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "admin_influencer_payouts_failed",
    });
  }
});

/*
 * POST /api/admin/influencers/:id/payouts
 *
 * "Pregătește plata" - creează un InfluencerPayout din TOATE
 * InfluencerEarningEntry curent neprocesate (payoutId: null) pentru
 * acest influencer. Transactional + idempotent (vezi
 * prepareInfluencerPayout - izolare Serializable, nu poate lega
 * aceleași entries în două payout-uri). NU emite factură, NU face
 * plată - doar "blochează" suma și o pregătește pentru pasul următor.
 */
router.post("/:id/payouts", async (req, res) => {
  try {
    const { id } = req.params;

    const influencer = await prisma.influencerProfile.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!influencer) {
      return res.status(404).json({
        ok: false,
        error: "influencer_not_found",
      });
    }

    const result = await prepareInfluencerPayout({ influencerId: id });

    switch (result.status) {
      case "CREATED":
        return res.json({ ok: true, payout: result.payout });

      case "NO_ENTRIES":
        return res.status(409).json({
          ok: false,
          error: "no_unprocessed_entries",
          message: "Nu există câștiguri neprocesate pentru acest influencer.",
        });

      case "ZERO_OR_NEGATIVE":
        return res.status(409).json({
          ok: false,
          error: "zero_or_negative_amount",
          message: "Suma netă disponibilă este 0 sau negativă.",
          amount: result.amount,
        });

      case "CONCURRENT_CONFLICT":
        return res.status(409).json({
          ok: false,
          error: "concurrent_conflict",
          message:
            "A apărut un conflict la crearea payout-ului - încearcă din nou.",
        });

      default:
        return res.status(500).json({
          ok: false,
          error: "unexpected_status",
        });
    }
  } catch (error) {
    console.error(
      "[adminInfluencerPayoutRoutes] POST /:id/payouts error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "admin_influencer_prepare_payout_failed",
    });
  }
});

export default router;
