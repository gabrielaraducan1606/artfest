// routes/adminVendorPlans.routes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { z } from "zod";

const router = Router();

const sendError = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, error: code, message: code, ...extra });

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const adminRequired = (req, res, next) => {
  if (req.user?.role === "ADMIN") return next();
  return sendError(res, "forbidden_admin", 403);
};

/* ===================== helpers pt meta(Json) ===================== */
function asObj(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v;
}
function mergeMeta(prev, patch) {
  const base = asObj(prev);
  const out = { ...base };
  for (const [k, val] of Object.entries(patch || {})) {
    out[k] = val;
  }
  return out;
}

/**
 * GET /api/admin/vendors/plans
 */
const Query = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  onlyWithSubscription: z.string().optional(),
});

router.get(
  "/admin/vendors/plans",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success)
      return sendError(res, "invalid_query", 400, { issues: parsed.error.issues });

    const { q, status, take, skip, onlyWithSubscription } = parsed.data;

    const vendorWhere = q?.trim()
      ? {
          OR: [
            { displayName: { contains: q.trim(), mode: "insensitive" } },
            { user: { email: { contains: q.trim(), mode: "insensitive" } } },
            { user: { firstName: { contains: q.trim(), mode: "insensitive" } } },
            { user: { lastName: { contains: q.trim(), mode: "insensitive" } } },
            { user: { name: { contains: q.trim(), mode: "insensitive" } } },
          ],
        }
      : undefined;

    const where = {
      ...(vendorWhere || {}),
      ...(onlyWithSubscription === "1" ? { subscriptions: { some: {} } } : {}),
    };

    const now = new Date();

    const [total, vendors] = await Promise.all([
      prisma.vendor.count({ where }),
      prisma.vendor.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              name: true,
              phone: true,
              role: true,
              status: true,
              createdAt: true,
            },
          },
          subscriptions: {
            ...(status ? { where: { status } } : {}),
            orderBy: [{ createdAt: "desc" }],
            take: 1,
            include: { plan: true },
          },
        },
      }),
    ]);

    const vendorIds = vendors.map((v) => v.id);

    const currentSubs = vendorIds.length
      ? await prisma.vendorSubscription.findMany({
          where: {
            vendorId: { in: vendorIds },
            status: "active",
            endAt: { gt: now },
          },
          orderBy: [{ startAt: "desc" }],
          include: { plan: true },
        })
      : [];

    const currentByVendor = new Map();
    for (const s of currentSubs) {
      if (!currentByVendor.has(s.vendorId)) currentByVendor.set(s.vendorId, s);
    }

    const items = vendors.map((v) => ({
      vendorId: v.id,
      displayName: v.displayName,
      vendorEmail: v.email,
      vendorPhone: v.phone,
      isActive: v.isActive,
      createdAt: v.createdAt,
      user: v.user,
      latestSubscription: v.subscriptions?.[0] || null,
      currentSubscription: currentByVendor.get(v.id) || null,
    }));

    res.json({ total, take, skip, items });
  })
);

/**
 * PATCH /api/admin/vendors/:vendorId/subscription/trial
 * Body: { trialDays: number } (0 => șterge trial)
 *
 * ✅ Stocăm trial-ul în subscription.meta:
 *  - meta.trialDays
 *  - meta.trialStartsAt (ISO)
 *  - meta.trialEndsAt   (ISO)
 */
const TrialBody = z.object({
  trialDays: z.coerce.number().int().min(0).max(365).default(0),
});

router.patch(
  "/admin/vendors/:vendorId/subscription/trial",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const vendorId = String(req.params.vendorId || "");
    if (!vendorId) return sendError(res, "missing_vendor_id", 400);

    const parsed = TrialBody.safeParse(req.body);
    if (!parsed.success)
      return sendError(res, "invalid_body", 400, { issues: parsed.error.issues });

    const { trialDays } = parsed.data;
    const now = new Date();

    const current = await prisma.vendorSubscription.findFirst({
      where: { vendorId, status: "active", endAt: { gt: now } },
      orderBy: { startAt: "desc" },
    });

    const target =
      current ??
      (await prisma.vendorSubscription.findFirst({
        where: { vendorId },
        orderBy: { createdAt: "desc" },
      }));

    if (!target) return sendError(res, "subscription_not_found", 404);

    const trialStartsAt = trialDays > 0 ? now : null;
    const trialEndsAt =
      trialDays > 0
        ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)
        : null;

    const nextMeta = mergeMeta(target.meta, {
      trialDays: trialDays > 0 ? trialDays : null,
      trialStartsAt: trialStartsAt ? trialStartsAt.toISOString() : null,
      trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    });

    const updated = await prisma.vendorSubscription.update({
      where: { id: target.id },
      data: {
        trialDays: trialDays > 0 ? trialDays : null,
        trialStartsAt: trialDays > 0 ? now : null,
        trialEndsAt:
          trialDays > 0
            ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000)
            : null,
        // dacă vrei să păstrezi meta, atunci:
        // meta: nextMeta,
      },
      include: { plan: true },
    });

    res.json({
      ok: true,
      subscription: updated,
      trial: {
        trialDays: trialDays > 0 ? trialDays : 0,
        trialStartsAt: trialStartsAt ? trialStartsAt.toISOString() : null,
        trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
      },
    });
  })
);

export default router;
