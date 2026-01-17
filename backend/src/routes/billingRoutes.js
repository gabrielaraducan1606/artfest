import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";
import { verifyCuiAtAnaf } from "../utils/anaf.js";
import { z } from "zod";

const router = Router();

/* -----------------------------------------------------------
   CONSTANTE (JS friendly)
----------------------------------------------------------- */
const ALLOWED_LEGAL_TYPES = ["SRL", "PFA", "II", "IF"];
const ALLOWED_VAT_STATUS = ["payer", "non_payer"];

// ✅ platforma folosește doar cota standard
const PLATFORM_VAT_RATE = "21";

// ✅ aliniat cu UI (30s)
const MIN_VERIFY_INTERVAL_MS = 30 * 1000;

/* -----------------------------------------------------------
   HELPERE
----------------------------------------------------------- */
const sendError = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, error: code, message: code, ...extra });

const normalizeCui = (raw = "") => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizeIban = (raw = "") => raw.replace(/\s+/g, "").toUpperCase();

/* -----------------------------------------------------------
   VALIDARE PAYLOAD (ZOD)
   - nu mai acceptăm vatRate arbitrar; backend îl forțează la 21 când e payer
----------------------------------------------------------- */
const BillingSchema = z
  .object({
    legalType: z.enum(ALLOWED_LEGAL_TYPES),
    vendorName: z.string().trim().min(1),
    companyName: z.string().trim().min(1),
    cui: z.string().trim().min(2),
    regCom: z.string().trim().min(1),
    address: z.string().trim().min(1),
    iban: z.string().trim().min(1),
    bank: z.string().trim().min(1),
    email: z.string().trim().email(),
    contactPerson: z.string().trim().min(1),
    phone: z.string().trim().min(1),

    vatStatus: z.enum(ALLOWED_VAT_STATUS),

    // ✅ optional doar pentru back-compat (ignorăm valoarea primită)
    vatRate: z.string().optional(),

    vatResponsibilityConfirmed: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (!data.vatResponsibilityConfirmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vatResponsibilityConfirmed"],
        message: "Trebuie să confirmi responsabilitatea.",
      });
    }
  });

/* ============================================================
   GET /api/vendors/me/billing
============================================================ */
router.get(
  "/me/billing",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    const meVendor =
      req.meVendor ||
      (await prisma.vendor.findUnique({
        where: { userId: req.user.sub },
      }));

    if (!meVendor) return sendError(res, "vendor_profile_missing", 404);

    const billing = await prisma.vendorBilling.findUnique({
      where: { vendorId: meVendor.id },
    });

    if (!billing) return res.json({ billing: null });

    res.json({
      billing: {
        ...billing,
        registeredName: billing.anafName || null,
        registeredAddress: billing.anafAddress || null,
      },
    });
  }
);

/* ============================================================
   PUT /api/vendors/me/billing
============================================================ */
router.put(
  "/me/billing",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    const meVendor =
      req.meVendor ||
      (await prisma.vendor.findUnique({
        where: { userId: req.user.sub },
      }));

    if (!meVendor) return sendError(res, "vendor_profile_missing", 404);

    const parsed = BillingSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }

    const input = parsed.data;

    const cuiNorm = normalizeCui(input.cui);
    const cuiDigits = cuiNorm.replace(/^RO/, "");
    if (!/^\d{2,10}$/.test(cuiDigits)) {
      return sendError(res, "invalid_cui", 400, {
        message: "Format CUI invalid.",
      });
    }

    const ibanNorm = normalizeIban(input.iban);
    if (!/^RO\d{2}[A-Z]{4}[A-Z0-9]{16}$/i.test(ibanNorm)) {
      return sendError(res, "invalid_iban", 400, {
        message: "IBAN invalid.",
      });
    }

    const now = new Date();

    const payload = {
      legalType: input.legalType,
      vendorName: input.vendorName,
      companyName: input.companyName,
      cui: `RO${cuiDigits}`.replace(/^RORO/, "RO"),
      regCom: input.regCom,
      address: input.address,
      iban: ibanNorm,
      bank: input.bank,
      email: input.email.toLowerCase(),
      contactPerson: input.contactPerson,
      phone: input.phone,

      vatStatus: input.vatStatus,

      // ✅ BACKEND = source of truth:
      // - payer => 21
      // - non_payer => null
      vatRate: input.vatStatus === "payer" ? PLATFORM_VAT_RATE : null,

      vatResponsibilityConfirmed: input.vatResponsibilityConfirmed,
      vatLastResponsibilityConfirm: input.vatResponsibilityConfirmed ? now : null,
    };

    const saved = await prisma.vendorBilling.upsert({
      where: { vendorId: meVendor.id },
      update: payload,
      create: { vendorId: meVendor.id, ...payload },
    });

    // verificare ANAF async – setează tvaActive + info ANAF
    (async () => {
      try {
        const ver = await verifyCuiAtAnaf(saved.cui);
        await prisma.vendorBilling.update({
          where: { vendorId: meVendor.id },
          data: {
            tvaActive: ver ? ver.tvaActive : null,
            tvaVerifiedAt: new Date(),
            tvaSource: ver ? ver.source : "anaf",
            anafName: ver ? ver.name : null,
            anafAddress: ver ? ver.address : null,

            // ❗ NU salvăm tvaCode dacă nu există coloana în DB
            // tvaCode: ver?.tvaCode || saved.cui || null,
          },
        });
      } catch (e) {
        console.error("[ANAF verify async] error:", e);
      }
    })();

    res.json({ ok: true, billing: saved });
  }
);

/* ============================================================
   POST /api/vendors/me/billing/verify
============================================================ */
router.post(
  "/me/billing/verify",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const meVendor =
        req.meVendor ||
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
        }));
      if (!meVendor) return sendError(res, "vendor_profile_missing", 404);

      const billing = await prisma.vendorBilling.findUnique({
        where: { vendorId: meVendor.id },
      });
      if (!billing) return sendError(res, "billing_not_found", 400);

      if (
        billing.tvaVerifiedAt &&
        Date.now() - billing.tvaVerifiedAt.getTime() < MIN_VERIFY_INTERVAL_MS
      ) {
        return sendError(res, "too_soon", 429, {
          message: "Verificarea poate fi reluată mai târziu.",
        });
      }

      const cui = (billing.cui || "").toUpperCase().trim();
      if (!/^(RO)?\d{2,10}$/.test(cui)) {
        return sendError(res, "invalid_cui_format", 400);
      }

      let result;
      try {
        result = await verifyCuiAtAnaf(cui);
      } catch (err) {
        console.error("[ANAF verify immediate] error:", err);
        result = {
          tvaActive: null,
          verifiedAt: new Date().toISOString(),
          source: "ANAF_TEMP_DOWN",
          name: null,
          address: null,
          tvaCode: cui.startsWith("RO") ? cui : `RO${cui}`,
        };
      }

      const updated = await prisma.vendorBilling.update({
        where: { vendorId: meVendor.id },
        data: {
          tvaActive: result.tvaActive,
          tvaVerifiedAt: new Date(),
          tvaSource: result.source,
          anafName: result.name,
          anafAddress: result.address,

          // ❗ NU salvăm tvaCode dacă nu există coloana în DB
          // tvaCode: result.tvaCode || null,
        },
      });

      return res.json({ ok: true, billing: updated });
    } catch (e) {
      console.error("[verify endpoint] FAILED:", e);
      return res.status(500).json({
        ok: false,
        error: "internal_error",
        message: e?.message || "Internal Server Error",
      });
    }
  }
);

export default router;
