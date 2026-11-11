// backend/src/routes/userReturnsRoutes.js
//
// POST /api/user/returns - cerere de RETUR / NECONFORMITATE inițiată de
// client (formularul ReturnRequestModal din /comenzile-mele).
//
// Folosește STRICT modelele existente ReturnRequest / ReturnRequestItem
// (fără schimbări de schemă). Regulile și efectele (notificări, emailuri)
// sunt în services/returnRequestCreate.js - comune cu fluxul guest
// (routes/guestReturnsRoutes.js). Retragerea legală fără motiv
// (OUG 34/2014) prin declarație e un flux DISTINCT (WithdrawalRequest) -
// vezi withdrawalRoutes.js.
//
// Montat în server.js ÎNAINTE de /api/user (userRoutes cere rol USER pe
// toate rutele; proprietatea comenzii se verifică aici pe userId, ca în
// userOrdersRoutes.js - un vânzător care cumpără își poate returna
// comenzile).

import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import {
  ReturnPayload,
  clientReturnLink,
  createReturnRequest,
  returnOrderSelect,
  sendCreateError,
} from "../services/returnRequestCreate.js";
import { getReturnAwbLabelForClient } from "../couriers/awb/awbService.js";
import {
  ReturnFlowError,
  returnAddressCatalog,
  sendReturnFlowError,
  setReturnMethod,
} from "../services/returnShipmentService.js";
import { handleCourier, requireCourierIntegration, sendAwbLabelPdf } from "../couriers/http.js";

const router = Router();

router.use(authRequired, enforceTokenVersion);

router.post("/", async (req, res) => {
  try {
    const parsed = ReturnPayload.safeParse(req.body || {});

    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        message: "Datele cererii de retur sunt invalide.",
        details: parsed.error.flatten(),
      });
    }

    const input = parsed.data;
    const userId = req.user.sub;

    // Comanda trebuie să aparțină userului logat.
    const order = await prisma.order.findFirst({
      relationLoadStrategy: "query",
      where: {
        userId,
        OR: [{ id: input.orderId }, { orderNumber: input.orderId }],
      },
      select: returnOrderSelect(input.shipmentId),
    });

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "not_found",
        message: "Comanda nu a fost găsită.",
      });
    }

    const result = await createReturnRequest({
      db: prisma,
      order,
      userId,
      input,
      clientLink: clientReturnLink({ orderId: order.id }),
    });

    return res.status(201).json(result);
  } catch (error) {
    return sendCreateError(res, error, "POST /api/user/returns");
  }
});

/*
 * PATCH /api/user/returns/:id/method - clientul alege / schimbă metoda de retur
 * (HOME_PICKUP cu adresa confirmată, validată în nomenclatorul Sameday, sau
 * CUSTOMER_SELF). Doar cererile proprii; blocat după generarea AWB-ului.
 * Body: { returnMethod, pickupAddress? }
 */
router.patch("/:id/method", async (req, res) => {
  try {
    const returnMethod = String(req.body?.returnMethod || "");
    const result = await setReturnMethod({
      db: prisma,
      returnRequestId: String(req.params.id),
      scope: { userId: req.user.sub },
      returnMethod,
      pickupAddress: req.body?.pickupAddress,
      catalog: returnMethod === "HOME_PICKUP" ? await returnAddressCatalog(prisma) : null,
    });
    return res.json({ ok: true, returnRequest: result });
  } catch (error) {
    if (error instanceof ReturnFlowError) return sendReturnFlowError(res, error);
    console.error("PATCH /api/user/returns/:id/method FAILED:", error?.code || error?.name || "Error");
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

/*
 * GET /api/user/returns/:id/label - eticheta AWB-ului de RETUR (PDF A6, de la
 * Sameday prin backend) pentru clientul care a cerut returul. Doar cererile
 * proprii; fără AWB de retur confirmat -> 404 (nimic despre alți useri).
 * Comutatorul general COURIER_INTEGRATION_ENABLED se aplică.
 */
router.get("/:id/label", requireCourierIntegration, handleCourier(async (req, res) => {
  const label = await getReturnAwbLabelForClient({
    userId: req.user.sub,
    returnRequestId: req.params.id,
    format: String(req.query.format || "A6").toUpperCase() === "A4" ? "A4" : "A6",
  });
  return sendAwbLabelPdf(res, label);
}, "userReturnsRoutes"));

export default router;
