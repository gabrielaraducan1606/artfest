// backend/src/routes/assistantRoutes/assistant/assistantChatRoutes.js

import { Router } from "express";

import { openai } from "../../../lib/openai.js";

const router = Router();

const MODEL =
  process.env.ASSISTANT_ROUTER_MODEL ||
  "gpt-4.1-mini";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_TEXT_LENGTH = 1200;

/* =========================================================
   Helpers
========================================================= */

function cleanText(
  value,
  maxLength = MAX_MESSAGE_LENGTH
) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeJsonParse(value) {
  const raw = String(value || "")
    .trim()
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch {
    // continuăm cu încercarea de extragere
  }

  const start =
    raw.indexOf("{");

  const end =
    raw.lastIndexOf("}");

  if (
    start >= 0 &&
    end > start
  ) {
    try {
      return JSON.parse(
        raw.slice(
          start,
          end + 1
        )
      );
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeHistory(
  conversation
) {
  if (!Array.isArray(conversation)) {
    return [];
  }

  return conversation
    .slice(-MAX_HISTORY_ITEMS)
    .map((item) => {
      const role =
        item?.role === "assistant"
          ? "assistant"
          : "user";

      const content =
        cleanText(
          item?.content ||
            item?.text ||
            item?.message ||
            "",
          MAX_HISTORY_TEXT_LENGTH
        );

      if (!content) {
        return null;
      }

      return {
        role,
        content,
      };
    })
    .filter(Boolean);
}

function normalizeConfidence(
  value
) {
  const numeric =
    Number(value);

  if (
    !Number.isFinite(numeric)
  ) {
    return 0.5;
  }

  return Math.max(
    0,
    Math.min(
      1,
      numeric
    )
  );
}

function normalizeIntentResult(
  raw,
  originalMessage
) {
  const intent =
    String(
      raw?.intent || ""
    )
      .trim()
      .toLowerCase();

  const confidence =
    normalizeConfidence(
      raw?.confidence
    );

  const assistantMessage =
    cleanText(
      raw?.message ||
        raw?.assistantMessage ||
        "",
      700
    );

  const query =
    cleanText(
      raw?.query ||
        originalMessage,
      1000
    );

  switch (intent) {
    case "image_search":
      return {
        type: "action",
        actionId:
          "image-search",
        confidence,
        message:
          assistantMessage ||
          null,
      };

    case "order_delivery":
      return {
        type: "action",
        actionId:
          "order-delivery",
        confidence,
        message:
          assistantMessage ||
          null,
      };

    case "order_status":
      return {
        type: "action",
        actionId:
          "track-order",
        confidence,
        message:
          assistantMessage ||
          null,
      };

    case "support":
      return {
        type: "support",
        confidence,
        category:
          cleanText(
            raw?.category,
            80
          ) || null,
        message:
          assistantMessage ||
          null,
      };

    case "quote":
      return {
        type: "menu",
        menuId:
          "personalization",
        confidence,
        message:
          assistantMessage ||
          null,
      };

    case "product_search":
      return {
        type:
          "product-search",
        confidence,
        query,
        maxPrice:
          Number.isFinite(
            Number(
              raw?.maxPrice
            )
          )
            ? Number(
                raw.maxPrice
              )
            : null,
        color:
          cleanText(
            raw?.color,
            80
          ) || null,
        occasion:
          cleanText(
            raw?.occasion,
            120
          ) || null,
        message:
          assistantMessage ||
          null,
      };

    case "chat":
      return {
        type: "chat",
        confidence,
        message:
          assistantMessage ||
          "Cu drag. Spune-mi cu ce te pot ajuta pe Artfest.",
      };

    case "clarify":
    default:
      return {
        type: "clarify",
        confidence,
        message:
          assistantMessage ||
          "Nu sunt sigur că am înțeles. Poți reformula în câteva cuvinte?",
      };
  }
}

/* =========================================================
   POST /api/assistant/chat

   IMPORTANT:
   Acest endpoint NU execută acțiuni în contul utilizatorului.
   Doar înțelege mesajul și întoarce intenția structurată.
   Frontend-ul continuă să folosească flow-urile existente
   pentru produse, comenzi, suport și cereri de ofertă.
========================================================= */

router.post(
  "/chat",
  async (
    req,
    res
  ) => {
    const message =
      cleanText(
        req.body?.message
      );

    if (!message) {
      return res
        .status(400)
        .json({
          error:
            "message_required",
          message:
            "Mesajul este obligatoriu.",
        });
    }

    const conversation =
      normalizeHistory(
        req.body?.conversation
      );

    const activeFlow =
      cleanText(
        req.body?.activeFlow,
        120
      );

    const currentPage =
      cleanText(
        req.body?.currentPage,
        300
      );

    const isVendor =
      req.body?.isVendor ===
      true;

    try {
      const response =
        await openai.responses.create(
          {
            model: MODEL,

            text: {
              format: {
                type:
                  "json_object",
              },
            },

            input: [
              {
                role:
                  "system",

                content: [
                  {
                    type:
                      "input_text",

                    text: `
Ești routerul conversațional al asistentului Artfest,
o platformă pentru produse handmade, creatori și evenimente.

Sarcina ta NU este să inventezi date și NU este să execuți acțiuni.
Trebuie doar să înțelegi ce dorește utilizatorul și să alegi
cea mai potrivită intenție.

Răspunde EXCLUSIV cu un obiect JSON valid.

INTENȚII PERMISE:

1. product_search
Utilizatorul caută produse, idei de cadouri, recomandări,
produse pentru o persoană, eveniment, buget, culoare sau stil.

Exemple:
- "vreau ceva pentru nașa mea"
- "caut o lumânare sub 100 lei"
- "ce cadou pot lua unei profesoare?"
- "vreau ceva roz pentru botez"

2. image_search
Utilizatorul vrea să caute după fotografie/imagine
sau să găsească ceva asemănător unei poze.

3. order_status
Utilizatorul întreabă despre o comandă, statusul ei,
unde este comanda sau vrea să vadă comenzile.

4. order_delivery
Utilizatorul întreabă despre colet, AWB, curier,
tracking sau livrare.

5. support
Utilizatorul cere ajutor/suport sau descrie o problemă
tehnică, de cont, plată, funcționare etc.

6. quote
Utilizatorul vrea ofertă, personalizare, cantitate mai mare,
produs la comandă sau discuție cu un creator despre o comandă specială.

7. chat
Mesaj conversațional simplu care poate primi un răspuns scurt:
salut, mulțumesc, ce poți face, cine ești etc.

8. clarify
Mesajul este prea ambiguu pentru a decide în siguranță.

REGULI:
- Înțelege greșelile de tastare și exprimarea informală.
- Nu cere utilizatorului să folosească anumite cuvinte-cheie.
- Folosește contextul conversației când mesajul este scurt,
  ex. "mai ieftin", "pe albastru", "și pentru botez".
- Dacă utilizatorul schimbă clar subiectul, alege noua intenție.
- Dacă există dubiu între order_status și order_delivery:
  colet/AWB/curier/livrare/tracking => order_delivery;
  comandă/status comandă => order_status.
- "vreau suport", "ajută-mă", "am o problemă" => support.
- Nu inventa ID-uri, comenzi, produse, prețuri sau statusuri.
- Pentru product_search păstrează în "query" formularea utilă
  pentru motorul de căutare.

FORMAT JSON:

{
  "intent": "product_search | image_search | order_status | order_delivery | support | quote | chat | clarify",
  "confidence": 0.0,
  "query": null,
  "maxPrice": null,
  "color": null,
  "occasion": null,
  "category": null,
  "message": null
}

Pentru "chat" și "clarify", completează "message" cu un răspuns
scurt, prietenos și în limba utilizatorului.

Pentru celelalte intenții, "message" poate fi null.
                    `.trim(),
                  },
                ],
              },

              {
                role:
                  "user",

                content: [
                  {
                    type:
                      "input_text",

                    text:
                      JSON.stringify(
                        {
                          message,
                          conversation,
                          context: {
                            activeFlow:
                              activeFlow ||
                              null,

                            currentPage:
                              currentPage ||
                              null,

                            isVendor,
                          },
                        },
                        null,
                        2
                      ),
                  },
                ],
              },
            ],
          }
        );

      const parsed =
        safeJsonParse(
          response.output_text
        );

      if (!parsed) {
        console.error(
          "[assistant/chat] invalid AI JSON:",
          response.output_text
        );

        return res.json({
          ok: true,

          result: {
            type:
              "clarify",

            confidence:
              0,

            message:
              "Nu sunt sigur că am înțeles. Poți reformula în câteva cuvinte?",
          },
        });
      }

      const result =
        normalizeIntentResult(
          parsed,
          message
        );

      return res.json({
        ok: true,
        result,
      });
    } catch (error) {
      console.error(
        "[assistant/chat] error:",
        error
      );

      /*
       * Nu blocăm complet asistentul dacă OpenAI are
       * temporar o problemă. Frontend-ul poate folosi
       * fallback-ul local deja existent.
       */
      return res
        .status(503)
        .json({
          error:
            "assistant_ai_unavailable",

          message:
            "Asistentul AI nu este disponibil momentan.",
        });
    }
  }
);

export default router;