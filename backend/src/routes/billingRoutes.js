import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";
import { verifyCuiAtAnaf } from "../utils/anaf.js";
import { z } from "zod";

const router = Router();

const ALLOWED_SELLER_TYPES = ["independent_creator", "verified_business"];
const ALLOWED_LEGAL_TYPES = ["SRL", "PFA", "II", "IF"];
const ALLOWED_VAT_STATUS = ["payer", "non_payer"];

const PLATFORM_VAT_RATE = "21";
const MIN_VERIFY_INTERVAL_MS = 30 * 1000;

const sendError = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, error: code, message: code, ...extra });

const normalizeCui = (raw = "") => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

function hasBusinessBillingData(b) {
  if (!b) return false;

  return !!(
    b.legalType ||
    b.companyName ||
    b.cui ||
    b.regCom ||
    b.vatStatus
  );
}

function normalizeSellerTypeFromBilling(b) {
  if (!b) return "";

  const raw = b.sellerType || "";

  if (ALLOWED_SELLER_TYPES.includes(raw)) {
    return raw;
  }

  if (hasBusinessBillingData(b)) {
    return "verified_business";
  }

  return "";
}
const emptyToNull = (v) => (v === "" ? null : v);
const BillingSchema = z
  .object({
    sellerType: z.enum(ALLOWED_SELLER_TYPES),

    legalType: z.preprocess(
      emptyToNull,
      z.enum(ALLOWED_LEGAL_TYPES).optional().nullable()
    ),

    vendorName: z.string().trim().min(1),

    companyName: z.preprocess(
      emptyToNull,
      z.string().trim().optional().nullable()
    ),

    cui: z.preprocess(
      emptyToNull,
      z.string().trim().optional().nullable()
    ),

    regCom: z.preprocess(
      emptyToNull,
      z.string().trim().optional().nullable()
    ),

    address: z.string().trim().min(1),
    email: z.string().trim().email(),
    contactPerson: z.string().trim().min(1),
    phone: z.string().trim().min(1),

    vatStatus: z.preprocess(
      emptyToNull,
      z.enum(ALLOWED_VAT_STATUS).optional().nullable()
    ),

    vatRate: z.preprocess(
      emptyToNull,
      z.string().optional().nullable()
    ),

    vatResponsibilityConfirmed: z.boolean().optional().default(false),
    taxResponsibilityConfirmed: z.boolean().optional().default(false),
    independentTermsConfirmed: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.sellerType === "verified_business") {
      if (!data.legalType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["legalType"],
          message: "Alege tipul entității.",
        });
      }

      if (!data.companyName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["companyName"],
          message: "Completează denumirea entității.",
        });
      }

      if (!data.cui?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cui"],
          message: "Completează CUI.",
        });
      }

      if (!data.regCom?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["regCom"],
          message: "Completează numărul de registru.",
        });
      }

      if (!data.vatStatus) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["vatStatus"],
          message: "Alege statutul TVA.",
        });
      }

      if (!data.vatResponsibilityConfirmed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["vatResponsibilityConfirmed"],
          message: "Trebuie să confirmi responsabilitatea fiscală.",
        });
      }
    }

    if (data.sellerType === "independent_creator") {
      if (!data.taxResponsibilityConfirmed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["taxResponsibilityConfirmed"],
          message: "Trebuie să confirmi responsabilitatea fiscală.",
        });
      }

      if (!data.independentTermsConfirmed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["independentTermsConfirmed"],
          message: "Trebuie să confirmi condițiile pentru Creator Independent.",
        });
      }
    }
  });

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

    if (!billing) {
      return res.json({
        ok: true,
        vendorId: meVendor.id,
        billing: null,
      });
    }

    const sellerType = normalizeSellerTypeFromBilling(billing);

    return res.json({
      ok: true,
      vendorId: meVendor.id,
      billing: {
        ...billing,
        sellerType,
        registeredName: billing.anafName || null,
        registeredAddress: billing.anafAddress || null,
      },
    });
  }
);

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
        message: "Datele de facturare sunt invalide.",
        details: parsed.error.flatten(),
      });
    }

    const input = parsed.data;
    const now = new Date();

    let payload;

    if (input.sellerType === "independent_creator") {
      payload = {
        sellerType: "independent_creator",

        legalType: null,
        vendorName: input.vendorName,
        companyName: null,
        cui: null,
        regCom: null,

        address: input.address,
        email: input.email.toLowerCase(),
        contactPerson: input.contactPerson,
        phone: input.phone,

        vatStatus: null,
        vatRate: null,
        vatResponsibilityConfirmed: false,
        vatLastResponsibilityConfirm: null,

        taxResponsibilityConfirmed: input.taxResponsibilityConfirmed,
        taxResponsibilityConfirmedAt: input.taxResponsibilityConfirmed
          ? now
          : null,

        independentTermsConfirmed: input.independentTermsConfirmed,
        independentTermsConfirmedAt: input.independentTermsConfirmed
          ? now
          : null,

        tvaActive: null,
        tvaVerifiedAt: null,
        tvaSource: null,
        anafName: null,
        anafAddress: null,
        tvaRegStart: null,
        tvaRegEnd: null,
        inactiv: null,
        inactivFrom: null,
        insolvent: null,
        splitTva: null,
        anafPayload: null,
      };
    }

    if (input.sellerType === "verified_business") {
      const cuiNorm = normalizeCui(input.cui);
      const cuiDigits = cuiNorm.replace(/^RO/, "");

      if (!/^\d{2,10}$/.test(cuiDigits)) {
        return sendError(res, "invalid_cui", 400, {
          message: "Format CUI invalid.",
        });
      }

      payload = {
        sellerType: "verified_business",

        legalType: input.legalType,
        vendorName: input.vendorName,
        companyName: input.companyName,
        cui: `RO${cuiDigits}`.replace(/^RORO/, "RO"),
        regCom: input.regCom,

        address: input.address,
        email: input.email.toLowerCase(),
        contactPerson: input.contactPerson,
        phone: input.phone,

        vatStatus: input.vatStatus,
        vatRate: input.vatStatus === "payer" ? PLATFORM_VAT_RATE : null,

        vatResponsibilityConfirmed: input.vatResponsibilityConfirmed,
        vatLastResponsibilityConfirm: input.vatResponsibilityConfirmed
          ? now
          : null,

        taxResponsibilityConfirmed: false,
        taxResponsibilityConfirmedAt: null,
        independentTermsConfirmed: false,
        independentTermsConfirmedAt: null,
      };
    }

    if (!payload) {
      return sendError(res, "invalid_seller_type", 400);
    }

    const saved = await prisma.vendorBilling.upsert({
      where: { vendorId: meVendor.id },
      update: payload,
      create: {
        vendorId: meVendor.id,
        ...payload,
      },
    });

    if (input.sellerType === "verified_business" && saved.cui) {
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
            },
          });
        } catch (e) {
          console.error("[ANAF verify async] error:", e);
        }
      })();
    }

    return res.json({
      ok: true,
      vendorId: meVendor.id,
      billing: {
        ...saved,
        sellerType: normalizeSellerTypeFromBilling(saved),
        registeredName: saved.anafName || null,
        registeredAddress: saved.anafAddress || null,
      },
    });
  }
);

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

      const sellerType = normalizeSellerTypeFromBilling(billing);

      if (sellerType === "independent_creator") {
        return sendError(res, "anaf_not_available_for_independent_creator", 400, {
          message: "Verificarea ANAF este disponibilă doar pentru business-uri.",
        });
      }

      if (!billing.cui) {
        return sendError(res, "cui_missing", 400, {
          message: "CUI lipsă.",
        });
      }

      if (
        billing.tvaVerifiedAt &&
        Date.now() - billing.tvaVerifiedAt.getTime() < MIN_VERIFY_INTERVAL_MS
      ) {
        return sendError(res, "too_soon", 429, {
          message: "Verificarea poate fi reluată mai târziu.",
        });
      }

      const cui = billing.cui.toUpperCase().trim();

      if (!/^(RO)?\d{2,10}$/.test(cui)) {
        return sendError(res, "invalid_cui_format", 400, {
          message: "Format CUI invalid.",
        });
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
        },
      });

      return res.json({
        ok: true,
        vendorId: meVendor.id,
        billing: {
          ...updated,
          sellerType: normalizeSellerTypeFromBilling(updated),
          registeredName: updated.anafName || null,
          registeredAddress: updated.anafAddress || null,
        },
      });
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