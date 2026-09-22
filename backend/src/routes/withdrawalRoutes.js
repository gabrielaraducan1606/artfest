// backend/src/routes/withdrawalRoutes.js
//
// Funcția online de retragere din contract (Returns v2 §4.3).
//
//  Client autentificat (montat la /api/user/orders):
//    GET  /api/user/orders/:id/withdrawal   - eligibilitate + declarații existente
//    POST /api/user/orders/:id/withdrawal   - transmite declarația
//
//  Guest (montat la /api/guest/orders, acces prin token-ul comenzii):
//    GET  /api/guest/orders/:id/withdrawal?token=...
//    POST /api/guest/orders/:id/withdrawal?token=...
//
// Folosește modelul existent WithdrawalRequest (fără schimbări de
// schemă). Logica în services/withdrawalService.js.

import { Router } from "express";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import {
  WithdrawalError,
  buildWithdrawalStatusPayload,
  findGuestOrderForWithdrawal,
  findUserOrderForWithdrawal,
  submitWithdrawal,
} from "../services/withdrawalService.js";

export const userWithdrawalRouter = Router();
export const guestWithdrawalRouter = Router();

function sendError(res, status, error, message, extra = {}) {
  return res.status(status).json({ ok: false, error, message, ...extra });
}

function handleFailure(res, error, label) {
  if (error instanceof WithdrawalError) {
    return sendError(
      res,
      error.status,
      error.code,
      error.message,
      error.extra
    );
  }

  console.error(`${label} FAILED:`, error);

  return sendError(
    res,
    500,
    "withdrawal_failed",
    "Declarația de retragere nu a putut fi procesată. Te rugăm să încerci din nou."
  );
}

function readSubmission(req) {
  const body = req.body || {};

  return {
    clientName: body.clientName,
    contactEmail: body.contactEmail,
    shipmentIds: Array.isArray(body.shipmentIds)
      ? body.shipmentIds.filter((id) => typeof id === "string")
      : [],
    confirmed: body.confirmed === true,
    ip: req.ip || null,
    userAgent: req.get("user-agent") || null,
  };
}

/* ----------------------------------------------------
   Client autentificat
----------------------------------------------------- */

userWithdrawalRouter.get(
  "/:id/withdrawal",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const order = await findUserOrderForWithdrawal({
        userId: req.user.sub,
        reference: req.params.id,
      });

      if (!order) {
        return sendError(res, 404, "not_found", "Comanda nu a fost găsită.");
      }

      return res.json(buildWithdrawalStatusPayload(order));
    } catch (error) {
      return handleFailure(res, error, "GET /api/user/orders/:id/withdrawal");
    }
  }
);

userWithdrawalRouter.post(
  "/:id/withdrawal",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const order = await findUserOrderForWithdrawal({
        userId: req.user.sub,
        reference: req.params.id,
      });

      if (!order) {
        return sendError(res, 404, "not_found", "Comanda nu a fost găsită.");
      }

      const result = await submitWithdrawal({
        order,
        userId: req.user.sub,
        ...readSubmission(req),
      });

      return res.status(201).json({ ok: true, withdrawal: result });
    } catch (error) {
      return handleFailure(res, error, "POST /api/user/orders/:id/withdrawal");
    }
  }
);

/* ----------------------------------------------------
   Guest (token de acces al comenzii)
----------------------------------------------------- */

function guestToken(req) {
  return String(req.query.token || req.body?.token || "").trim();
}

guestWithdrawalRouter.get("/:id/withdrawal", async (req, res) => {
  try {
    const token = guestToken(req);

    if (!token) {
      return sendError(
        res,
        400,
        "guest_order_access_invalid",
        "Lipsește tokenul de acces al comenzii."
      );
    }

    const order = await findGuestOrderForWithdrawal({
      reference: req.params.id,
      token,
    });

    if (!order) {
      return sendError(
        res,
        404,
        "guest_order_not_found",
        "Comanda nu a fost găsită sau linkul nu mai este valid."
      );
    }

    return res.json(buildWithdrawalStatusPayload(order));
  } catch (error) {
    return handleFailure(res, error, "GET /api/guest/orders/:id/withdrawal");
  }
});

guestWithdrawalRouter.post("/:id/withdrawal", async (req, res) => {
  try {
    const token = guestToken(req);

    if (!token) {
      return sendError(
        res,
        400,
        "guest_order_access_invalid",
        "Lipsește tokenul de acces al comenzii."
      );
    }

    const order = await findGuestOrderForWithdrawal({
      reference: req.params.id,
      token,
    });

    if (!order) {
      return sendError(
        res,
        404,
        "guest_order_not_found",
        "Comanda nu a fost găsită sau linkul nu mai este valid."
      );
    }

    // userId rămâne null: retragerea guest nu creează cont.
    const result = await submitWithdrawal({
      order,
      userId: null,
      ...readSubmission(req),
    });

    return res.status(201).json({ ok: true, withdrawal: result });
  } catch (error) {
    return handleFailure(res, error, "POST /api/guest/orders/:id/withdrawal");
  }
});
