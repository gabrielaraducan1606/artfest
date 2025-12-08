import { Router } from "express";
import { prisma } from "../db.js";
import {
  authRequired,
  requireRole,
  enforceTokenVersion,
} from "../api/auth.js";

const router = Router();

router.use(authRequired, enforceTokenVersion, requireRole("VENDOR"));

async function getVendorIdForUser(req) {
  if (req.user.vendorId) return req.user.vendorId;

  const vendor = await prisma.vendor.findUnique({
    where: { userId: req.user.sub },
    select: { id: true },
  });
  return vendor?.id || null;
}

const STATUS_MAP = {
  nou: "NEW",
  in_discutii: "IN_DISCUSSION",
  oferta_trimisa: "OFFER_SENT",
  rezervat: "RESERVED",
  pierdut: "LOST",
};

/**
 * PATCH /api/inbox/threads/:id/meta
 * body: { status?, internalNote?, followUpAt? }
 */
router.patch("/inbox/threads/:id/meta", async (req, res) => {
  const vendorId = await getVendorIdForUser(req);
  if (!vendorId)
    return res.status(403).json({ error: "no_vendor_for_user" });

  const { id } = req.params;
  const { status, internalNote } = req.body;

  // followUpAt poate fi string ISO sau null sau deloc
  const hasFollowUpInBody = Object.prototype.hasOwnProperty.call(
    req.body,
    "followUpAt"
  );

  let followUpDate = null;
  if (hasFollowUpInBody) {
    if (req.body.followUpAt === null) {
      followUpDate = null;
    } else if (typeof req.body.followUpAt === "string") {
      const d = new Date(req.body.followUpAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: "invalid_followUpAt" });
      }

      // 🔴 AICI normalizăm la ora 08:00
      // (server time; dacă rulezi serverul pe UTC și vrei RO, poți compensa cu +2/+3)
      d.setHours(8, 0, 0, 0);
      followUpDate = d;
    } else {
      return res
        .status(400)
        .json({ error: "invalid_followUpAt_type" });
    }
  }

  const thread = await prisma.messageThread.findUnique({
    where: { id },
    select: {
      id: true,
      vendorId: true,
    },
  });

  if (!thread || thread.vendorId !== vendorId) {
    return res.status(404).json({ error: "thread_not_found" });
  }

  const dataToUpdate = {};

  if (typeof internalNote === "string") {
    dataToUpdate.internalNote = internalNote;
  }

  if (typeof status === "string") {
    const mapped = STATUS_MAP[status];
    if (!mapped) {
      return res.status(400).json({ error: "invalid_status" });
    }
    dataToUpdate.leadStatus = mapped;
  }

  if (hasFollowUpInBody) {
    dataToUpdate.followUpAt = followUpDate;
  }

  if (Object.keys(dataToUpdate).length === 0) {
    return res.json({ ok: true, thread });
  }

  const updated = await prisma.messageThread.update({
    where: { id },
    data: dataToUpdate,
  });

  res.json({ ok: true, thread: updated });
});

export default router;
