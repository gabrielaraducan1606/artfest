import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, requireRole } from "../api/auth.js";
import { z } from "zod";

const router = Router();

// --------- helpers ----------
const error = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ error: code, ...extra });

const normalizeCui = (raw = "") =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^RO/, "");

const isValidCifChecksum = (digits) => {
  if (!/^\d{2,10}$/.test(digits)) return false;
  const s = digits.padStart(10, "0");
  const base = s.slice(0, 9);
  const control = Number(s[9]);
  const w = [7, 5, 3, 2, 1, 7, 5, 3, 2];
  const sum = base.split("").reduce((acc, d, i) => acc + Number(d) * w[i], 0);
  let c = sum % 11;
  if (c === 10) c = 0;
  return c === control;
};

const normalizeIban = (raw = "") => raw.replace(/\s+/g, "").toUpperCase();

// --------- validare payload ----------
const BillingSchema = z.object({
  companyName:   z.string().trim().min(1, "Denumirea este obligatorie"),
  cui:           z.string().trim().min(2, "CUI obligatoriu"),
  regCom:        z.string().trim().min(1, "Nr. Reg. Com. obligatoriu"),
  address:       z.string().trim().min(1, "Adresa de facturare este obligatorie"),
  iban:          z.string().trim().min(1, "IBAN obligatoriu"),
  bank:          z.string().trim().min(1, "Banca este obligatorie"),
  email:         z.string().trim().email("Email invalid"),
  contactPerson: z.string().trim().optional(),
  phone:         z.string().trim().optional(),
});

// ===================== GET /api/vendors/me/billing =====================
router.get(
  "/me/billing",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: req.user.sub },
      include: { billing: true },
    });
    if (!vendor) return error(res, "vendor_profile_missing", 404);

    // întoarcem mereu { billing: {...} } (sau null)
    return res.json({ billing: vendor.billing });
  }
);

// ===================== PUT /api/vendors/me/billing =====================
router.put(
  "/me/billing",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: req.user.sub },
      select: { id: true },
    });
    if (!vendor) return error(res, "vendor_profile_missing", 404);

    const parsed = BillingSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    // normalize + validări suplimentare
    const input = parsed.data;

    const cuiDigits = normalizeCui(input.cui);
    if (!/^\d{2,10}$/.test(cuiDigits) || !isValidCifChecksum(cuiDigits)) {
      return error(res, "invalid_cui", 400, {
        message: "CUI invalid (format/cifră de control).",
      });
    }

    const ibanNorm = normalizeIban(input.iban);
    if (!/^RO\d{2}[A-Z]{4}\d{16}$/i.test(ibanNorm)) {
      return error(res, "invalid_iban", 400, {
        message: "IBAN RO invalid (ex: RO49AAAA1B31007593840000).",
      });
    }

    const payload = {
      companyName: input.companyName.trim(),
      cui: cuiDigits,
      regCom: input.regCom.toUpperCase().trim(),
      address: input.address.trim(),
      iban: ibanNorm,
      bank: input.bank.trim(),
      email: input.email.trim().toLowerCase(),
      contactPerson: input.contactPerson?.trim() || null,
      phone: input.phone?.trim() || null,
    };

    const saved = await prisma.vendorBilling.upsert({
      where: { vendorId: vendor.id },
      create: { vendorId: vendor.id, ...payload },
      update: payload,
    });

    return res.json({ ok: true, billing: saved });
  }
);

export default router;
