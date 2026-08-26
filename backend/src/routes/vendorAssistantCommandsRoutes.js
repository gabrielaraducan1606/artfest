// backend/src/routes/vendorAssistantCommandsRoutes.js

/*
 * Strat de rută SUBȚIRE pentru Vendor Assistant - validare de
 * request + delegare la vendorAssistantCommandService.js, care
 * conține toată logica de clasificare/extragere/construire a
 * răspunsurilor (fost inline aici, extras ca parte a
 * refactorului de organizare a fișierelor de rută din
 * Vendor Assistant / Costuri & Profit).
 */

import { Router } from "express";

import {
  authRequired,
  requireRole,
  enforceTokenVersion,
} from "../api/auth.js";

import { prisma } from "../db.js";
import { openai } from "../lib/openai.js";

import {
  resolveVendorByUserId,
  buildUpdateCostItemPendingActionFromMatch,
  computeUnitCostCentsFromExtraction,
  normalizeUnitLabel,
} from "../services/costProfitService.js";

import {
  safeJsonParse,
  cleanHistory,
  buildProductCostAnswer,
  buildUpdateCostingPendingAction,
  buildApplyPricePendingAction,
  PRODUCT_UPDATE_ALLOWED_FIELDS,
  buildProductFieldQuestion,
  buildProductPreview,
  buildWhitelistedProductPatch,
  loadOwnedProductForUpdate,
  buildUpdateProductPendingAction,
  handleUpdateProduct,
  buildPrompt,
  dispatchCommand,
} from "../services/vendorAssistantCommandService.js";

const router = Router();

const commandAccess = [
  authRequired,
  enforceTokenVersion,
  requireRole("VENDOR", "ADMIN"),
];

router.post(
  "/assistant/command",
  commandAccess,
  async (req, res) => {
    try {
      const message = String(
        req.body?.message || ""
      )
        .trim()
        .slice(0, 3000);

      const history = cleanHistory(
        req.body?.history
      );

      /*
       * Context opțional pentru clarificări UPDATE_PRODUCT - DOUĂ
       * variante posibile:
       * 1. productId cunoscut, lipsește o VALOARE de câmp (ex.
       *    "care e noul preț?") - indiciu suplimentar pentru
       *    ACELAȘI apel LLM, transmis mai departe la
       *    dispatchCommand ca plasă de siguranță determinist.
       * 2. productId NECUNOSCUT, lipsește chiar NUMELE produsului
       *    (ex. "pentru ce produs?" -> "odorizant") - aici NU mai
       *    trecem deloc prin LLM (vezi bypass-ul de mai jos): un
       *    mesaj-ecou izolat ca "odorizant" e ușor clasificat greșit
       *    de model (ex. READ_PROFITABILITY fără filtru -> întregul
       *    catalog), deci tratăm mesajul curent DIRECT ca nume de
       *    produs prin resolveProductByName, vendor-scoped.
       */
      const rawPendingContext =
        req.body?.pendingContext;

      const isValidRawPendingContext =
        rawPendingContext &&
        typeof rawPendingContext === "object" &&
        rawPendingContext.commandType ===
          "UPDATE_PRODUCT";

      const pendingProductNameContext =
        isValidRawPendingContext &&
        rawPendingContext.awaitingField ===
          "product"
          ? {
              commandType: "UPDATE_PRODUCT",
              awaitingField: "product",

              missingUpdateField: rawPendingContext.missingUpdateField
                ? String(
                    rawPendingContext.missingUpdateField
                  )
                : null,

              productUpdate:
                rawPendingContext.productUpdate &&
                typeof rawPendingContext.productUpdate ===
                  "object"
                  ? rawPendingContext.productUpdate
                  : null,
            }
          : null;

      const pendingContext =
        isValidRawPendingContext &&
        rawPendingContext.productId
          ? {
              commandType: "UPDATE_PRODUCT",

              productId: String(
                rawPendingContext.productId
              ),

              missingField: String(
                rawPendingContext.missingField ||
                  ""
              ),

              question:
                buildProductFieldQuestion(
                  String(
                    rawPendingContext.missingField ||
                      ""
                  )
                ),
            }
          : null;

      if (!message) {
        return res.status(400).json({
          error: "missing_message",

          message: "Spune-mi ce vrei să fac.",
        });
      }

      const vendor = await resolveVendorByUserId(
        req.user.sub
      );

      if (!vendor) {
        return res.status(403).json({
          error: "vendor_not_found",
        });
      }

      if (pendingProductNameContext) {
        const result = await handleUpdateProduct(
          vendor.id,
          {
            productName: message,

            productUpdate:
              pendingProductNameContext.productUpdate,

            missingUpdateField:
              pendingProductNameContext.missingUpdateField,

            knownProductId: null,
            rawMessage: message,
          }
        );

        return res.json({
          commandType: "UPDATE_PRODUCT",
          ...result,
        });
      }

      const response =
        await openai.responses.create({
          model: "gpt-4.1",

          text: {
            format: { type: "json_object" },
          },

          input: [
            {
              role: "user",

              content: [
                {
                  type: "input_text",

                  text: buildPrompt({
                    message,
                    history,
                    pendingContext,
                  }),
                },
              ],
            },
          ],
        });

      const parsed = safeJsonParse(
        response.output_text
      );

      if (!parsed) {
        return res.status(500).json({
          error: "invalid_ai_json",

          message:
            "Modelul AI nu a returnat un răspuns JSON valid.",
        });
      }

      const result = await dispatchCommand(
        vendor.id,
        parsed,
        { pendingContext, message }
      );

      /*
       * commandType e expus explicit în răspuns - folosit de
       * VendorPriceCalculator ca să decidă dacă mesajul tocmai
       * trimis e o comandă "globală" (bibliotecă/profitabilitate/
       * recalculare/etc, care trebuie predată către VendorAssistant)
       * sau dacă poate continua normal editarea draftului curent
       * (CALCULATE_PRICE_GENERIC / UNKNOWN).
       */
      return res.json({
        commandType: parsed.commandType,
        ...result,
      });
    } catch (err) {
      console.error(
        "AI assistant command error:",
        err
      );

      return res.status(500).json({
        error: "assistant_command_failed",

        message:
          err?.message ||
          "Comanda nu a putut fi procesată.",
      });
    }
  }
);

/* ======================================================
   POST /api/ai/assistant/command/resolve

   Rezolvă o dezambiguizare (vendorul a ales un produs/cost
   dintr-o listă) FĂRĂ să mai cheme LLM-ul - reutilizează
   direct aceiași handleri deterministici, cu entitatea deja
   aleasă în loc de căutare fuzzy.
====================================================== */

router.post(
  "/assistant/command/resolve",
  commandAccess,
  async (req, res) => {
    try {
      const vendor = await resolveVendorByUserId(
        req.user.sub
      );

      if (!vendor) {
        return res.status(403).json({
          error: "vendor_not_found",
        });
      }

      const commandType = String(
        req.body?.commandType || ""
      );

      const params = req.body?.params || {};

      if (
        commandType === "READ_PRODUCT_COST" ||
        commandType === "UPDATE_PRODUCT_COSTING" ||
        commandType === "APPLY_RECOMMENDED_PRICE" ||
        commandType === "CALCULATE_PRICE_GENERIC"
      ) {
        const productId = String(
          req.body?.productId || ""
        );

        const product =
          await prisma.product.findUnique({
            where: { id: productId },

            select: {
              id: true,
              title: true,
              priceCents: true,

              service: {
                select: { vendorId: true },
              },
            },
          });

        if (
          !product ||
          product.service?.vendorId !==
            vendor.id
        ) {
          return res.status(404).json({
            error: "product_not_found",
          });
        }

        const resolvedProduct = {
          productId: product.id,
          title: product.title,
          priceCents: product.priceCents,
        };

        let result;

        if (commandType === "READ_PRODUCT_COST") {
          result = await buildProductCostAnswer(
            resolvedProduct
          );
        } else if (
          commandType ===
          "UPDATE_PRODUCT_COSTING"
        ) {
          result =
            await buildUpdateCostingPendingAction(
              resolvedProduct,
              params.costingChanges,
              vendor.id
            );
        } else if (
          commandType ===
          "CALCULATE_PRICE_GENERIC"
        ) {
          result = {
            message: `Deschid calculatorul pentru „${resolvedProduct.title}”.`,
            resultType: "open_calculator",
            productId: resolvedProduct.productId,
          };
        } else {
          result =
            await buildApplyPricePendingAction(
              resolvedProduct
            );
        }

        return res.json({
          commandType,
          ...result,
        });
      }

      if (commandType === "UPDATE_PRODUCT") {
        const productId = String(
          req.body?.productId || ""
        );

        const product =
          await loadOwnedProductForUpdate(
            vendor.id,
            productId
          );

        if (!product) {
          return res.status(404).json({
            error: "product_not_found",
          });
        }

        const patch =
          buildWhitelistedProductPatch(
            params.productUpdate
          );

        if (Object.keys(patch).length === 0) {
          const field =
            params.missingUpdateField &&
            PRODUCT_UPDATE_ALLOWED_FIELDS.has(
              params.missingUpdateField
            )
              ? params.missingUpdateField
              : null;

          const result = field
            ? {
                message:
                  buildProductFieldQuestion(
                    field,
                    product.title
                  ),

                resultType: "needs_field",
                productId: product.id,
                productTitle: product.title,

                productPreview:
                  buildProductPreview(product),

                field,
              }
            : {
                message: `Ce anume vrei să modific la „${product.title}”?`,
                resultType: "answer",
              };

          return res.json({
            commandType,
            ...result,
          });
        }

        const result =
          await buildUpdateProductPendingAction(
            product,
            patch
          );

        return res.json({
          commandType,
          ...result,
        });
      }

      if (commandType === "UPDATE_COST_ITEM") {
        const costItemId = String(
          req.body?.costItemId || ""
        );

        const costItem =
          await prisma.vendorCostItem.findUnique({
            where: { id: costItemId },
          });

        if (
          !costItem ||
          costItem.vendorId !== vendor.id
        ) {
          return res.status(404).json({
            error: "cost_item_not_found",
          });
        }

        /*
         * Recalculăm costul unitar DUPĂ ce știm item-ul ales -
         * normalizat la unitatea lui reală (ex. dacă vendorul a
         * spus "2 kg cu 100 lei", dar item-ul ales e deja în
         * grame, convertim aici, nu înainte de alegere). Suportă
         * atât forma "params.unitCostLei" (cost direct pe
         * unitate), cât și "params.purchaseQuantity/purchaseUnit/
         * purchaseTotalCostLei" (achiziție) - vezi
         * computeUnitCostCentsFromExtraction.
         */
        const targetUnit =
          normalizeUnitLabel(costItem.unit || "") ||
          null;

        const computed =
          computeUnitCostCentsFromExtraction(
            {
              unitCostLei: params.unitCostLei,
              unit: params.unit,
              purchaseQuantity: params.purchaseQuantity,
              purchaseUnit: params.purchaseUnit,
              purchaseTotalCostLei:
                params.purchaseTotalCostLei,
            },
            targetUnit
          );

        if (!computed) {
          return res.status(400).json({
            error: "missing_cost",

            message:
              "Nu am înțeles costul nou. Spune-mi din nou prețul.",
          });
        }

        const result =
          await buildUpdateCostItemPendingActionFromMatch(
            costItem,
            computed.unitCostCents,
            computed.unit,
            vendor.id
          );

        return res.json({
          commandType,
          ...result,
        });
      }

      return res.status(400).json({
        error: "invalid_command_type",
      });
    } catch (err) {
      console.error(
        "AI assistant command resolve error:",
        err
      );

      return res.status(500).json({
        error: "assistant_command_resolve_failed",

        message:
          err?.message ||
          "Nu am putut rezolva alegerea.",
      });
    }
  }
);


export default router;
