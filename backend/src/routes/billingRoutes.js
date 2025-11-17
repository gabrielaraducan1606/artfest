// backend/src/routes/billingRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";
import { verifyCuiAtAnaf } from "../utils/anaf.js";
import { z } from "zod";

const router = Router();

const ALLOWED_LEGAL_TYPES = ["SRL", "PFA", "II", "IF"];
const sendError = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, error: code, message: code, ...extra });

const normalizeCui = (raw = "") => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizeIban = (raw = "") => raw.replace(/\s+/g, "").toUpperCase();

const BillingSchema = z.object({
  legalType:     z.enum(ALLOWED_LEGAL_TYPES),
  vendorName:    z.string().trim().min(1),
  companyName:   z.string().trim().min(1),
  cui:           z.string().trim().min(2),
  regCom:        z.string().trim().min(1),
  address:       z.string().trim().min(1),
  iban:          z.string().trim().min(1),
  bank:          z.string().trim().min(1),
  email:         z.string().trim().email(),
  contactPerson: z.string().trim().min(1),
  phone:         z.string().trim().min(1),
});

/* GET /api/vendors/me/billing */
router.get("/me/billing", authRequired, vendorAccessRequired, async (req, res) => {
  const meVendor =
    req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return sendError(res, "vendor_profile_missing", 404);

  const billing = await prisma.vendorBilling.findUnique({ where: { vendorId: meVendor.id } });
  return res.json({ billing });
});

/* PUT /api/vendors/me/billing */
router.put("/me/billing", authRequired, vendorAccessRequired, async (req, res) => {
  const meVendor =
    req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return sendError(res, "vendor_profile_missing", 404);

  const parsed = BillingSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid_payload",
      details: parsed.error.flatten(),
      allowedLegalTypes: ALLOWED_LEGAL_TYPES,
    });
  }

  const input = parsed.data;

  const cuiNorm = normalizeCui(input.cui);
  const cuiDigits = cuiNorm.replace(/^RO/, "");
  if (!/^\d{2,10}$/.test(cuiDigits))
    return sendError(res, "invalid_cui", 400, { message: "CUI invalid (ex: RO12345678 sau 12345678)." });

  const ibanNorm = normalizeIban(input.iban);
  if (!/^RO\d{2}[A-Z]{4}[A-Z0-9]{16}$/i.test(ibanNorm))
    return sendError(res, "invalid_iban", 400, { message: "IBAN RO invalid (ex: RO49AAAA1B31007593840000)." });

  const payload = {
    legalType: input.legalType.toUpperCase(),
    vendorName: input.vendorName.trim(),
    companyName: input.companyName.trim(),
    cui: `RO${cuiDigits}`.replace(/^RORO/, "RO"),
    regCom: input.regCom.toUpperCase().trim(),
    address: input.address.trim(),
    iban: ibanNorm,
    bank: input.bank.trim(),
    email: input.email.trim().toLowerCase(),
    contactPerson: input.contactPerson.trim(),
    phone: input.phone.trim(),
  };

  const saved = await prisma.vendorBilling.upsert({
    where: { vendorId: meVendor.id },
    create: { vendorId: meVendor.id, ...payload },
    update: payload,
  });

  // fire-and-forget ANAF check
  (async () => {
    try {
      const ver = await verifyCuiAtAnaf(saved.cui);
      await prisma.vendorBilling.update({
        where: { vendorId: meVendor.id },
        data: {
          tvaActive: ver?.tvaActive ?? null,
          tvaVerifiedAt: new Date(),
          tvaSource: ver?.source ?? "anaf",
          anafName: ver?.name ?? null,
          anafAddress: ver?.address ?? null,
        },
      });
    } catch {}
  })();

  return res.json({ ok: true, billing: saved });
});

/* POST /api/vendors/me/billing/verify */
router.post("/me/billing/verify", authRequired, vendorAccessRequired, async (req, res) => {
  const meVendor =
    req.meVendor ?? (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
  if (!meVendor) return sendError(res, "vendor_profile_missing", 404);

  const billing = await prisma.vendorBilling.findUnique({ where: { vendorId: meVendor.id } });
  if (!billing)
    return sendError(res, "billing_not_found", 400, { hint: "Salvează întâi datele de facturare." });

  const cui = String(billing.cui || "").toUpperCase().trim();
  if (!/^(RO)?\d{2,10}$/i.test(cui))
    return sendError(res, "invalid_cui_format", 400, { hint: "Format CUI: RO12345678 sau 12345678." });

  let result;
  try {
    result = await verifyCuiAtAnaf(cui);
  } catch {
    result = { tvaActive: null, verifiedAt: new Date().toISOString(), source: "anaf", name: null, address: null };
  }

  const updated = await prisma.vendorBilling.update({
    where: { vendorId: meVendor.id },
    data: {
      tvaActive: result.tvaActive,
      tvaVerifiedAt: result.verifiedAt ? new Date(result.verifiedAt) : new Date(),
      tvaSource: result.source,
      anafName: result.name ?? null,
      anafAddress: result.address ?? null,
    },
  });

  return res.json({ ok: true, billing: updated });
});

export default router;
