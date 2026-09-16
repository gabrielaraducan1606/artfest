// backend/src/routes/adminInfluencerPayoutActionsRoutes.js

/*
 * Acțiuni admin scoped pe un InfluencerPayout individual (nu pe un
 * influencer) - fișier separat de adminInfluencerPayoutRoutes.js
 * (acela e scoped pe :influencerId, prefix /api/admin/influencers).
 *
 * FLUX FINAL (2026-09-09, înlocuiește varianta anterioară): Artfest NU
 * mai emite nicio factură în numele influencerului - influencerul își
 * emite factura EL, în afara platformei, și o încarcă din contul lui
 * (vezi POST /api/influencer/payouts/:payoutId/invoice). Ruta de aici
 * pentru "creare factură admin" (fostul POST /:payoutId/invoice, care
 * apela services/influencerCommissionInvoiceService.js) a fost
 * ELIMINATĂ, nu doar dezactivată - acel serviciu a fost șters complet
 * (reprezenta sensul economic greșit: Artfest -> influencer, cu
 * credențialele SmartBill ale Artfest). Adminul doar VEDE/descarcă
 * factura încărcată de influencer, prin GET /api/admin/invoices/:id/pdf
 * (deja existent, owner-agnostic) - fără endpoint nou pentru asta.
 *
 * Ce rămâne aici: STRICT marcarea manuală ca plătit (bookkeeping, NU
 * declanșează niciun transfer bancar/Stripe).
 */

import { Router } from "express";
import { z } from "zod";
import { authRequired, requireRole } from "../api/auth.js";

import {
  markInfluencerPayoutAsPaid,
  InfluencerPayoutStateError,
} from "../services/influencerPayoutService.js";

const router = Router();

router.use(authRequired, requireRole("ADMIN"));

const MarkPaidPayload = z.object({
  paidAt: z.string().datetime().optional(),
  paymentReference: z.string().max(255).optional(),
});

/*
 * POST /api/admin/influencer-payouts/:payoutId/mark-paid
 *
 * "Marchează ca plătit" - STRICT bookkeeping manual (adminul a făcut
 * deja transferul prin IBAN, în afara aplicației). NU apelează
 * Stripe, NU apelează niciun API bancar.
 */
router.post("/:payoutId/mark-paid", async (req, res) => {
  try {
    const { payoutId } = req.params;
    const parsed = MarkPaidPayload.parse(req.body || {});

    const payout = await markInfluencerPayoutAsPaid({
      payoutId,
      paidAt: parsed.paidAt,
      paymentReference: parsed.paymentReference,
    });

    return res.json({ ok: true, payout });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        details: error.errors,
      });
    }

    if (error instanceof InfluencerPayoutStateError) {
      const status = error.code === "payout_not_found" ? 404 : 409;

      return res.status(status).json({
        ok: false,
        error: error.code,
        message: error.message,
      });
    }

    console.error(
      "[adminInfluencerPayoutActionsRoutes] POST /:payoutId/mark-paid error:",
      error
    );

    return res.status(500).json({
      ok: false,
      error: "admin_influencer_payout_mark_paid_failed",
    });
  }
});

export default router;
