import { Router } from "express";

import {
  authRequired,
  enforceTokenVersion,
} from "../../../api/auth.js";

import {
  prisma,
} from "../../../db.js";

import {
  openai,
} from "../../../lib/openai.js";

import {
  getVendorPlatformKnowledge,
} from "../../../ai/vendorPlatformKnowledge.js";

const router = Router();

/* ======================================================
   ACCESS
====================================================== */

async function vendorPlatformAccess(
  req,
  res,
  next
) {
  try {
    const role =
      String(
        req.user?.role ||
          ""
      ).toUpperCase();

    /*
     * Dacă token-ul are deja rolul corect,
     * permitem accesul direct.
     */
    if (
      role === "VENDOR" ||
      role === "ADMIN"
    ) {
      return next();
    }

    /*
     * Unele conturi pot avea vendor asociat
     * chiar dacă rolul din token nu este
     * momentan VENDOR.
     *
     * Facem fallback în baza de date.
     */
    const userId =
      req.user?.sub ||
      req.user?.id;

    if (!userId) {
      return res
        .status(403)
        .json({
          error:
            "forbidden",
        });
    }

    const vendor =
      await prisma.vendor.findUnique({
        where: {
          userId,
        },

        select: {
          id: true,
          isActive: true,
        },
      });

    if (vendor) {
      req.meVendor =
        vendor;

      return next();
    }

    return res
      .status(403)
      .json({
        error:
          "forbidden",

        currentRole:
          req.user?.role ||
          null,
      });
  } catch (error) {
    console.error(
      "[vendor-platform] access:",
      error
    );

    return res
      .status(500)
      .json({
        error:
          "vendor_access_failed",
      });
  }
}

const vendorAccess = [
  authRequired,
  enforceTokenVersion,
  vendorPlatformAccess,
];

/* ======================================================
   HELPERS
====================================================== */

function cleanString(
  value,
  maxLength = 3000
) {
  return String(
    value ?? ""
  )
    .trim()
    .slice(
      0,
      maxLength
    );
}

function cleanHistory(
  value
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const role =
        entry?.role ===
        "assistant"
          ? "assistant"
          : "user";

      const content =
        cleanString(
          entry?.content ??
            entry?.text ??
            "",
          3000
        );

      if (!content) {
        return null;
      }

      return {
        role,
        content,
      };
    })
    .filter(Boolean)
    .slice(-12);
}

function safeJsonParse(
  text
) {
  let raw =
    cleanString(
      text,
      20000
    );

  raw = raw
    .replace(
      /^```json/i,
      ""
    )
    .replace(
      /^```/i,
      ""
    )
    .replace(
      /```$/i,
      ""
    )
    .trim();

  try {
    return JSON.parse(raw);
  } catch {
    // încercăm să extragem obiectul JSON
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

function cleanArray(
  value,
  maxItems = 8,
  maxItemLength = 700
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) =>
      cleanString(
        item,
        maxItemLength
      )
    )
    .filter(Boolean)
    .slice(
      0,
      maxItems
    );
}

function cleanSuggestions(
  value
) {
  const suggestions =
    cleanArray(
      value,
      5,
      300
    );

  return Array.from(
    new Set(suggestions)
  );
}

function normalizeConfidence(
  value
) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      1,
      number
    )
  );
}

function normalizeRoute(
  route
) {
  if (
    !route ||
    typeof route !==
      "object" ||
    Array.isArray(route)
  ) {
    return null;
  }

  const path =
    cleanString(
      route.path,
      400
    );

  if (!path) {
    return null;
  }

  const method =
    cleanString(
      route.method,
      12
    ).toUpperCase();

  return {
    method:
      method || "GET",

    path,
  };
}

function normalizePageContext(
  value
) {
  if (
    !value ||
    typeof value !==
      "object" ||
    Array.isArray(value)
  ) {
    return {};
  }

  const safe = {};

  const allowedKeys = [
    "page",
    "tab",
    "section",
    "route",
    "serviceId",
    "importId",
    "productId",
  ];

  for (
    const key of
    allowedKeys
  ) {
    if (
      value[key] !==
        undefined &&
      value[key] !==
        null
    ) {
      safe[key] =
        cleanString(
          value[key],
          300
        );
    }
  }

  return safe;
}

/* ======================================================
   POST /ask

   Ruta finală:
   POST /api/assistant/vendor-platform/ask

   Body:
   {
     message: "...",

     history: [
       {
         role: "user" | "assistant",
         content: "..."
       }
     ],

     pageContext: {
       page: "catalog",
       tab: "imports"
     }
   }
====================================================== */

router.post(
  "/ask",
  ...vendorAccess,
  async (req, res) => {
    try {
      const message =
        cleanString(
          req.body?.message,
          4000
        );

      if (!message) {
        return res
          .status(400)
          .json({
            error:
              "message_required",

            message:
              "Scrie o întrebare pentru asistent.",
          });
      }

      const history =
        cleanHistory(
          req.body?.history
        );

      const pageContext =
        normalizePageContext(
          req.body?.pageContext
        );

      const knowledge =
        getVendorPlatformKnowledge();

      const historyText =
        history.length
          ? history
              .map(
                (entry) =>
                  `${
                    entry.role ===
                    "assistant"
                      ? "ASISTENT"
                      : "UTILIZATOR"
                  }:\n${entry.content}`
              )
              .join(
                "\n\n"
              )
          : "Nu există istoric.";

      const response =
        await openai.responses.create({
          model:
            "gpt-4.1",

          text: {
            format: {
              type:
                "json_object",
            },
          },

          input: [
            {
              role:
                "user",

              content: [
                {
                  type:
                    "input_text",

                  text: `
${knowledge}

==================================================
CONTEXT PAGINĂ
==================================================

${JSON.stringify(
  pageContext,
  null,
  2
)}

==================================================
ISTORIC CONVERSAȚIE
==================================================

${historyText}

==================================================
MESAJ CURENT
==================================================

${message}

==================================================
INSTRUCȚIUNI
==================================================

Răspunde întrebării vânzătorului folosind knowledge-ul Artfest.

IMPORTANT:

- Nu funcționa ca un FAQ rigid.
- Dedu răspunsul combinând regulile și capabilitățile disponibile.
- Dacă întrebarea descrie o situație nouă, caută regulile relevante și construiește răspunsul.
- Dacă există context de pagină, folosește-l pentru a înțelege mai bine întrebarea.
- Dacă utilizatorul cere ce rută trebuie folosită, răspunde doar cu o rută care există în knowledge.
- Nu inventa rute.
- Nu inventa funcționalități.
- Dacă funcționalitatea este PLANNED, spune clar că nu este încă disponibilă.
- Dacă nu ai suficiente informații, spune clar asta.
- Răspunde în română.
- Răspunsul trebuie să fie simplu, practic și util unui vânzător.
- Dacă utilizatorul pare tehnic și cere implementare, poți explica endpointul și pașii tehnici.
- Dacă utilizatorul este doar vânzător, evită detaliile tehnice inutile.

Returnează EXCLUSIV JSON valid.

Schema exactă:

{
  "message": "",
  "topic": "general",

  "route": null,

  "steps": [],

  "suggestions": [],

  "confidence": 0
}

Reguli câmpuri:

message:
- răspunsul principal;
- poate avea mai multe propoziții;
- trebuie să poată fi afișat direct în chat.

topic:
folosește una dintre valorile cele mai potrivite:
- general
- catalog
- catalog_import
- catalog_mapping
- catalog_preview
- catalog_images
- catalog_export
- catalog_errors
- catalog_retry
- catalog_services
- route_help
- order_mode
- integration
- support

route:
- null dacă nu este relevant;
- dacă este relevant:
  {
    "method": "GET|POST|PATCH|DELETE",
    "path": "/api/..."
  }

steps:
- pași practici;
- maximum 10;
- fără pași inutili.

suggestions:
- maximum 5;
- întrebări sau acțiuni următoare utile.

confidence:
- între 0 și 1.
`,
                },
              ],
            },
          ],
        });

      const parsed =
        safeJsonParse(
          response.output_text
        );

      if (!parsed) {
        return res
          .status(500)
          .json({
            error:
              "invalid_ai_json",

            message:
              "Asistentul Artfest nu a returnat un răspuns valid.",
          });
      }

      const finalMessage =
        cleanString(
          parsed.message,
          5000
        );

      return res.json({
        message:
          finalMessage ||
          "Nu am suficiente informații pentru a răspunde sigur.",

        topic:
          cleanString(
            parsed.topic,
            80
          ) ||
          "general",

        route:
          normalizeRoute(
            parsed.route
          ),

        steps:
          cleanArray(
            parsed.steps,
            10,
            700
          ),

        suggestions:
          cleanSuggestions(
            parsed.suggestions
          ),

        confidence:
          normalizeConfidence(
            parsed.confidence
          ),
      });
    } catch (error) {
      console.error(
        "[assistant-vendor-platform] ask:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "vendor_platform_assistant_failed",

          message:
            error?.message ||
            "Asistentul Artfest nu a putut răspunde momentan.",
        });
    }
  }
);

/* ======================================================
   GET /test

   Ruta finală:
   GET /api/assistant/vendor-platform/test
====================================================== */

router.get(
  "/test",
  ...vendorAccess,
  (_req, res) => {
    return res.json({
      ok: true,

      assistant:
        "vendor-platform",

      message:
        "Asistentul platformei pentru vendori este activ.",
    });
  }
);

export default router;