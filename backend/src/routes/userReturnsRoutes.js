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

export default router;
