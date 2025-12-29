import express from "express";
import {prisma} from "../db.js";
import { authRequired } from "../api/auth.js";

const router = express.Router();

/**
 * GET /api/admin/email-logs
 * Query:
 *  - q (search in toEmail / subject)
 *  - toEmail
 *  - status (QUEUED|SENT|FAILED)
 *  - senderKey (noreply|contact|admin)
 *  - template
 *  - page (default 1)
 *  - pageSize (default 25)
 */
router.get("/api/admin/email-logs", authRequired, async (req, res) => {
  const {
    q = "",
    toEmail = "",
    status = "ALL",
    senderKey = "ALL",
    template = "ALL",
    page = "1",
    pageSize = "25",
  } = req.query;

  const take = Math.min(Number(pageSize) || 25, 100);
  const p = Math.max(Number(page) || 1, 1);
  const skip = (p - 1) * take;

  const where = {};

  const qTrim = String(q || "").trim();
  const toTrim = String(toEmail || "").trim();

  if (toTrim) where.toEmail = { contains: toTrim, mode: "insensitive" };

  if (qTrim) {
    where.OR = [
      { toEmail: { contains: qTrim, mode: "insensitive" } },
      { subject: { contains: qTrim, mode: "insensitive" } },
      { template: { contains: qTrim, mode: "insensitive" } },
    ];
  }

  if (status !== "ALL") where.status = status;
  if (senderKey !== "ALL") where.senderKey = senderKey;
  if (template !== "ALL") where.template = template;

  const [total, logs] = await Promise.all([
    prisma.emailLog.count({ where }),
    prisma.emailLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true, name: true } },
      },
    }),
  ]);

  res.json({
    logs,
    page: p,
    pageSize: take,
    total,
    totalPages: total ? Math.ceil(total / take) : 1,
  });
});

/**
 * GET /api/admin/users/:id/email-logs
 * (lista pentru un user în drawer)
 */
router.get("/api/admin/users/:id/email-logs", authRequired, async (req, res) => {
  const userId = req.params.id;

  const logs = await prisma.emailLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  res.json({ logs });
});

export default router;
