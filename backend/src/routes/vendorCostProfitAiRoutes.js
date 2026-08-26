// backend/src/routes/vendorCostProfitAiRoutes.js

/*
 * Consolidează endpoint-urile AI "cu o singură tură" ale
 * modulului Costuri & Profit: calculatorul de preț conversațional
 * (price-calculator/turn), analiza componentelor dintr-o
 * fotografie și detectarea determinist a costurilor reutilizabile
 * din materiale confirmate. Fost în 2 fișiere separate
 * (vendorPriceCalculatorRoutes.js, vendorCostingImageAnalysisRoutes.js),
 * consolidate ca parte a refactorului de organizare a rutelor -
 * NICIUN URL public, contract de request/response sau logică de
 * business nu s-a schimbat.
 *
 * Comenzile conversaționale MULTI-tură de administrare (citire
 * profitabilitate, editare costing, editare produs etc.) rămân
 * separat, în vendorAssistantCommandsRoutes.js + serviciul lor
 * dedicat - fișierul acela e prea mare (~2900 linii) pentru a fi
 * consolidat aici fără să depășească masiv pragul de mărime.
 */

import { Router } from "express";

import {
  authRequired,
  requireRole,
  enforceTokenVersion,
} from "../api/auth.js";

import { prisma } from "../db.js";
import { openai } from "../lib/openai.js";

import { getActivePlanForVendor } from "../payments/marketplaceCalc.js";

import {
  EMPTY_COST_DRAFT,
  sanitizeCostDraft,
  isReadyToCalculate,
  computePriceRecommendation,
  resolveVendorByUserId,
  resolveOwnedProduct,
  costingToCostDraft,
  detectReusableCostItemMention,
} from "../services/costProfitService.js";

import {
  normalizeText,
  findBestMatch,
} from "../lib/textMatch.js";

const router = Router();

/*
 * Identic pentru toate rutele din acest fișier (fostele
 * priceCalculatorAccess/costingImageAccess aveau exact același
 * conținut) - unificat, fără nicio schimbare de comportament.
 */
const costProfitAiAccess = [
  authRequired,
  enforceTokenVersion,
  requireRole("VENDOR", "ADMIN"),
];

/* ======================================================
   Helpers comune
====================================================== */

function safeJsonParse(text) {
  let raw = String(text || "").trim();

  raw = raw
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch {
    // Încercăm să extragem primul obiect JSON.
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start >= 0 && end > start) {
    try {
      return JSON.parse(
        raw.slice(start, end + 1)
      );
    } catch {
      return null;
    }
  }

  return null;
}

/* ======================================================
   ================ Price calculator (turn) ================
====================================================== */

function cleanHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const role =
        entry?.role === "assistant"
          ? "assistant"
          : "user";

      const text = String(
        entry?.text || entry?.content || ""
      )
        .trim()
        .slice(0, 1500);

      if (!text) {
        return null;
      }

      return { role, text };
    })
    .filter(Boolean)
    .slice(-10);
}

function cleanArray(value, max = 4) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  ).slice(0, max);
}

function normalizeConfidence(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(0, Math.min(1, parsed));
}

function centsToRon(cents) {
  const numeric = Number(cents);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.round(numeric) / 100;
}

function formatPricingResponse(calc, plan) {
  return {
    materialsCost: centsToRon(
      calc.materialsCostCents
    ),

    laborCost: centsToRon(
      calc.laborCostCents
    ),

    packagingCost: centsToRon(
      calc.packagingCostCents
    ),

    otherCosts: centsToRon(
      calc.otherCostsCents
    ),

    totalRealCost: centsToRon(
      calc.totalRealCostCents
    ),

    minPrice: centsToRon(
      calc.minPriceCents
    ),

    recommendedPrice: centsToRon(
      calc.recommendedPriceCents
    ),

    estimatedProfit: centsToRon(
      calc.estimatedProfitCents
    ),

    vendorNetAfterCommission: centsToRon(
      calc.vendorNetCents
    ),

    commission: {
      bps: calc.commissionBps,

      percent:
        Math.round(calc.commissionBps) / 100,

      amountAtRecommendedPrice: centsToRon(
        calc.finalCommissionCents
      ),

      planCode: plan?.code || "basic",
      planName: plan?.name || "Basic",
    },

    currency: "RON",
  };
}

/*
 * Detectare determinist a materialelor/costurilor NOI sau
 * SCHIMBATE în această tură, ca să propunem biblioteca de
 * costuri (VendorCostItem) - fără AI, doar comparând draftul
 * dinainte de tură cu cel de după (deja extras de LLM mai sus).
 *
 * Doar primul element diferit e propus într-o tură, ca să nu
 * suprapunem mai multe pendingAction deodată - restul reapar
 * la turele următoare dacă rămân nesalvate.
 */
function findCostItemDetectionCandidate(
  beforeDraft,
  afterDraft
) {
  const beforeMaterials = new Map(
    (beforeDraft?.materials || []).map((m) => [
      normalizeText(m.name),
      m,
    ])
  );

  for (const material of afterDraft?.materials || []) {
    if (material.costItemId) continue;

    const key = normalizeText(material.name);
    const prev = beforeMaterials.get(key);

    if (
      prev &&
      Number(prev.unitCost) === Number(material.unitCost)
    ) {
      continue;
    }

    return {
      name: material.name,
      type: "MATERIAL",
      unit: material.unit,
      unitCostLei: material.unitCost,
    };
  }

  const beforeOtherCosts = new Map(
    (beforeDraft?.otherCosts || []).map((o) => [
      normalizeText(o.label),
      o,
    ])
  );

  for (const other of afterDraft?.otherCosts || []) {
    if (other.costItemId) continue;

    const key = normalizeText(other.label);
    const prev = beforeOtherCosts.get(key);

    if (
      prev &&
      Number(prev.amount) === Number(other.amount)
    ) {
      continue;
    }

    return {
      name: other.label,
      type: "OTHER",
      unit: null,
      unitCostLei: other.amount,
    };
  }

  return null;
}

function buildPriceCalculatorPrompt({
  message,
  history,
  costDraft,
}) {
  return `
Ești asistentul ArtFest care ajută vânzătorii să își calculeze costurile unui produs handmade, înainte de a stabili prețul de vânzare.

Rolul tău este STRICT să extragi și să organizezi informațiile despre costuri dintr-o conversație liberă.

NU calculezi NICIODATĂ prețul, marja, comisionul, profitul estimat sau orice altă sumă finală. Acestea sunt calculate separat, determinist, de către server, din datele pe care le extragi tu.

Trebuie să extragi, dacă sunt menționate în mesaj sau în istoric:
1. materialele folosite, cu cantitate și cost unitar (pe unitate, în lei);
2. costul ambalajului (în lei);
3. alte costuri (transport materiale, taxe, etc.);
4. timpul de lucru, în ore;
5. cât valorează o oră din munca vânzătorului (lei/oră);
6. profitul dorit - ca procent aplicat peste cost (markup) sau ca sumă fixă în lei.

Reguli:

- Actualizează starea curentă (costDraft) cu tot ce reiese din mesajul curent, păstrând ce era deja cunoscut și nu a fost contrazis.
- În "patch.materials" și "patch.otherCosts" returnează întotdeauna lista COMPLETĂ și actualizată (nu doar elementele noi din acest mesaj) - combină ce știai deja din costDraft cu ce a spus vânzătorul acum.
- Timpul de lucru (laborHours) și valoarea orei (hourlyRate) sunt singurele informații cu adevărat obligatorii pentru calcul. Dacă oricare dintre ele lipsește din costDraft și nu a fost menționată acum, pune o întrebare clară despre ea.
- Materialele, ambalajul, alte costuri și profitul dorit sunt opționale. Dacă vânzătorul pare să fi terminat descrierea costurilor și nu le-a menționat, NU insista - poți presupune 0 pentru ele și menționează asumpția pe scurt în mesajul tău, în loc să întrebi la nesfârșit.
- Pune cel mult 1-2 întrebări per tură, doar despre informația esențială care lipsește.
- Nu inventa cifre. Dacă vânzătorul dă o valoare aproximativă ("cam 10 lei"), folosește acea valoare ca atare.
- Formulează întrebările necesare direct în câmpul "message", ca text conversațional prietenos, în română.
- Returnează EXCLUSIV JSON valid, fără markdown.

Stare curentă (costDraft):

${JSON.stringify(costDraft, null, 2)}

Istoric conversație:

${JSON.stringify(history, null, 2)}

Mesaj curent:

${message}

Schema exactă a răspunsului:

{
  "message": "",
  "patch": {
    "materials": [
      { "name": "", "quantity": 0, "unit": "", "unitCost": 0 }
    ],
    "packagingCost": 0,
    "otherCosts": [
      { "label": "", "amount": 0 }
    ],
    "laborHours": 0,
    "hourlyRate": 0,
    "desiredProfit": { "type": "percent", "value": 0 }
  },
  "questions": [],
  "confidence": 0
}
`;
}

/* ======================================================
   POST /api/ai/price-calculator/turn
====================================================== */

router.post(
  "/price-calculator/turn",
  costProfitAiAccess,
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

      const clientSentCostDraft =
        req.body?.costDraft !== undefined &&
        req.body?.costDraft !== null;

      const rawProductId = String(
        req.body?.productId || ""
      ).trim();

      if (
        !message &&
        !history.length &&
        !rawProductId &&
        !clientSentCostDraft
      ) {
        return res.status(400).json({
          error: "missing_message",

          message:
            "Descrie pe scurt costurile produsului.",
        });
      }

      const vendor =
        await prisma.vendor.findUnique({
          where: {
            userId: req.user.sub,
          },

          select: {
            id: true,
          },
        });

      if (!vendor) {
        return res.status(403).json({
          error: "vendor_not_found",

          message:
            "Contul tău nu are un magazin de vânzător asociat.",
        });
      }

      /*
       * productId e opțional. Dacă e prezent, verificăm
       * întâi că produsul chiar aparține vendorului curent -
       * altfel nu îl folosim deloc (404), nu doar îl ignorăm
       * silențios.
       */
      let productId = null;
      let seededDraft = null;

      if (rawProductId) {
        const product = await resolveOwnedProduct(
          rawProductId,
          vendor.id
        );

        if (!product) {
          return res.status(404).json({
            error: "product_not_found",

            message:
              "Produsul nu a fost găsit sau nu îți aparține.",
          });
        }

        productId = product.id;

        /*
         * Preîncărcăm costing-ul salvat DOAR pe prima tură
         * pentru acest produs (clientul nu a trimis încă
         * un costDraft propriu). Turele următoare continuă
         * cu ce trimite clientul, ca la orice conversație.
         */
        if (!clientSentCostDraft) {
          const existingCosting =
            await prisma.productCosting.findUnique({
              where: { productId },
              include: { items: true },
            });

          if (existingCosting) {
            seededDraft = costingToCostDraft(
              existingCosting
            );
          }
        }
      }

      const incomingDraft = sanitizeCostDraft(
        req.body?.costDraft,
        seededDraft || EMPTY_COST_DRAFT
      );

      /*
       * Un mesaj gol e valid când:
       * - avem un productId (deschidem/reîncărcăm conversația
       *   pentru acel produs, cu sau fără costing deja salvat);
       * - SAU clientul a trimis deja un costDraft GATA DE
       *   CALCULAT (laborHours + hourlyRate completate) - de
       *   exemplu materiale confirmate dintr-o analiză foto,
       *   fără produs asociat, dar cu manopera deja cunoscută -
       *   caz în care nu mai e nimic de extras, doar de
       *   calculat determinist.
       *
       * Dacă e trimis un costDraft fără produs asociat dar ÎNCĂ
       * NEcomplet (ex. materiale confirmate din poză, dar fără
       * manoperă/tarif orar - fix pentru "Calcul temporar" pe un
       * produs care nu există încă), NU tratăm asta ca pure load
       * turn cu mesaj generic "am calculat" (fals, pricing ar fi
       * null) - lăsăm tura să treacă prin LLM, care are deja
       * regula "dacă laborHours/hourlyRate lipsesc din costDraft,
       * pune o întrebare clară despre ele" (vezi buildPriceCalculatorPrompt).
       *
       * Fără niciunul dintre acestea, mesajul gol tot nu are
       * sens - dar acel caz e deja respins mai sus.
       */
      const isPureLoadTurn =
        !message &&
        !history.length &&
        (Boolean(productId) ||
          (clientSentCostDraft &&
            isReadyToCalculate(incomingDraft)));

      let parsed;

      if (isPureLoadTurn) {
        /*
         * Nimic de extras - fie am încărcat costing-ul
         * salvat, fie produsul nu are încă unul, fie clientul
         * a trimis deja un costDraft gata format. Nu are sens
         * să chemăm modelul AI pentru un mesaj gol.
         */
        parsed = {
          message: seededDraft
            ? "Am încărcat costing-ul salvat pentru acest produs. Poți continua conversația ca să-l actualizezi."
            : productId
              ? "Acest produs nu are încă un costing salvat. Spune-mi din ce e făcut și cât te costă, ca să-l calculăm."
              : "Am calculat prețul pe baza informațiilor primite.",

          patch: {},
          questions: [],
          confidence: null,
        };
      } else {
        const response =
          await openai.responses.create({
            model: "gpt-4.1",

            text: {
              format: {
                type: "json_object",
              },
            },

            input: [
              {
                role: "user",

                content: [
                  {
                    type: "input_text",

                    text: buildPriceCalculatorPrompt({
                      message,
                      history,
                      costDraft: incomingDraft,
                    }),
                  },
                ],
              },
            ],
          });

        parsed = safeJsonParse(
          response.output_text
        );

        if (!parsed) {
          return res.status(500).json({
            error: "invalid_ai_json",

            message:
              "Modelul AI nu a returnat un răspuns JSON valid.",
          });
        }
      }

      const updatedDraft = sanitizeCostDraft(
        parsed.patch,
        incomingDraft
      );

      const ready = isReadyToCalculate(
        updatedDraft
      );

      let pricing = null;

      if (ready) {
        /*
         * Comisionul vine STRICT din planul real al
         * vendorului din DB, nu din client și nu din LLM.
         */
        const plan =
          await getActivePlanForVendor(
            vendor.id
          );

        const commissionBps = Number.isFinite(
          Number(plan?.commissionBps)
        )
          ? Number(plan.commissionBps)
          : 0;

        const calc = computePriceRecommendation({
          costDraft: updatedDraft,
          commissionBps,
        });

        pricing = formatPricingResponse(
          calc,
          plan
        );
      }

      /*
       * Nudge determinist (NU generat de LLM) pentru profitul
       * dorit - doar când prețul tocmai a devenit calculabil
       * (ready) fără nicio țintă de profit setată și fără produs
       * asociat încă (calcul temporar din poză, fără productId).
       * Pentru costing-uri deja legate de un produs păstrăm
       * comportamentul existent (LLM-ul poate menționa asumpția
       * de profit 0 pe scurt, dar nu insistăm la fiecare tură).
       */
      const profitNudge =
        !productId &&
        ready &&
        !updatedDraft.desiredProfit
          ? " Dacă vrei, spune-mi și ce profit îți dorești (procent din cost sau o sumă fixă în lei) - altfel calculez cu profit 0 peste costul real."
          : "";

      /*
       * Sugestie de bibliotecă (CREATE_COST_ITEM / UPDATE_COST_ITEM)
       * pentru primul material/cost NOU sau SCHIMBAT în această
       * tură - vezi findCostItemDetectionCandidate. Nu se salvează
       * NIMIC automat; frontend-ul afișează sugestia ca un
       * pendingAction separat, sub cardul de preț, iar vendorul
       * confirmă explicit (Adaugă în bibliotecă / Doar pentru
       * calculul acesta).
       */
      const detectionCandidate =
        findCostItemDetectionCandidate(
          incomingDraft,
          updatedDraft
        );

      const costItemSuggestion = detectionCandidate
        ? await detectReusableCostItemMention({
            vendorId: vendor.id,
            ...detectionCandidate,
          })
        : null;

      return res.json({
        message: (
          String(
            parsed.message ||
              "Am notat informațiile despre costuri."
          ).trim() + profitNudge
        ).slice(0, 2000),

        costDraft: updatedDraft,

        productId,

        loadedFromSavedCosting: Boolean(
          seededDraft
        ),

        questions: cleanArray(
          parsed.questions,
          4
        ),

        readyToCalculate: ready,

        pricing,

        costItemSuggestion,

        confidence: normalizeConfidence(
          parsed.confidence
        ),
      });
    } catch (err) {
      console.error(
        "AI price calculator error:",
        err
      );

      return res.status(500).json({
        error: "price_calculator_failed",

        message:
          err?.message ||
          "Calculul de preț a eșuat.",
      });
    }
  }
);

/* ======================================================
   ============= Analiză foto (Costuri & Profit) =============
====================================================== */

function normalizeImageUrls(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => String(item || "").trim())
        .filter(
          (item) =>
            /^https?:\/\//i.test(item) ||
            /^data:image\//i.test(item)
        )
    )
  ).slice(0, 4);
}

/*
 * Fallback diferit față de normalizeConfidence de mai sus (0 în
 * loc de null) - comportament ORIGINAL, distinct între cele două
 * endpoint-uri, păstrat neschimbat, doar redenumit ca să nu
 * coliziune cu funcția de la price-calculator/turn în același
 * fișier.
 */
function normalizeImageConfidence(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(1, parsed));
}

/*
 * Matching determinist componentă <-> VendorCostItem

 * NU implică LLM-ul - reutilizează lib/textMatch.js, folosit
 * și de comenzile conversaționale de administrare costuri.
 */
function findBestCostItemMatch(
  label,
  costItems
) {
  return findBestMatch(label, costItems, {
    nameField: "name",
  });
}

/* ======================================================
   Prompt - STRICT identificare, NICIODATĂ cost/preț
====================================================== */

function buildImageAnalysisPrompt() {
  return `
Ești asistentul ArtFest care ajută vânzătorii să identifice materialele/componentele unui produs handmade dintr-o fotografie, pentru a le folosi mai târziu într-un calcul de cost.

Rolul tău este STRICT să identifici, nu să evaluezi financiar.

NU estima NICIODATĂ costul, prețul unitar sau orice sumă în bani pentru vreo componentă. Asta se face separat, determinist, doar din biblioteca de costuri salvată a vânzătorului - tu nu ai acces la ea și nu trebuie să ghicești valori.

Pentru fiecare material/componentă vizibilă în imagini, identifică:
1. o denumire scurtă și clară (ex: "Fir bumbac roz", "Catarama metalică", "Mărgele sticlă");
2. o cantitate estimată, DOAR dacă poate fi dedusă vizual cu o certitudine rezonabilă (altfel folosește 1);
3. o unitate estimată (ex: "buc", "g", "m", "set") - dacă nu e clară, lasă gol;
4. un nivel de încredere (confidence) între 0 și 1, care reflectă cât de sigur ești de identificarea vizuală a componentei (NU de costul ei - costul nu te privește).

Reguli:
- Identifică doar componentele fizice clar vizibile sau evident deductibile din fotografie.
- Nu inventa componente pe care nu le poți justifica din imagine.
- Nu include ambalajul de livrare (cutii, folie) decât dacă este parte vizibilă din produsul finit.
- Maxim 12 componente.
- Răspunde în română.
- Returnează EXCLUSIV JSON valid, fără markdown.

Schema exactă a răspunsului:

{
  "components": [
    {
      "label": "",
      "quantity": 1,
      "unit": "",
      "confidence": 0
    }
  ]
}
`;
}

/* ======================================================
   POST /api/ai/costing/analyze-image
====================================================== */

router.post(
  "/costing/analyze-image",
  costProfitAiAccess,
  async (req, res) => {
    try {
      const images = normalizeImageUrls(
        req.body?.images
      );

      if (!images.length) {
        return res.status(400).json({
          error: "no_images",

          message:
            "Încarcă cel puțin o imagine pentru analiză.",
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

      const response =
        await openai.responses.create({
          model: "gpt-4.1",

          text: {
            format: {
              type: "json_object",
            },
          },

          input: [
            {
              role: "user",

              content: [
                {
                  type: "input_text",
                  text: buildImageAnalysisPrompt(),
                },

                ...images.map((url) => ({
                  type: "input_image",
                  image_url: url,
                })),
              ],
            },
          ],
        });

      const parsed = safeJsonParse(
        response.output_text
      );

      if (
        !parsed ||
        !Array.isArray(parsed.components)
      ) {
        return res.status(500).json({
          error: "invalid_ai_json",

          message:
            "Modelul AI nu a returnat un răspuns JSON valid.",
        });
      }

      /*
       * Matching-ul e determinist - NU implică LLM-ul.
       * Doar costurile active ale acestui vendor sunt
       * eligibile ca sugestie de match.
       */
      const costItems =
        await prisma.vendorCostItem.findMany({
          where: {
            vendorId: vendor.id,
            isActive: true,
          },
        });

      const components = parsed.components
        .slice(0, 20)
        .map((raw) => {
          const label = String(
            raw?.label || ""
          )
            .trim()
            .slice(0, 120);

          if (!label) {
            return null;
          }

          const quantityValue = Number(
            raw?.quantity
          );

          const suggestedQuantity =
            Number.isFinite(quantityValue) &&
            quantityValue > 0
              ? quantityValue
              : 1;

          const suggestedUnit = String(
            raw?.unit || ""
          )
            .trim()
            .slice(0, 40);

          const confidence = normalizeImageConfidence(
            raw?.confidence
          );

          const match = findBestCostItemMatch(
            label,
            costItems
          );

          return {
            label,
            suggestedQuantity,
            suggestedUnit,
            confidence,

            matchedCostItemId: match?.id || null,

            matchedCostItemName:
              match?.name || null,

            matchedUnitCostCents:
              match?.unitCostCents ?? null,

            needsUserInput: !match,
          };
        })
        .filter(Boolean);

      return res.json({
        components,
      });
    } catch (err) {
      console.error(
        "AI costing image analyze error:",
        err
      );

      return res.status(500).json({
        error:
          "costing_image_analysis_failed",

        message:
          err?.message ||
          "Analiza imaginii a eșuat.",
      });
    }
  }
);

/* ======================================================
   POST /api/ai/costing/detect-cost-items

   Apelat DUPĂ ce vendorul confirmă componentele identificate
   din fotografie (materialsArray din PhotoCostingDraftEditor,
   cu nume/cantitate/unitate/cost editate de el). Nu implică
   AI-ul aici - doar comparație deterministă cu biblioteca,
   la fel ca detectarea din orchestrator/calculator (vezi
   costProfitService.js).

   Materialele deja legate de un VendorCostItem (costItemId
   setat la analiza foto) sunt ignorate - nu au nevoie de nicio
   propunere. Se întoarce o singură sugestie per apel (primul
   material fără costItemId care e nou sau are cost diferit),
   ca să nu suprapunem mai multe pendingAction deodată.
====================================================== */

router.post(
  "/costing/detect-cost-items",
  costProfitAiAccess,
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

      const items = Array.isArray(req.body?.items)
        ? req.body.items
        : [];

      let suggestion = null;

      for (const rawItem of items.slice(0, 20)) {
        if (rawItem?.costItemId) continue;

        const name = String(
          rawItem?.name || ""
        ).trim();

        if (!name) continue;

        const unitCost = Number(rawItem?.unitCost);

        if (
          !Number.isFinite(unitCost) ||
          unitCost <= 0
        ) {
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const result = await detectReusableCostItemMention(
          {
            vendorId: vendor.id,
            name,
            type: "MATERIAL",
            unit: rawItem?.unit,
            unitCostLei: unitCost,
          }
        );

        if (result) {
          suggestion = result;
          break;
        }
      }

      return res.json({ suggestion });
    } catch (err) {
      console.error(
        "AI costing detect-cost-items error:",
        err
      );

      return res.status(500).json({
        error: "detect_cost_items_failed",

        message:
          err?.message ||
          "Detectarea costurilor a eșuat.",
      });
    }
  }
);

export default router;
