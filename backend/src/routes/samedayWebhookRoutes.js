import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

/** Webhook Sameday — status update AWB */
router.post("/sameday/webhook", async (req, res) => {
  const event = req.body;
  try {
    const awb = event?.awbNumber;
    const status = event?.status;
    if (awb && status) {
      await prisma.shipment.updateMany({
        where: { awbNumber: awb },
        data: { status },
      });
    }
  } catch (e) {
    console.error("Sameday webhook", e);
  }
  res.json({ ok: true });
});

export default router;
