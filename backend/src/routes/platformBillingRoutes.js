import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { z } from "zod";

const router = Router();

function adminRequired(req, res, next) {
  // în proiectul tău ai Role enum: USER | VENDOR | ADMIN
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "not_admin" });
  }
  next();
}

const PlatformBillingInput = z.object({
  companyName: z.string().min(2),
  legalType: z.string().optional().nullable(),
  cui: z.string().min(2),
  regCom: z.string().optional().nullable(),
  address: z.string().min(5),
  iban: z.string().optional().nullable(),
  bank: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  vatPayer: z.boolean().optional(),
  invoiceSeries: z.string().optional().nullable(),
});

/**
 * GET /api/admin/platform/billing
 */
router.get("/admin/platform/billing", authRequired, adminRequired, async (req, res) => {
  try {
    const billing = await prisma.platformBilling.findFirst({
      orderBy: { createdAt: "asc" },
    });
    res.json({ billing: billing || null });
  } catch (err) {
    console.error("GET /admin/platform/billing FAILED:", err);
    res.status(500).json({ error: "platform_billing_load_failed" });
  }
});

/**
 * PUT /api/admin/platform/billing
 * single-row upsert (ținând 1 singur profil fiscal pt platformă)
 */
router.put("/admin/platform/billing", authRequired, adminRequired, async (req, res) => {
  try {
    const payload = PlatformBillingInput.parse(req.body || {});
    const existing = await prisma.platformBilling.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    const data = {
      companyName: payload.companyName,
      legalType: payload.legalType ?? null,
      cui: payload.cui,
      regCom: payload.regCom ?? null,
      address: payload.address,
      iban: payload.iban ?? null,
      bank: payload.bank ?? null,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      vatPayer: typeof payload.vatPayer === "boolean" ? payload.vatPayer : undefined,
      invoiceSeries: payload.invoiceSeries ?? null,
    };

    const saved = existing
      ? await prisma.platformBilling.update({ where: { id: existing.id }, data })
      : await prisma.platformBilling.create({ data: { ...data, invoiceSeries: data.invoiceSeries || "AF" } });

    res.json({ ok: true, billing: saved });
  } catch (err) {
    console.error("PUT /admin/platform/billing FAILED:", err);
    res.status(400).json({
      error: "platform_billing_save_failed",
      message: err?.message || "Nu am putut salva profilul fiscal.",
    });
  }
});

export default router;
