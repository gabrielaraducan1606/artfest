// backend/src/routes/influencerCollectionsRoutes.js

import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";

import { prisma } from "../db.js";
import { openai } from "../lib/openai.js";
import {
  authRequired,
  enforceTokenVersion,
} from "../api/auth.js";

const router = Router();

/* =========================================================
   CONFIG
========================================================= */

const MAX_TITLE_LENGTH = 160;
const MAX_SLUG_LENGTH = 180;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_COLLECTION_PRODUCTS = 100;

const AI_RECOMMENDATION_MODEL =
  process.env.OPENAI_INFLUENCER_COLLECTIONS_MODEL ||
  "gpt-4.1-mini";

const AI_CANDIDATE_LIMIT = 80;
const AI_DEFAULT_LIMIT = 12;
const AI_MAX_LIMIT = 24;
/* =========================================================
   HELPERS
========================================================= */

function normalizeString(value = "") {
  return String(value || "").trim();
}

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
    // încercăm să extragem primul obiect JSON
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

function optionalMoney(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isFinite(
      number
    ) ||
    number < 0
  ) {
    return null;
  }

  return number;
}

function clampInteger(
  value,
  fallback,
  min,
  max
) {
  const number =
    Number(value);

  if (
    !Number.isInteger(
      number
    )
  ) {
    return fallback;
  }

  return Math.min(
    max,
    Math.max(
      min,
      number
    )
  );
}

function cleanAiReason(
  value
) {
  return normalizeString(
    value
  )
    .replace(
      /\s+/g,
      " "
    )
    .slice(
      0,
      500
    );
}

function slugify(value = "") {
  return normalizeString(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
}

function randomSlugSuffix() {
  return crypto
    .randomBytes(3)
    .toString("hex");
}

async function buildUniqueSlug(title, excludeCollectionId = null) {
  const base =
    slugify(title) ||
    `colectie-${randomSlugSuffix()}`;

  let candidate = base;
  let attempt = 0;

  while (attempt < 20) {
    const existing =
      await prisma.influencerCollection.findUnique({
        where: {
          slug: candidate,
        },
        select: {
          id: true,
        },
      });

    if (
      !existing ||
      existing.id === excludeCollectionId
    ) {
      return candidate;
    }

    attempt += 1;

    candidate = `${base}-${randomSlugSuffix()}`.slice(
      0,
      MAX_SLUG_LENGTH
    );
  }

  return `${base}-${Date.now()}`.slice(
    0,
    MAX_SLUG_LENGTH
  );
}

async function getInfluencerByUserId(userId) {
  if (!userId) {
    return null;
  }

  return prisma.influencerProfile.findUnique({
    where: {
      userId,
    },
    select: {
      id: true,
      userId: true,
      displayName: true,
      referralCode: true,
      status: true,
    },
  });
}

async function requireInfluencer(req, res) {
  const userId =
    req.user?.sub;

  if (!userId) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
    });

    return null;
  }

  const influencer =
    await getInfluencerByUserId(
      userId
    );

  if (!influencer) {
    res.status(403).json({
      ok: false,
      error: "influencer_required",
    });

    return null;
  }

  if (
    influencer.status !==
    "ACTIVE"
  ) {
    res.status(403).json({
      ok: false,
      error: "influencer_disabled",
    });

    return null;
  }

  return influencer;
}

async function getOwnedCollection(
  collectionId,
  influencerId
) {
  return prisma.influencerCollection.findFirst({
    where: {
      id: collectionId,
      influencerId,
    },
  });
}

function formatCollection(collection) {
  return {
    id:
      collection.id,

    title:
      collection.title,

    slug:
      collection.slug,

    description:
      collection.description,

    coverImage:
      collection.coverImage,

    isActive:
      collection.isActive,

    sort:
      collection.sort,

    visits:
      collection.visits,

    clicks:
      collection.clicks,

    productsCount:
      collection._count?.items ??
      collection.items?.length ??
      0,

    createdAt:
      collection.createdAt,

    updatedAt:
      collection.updatedAt,
  };
}

/* =========================================================
   VALIDATION
========================================================= */

const CreateCollectionSchema =
  z.object({
    title: z
      .string()
      .trim()
      .min(
        2,
        "Titlul trebuie să aibă minimum 2 caractere."
      )
      .max(
        MAX_TITLE_LENGTH
      ),

    description: z
      .string()
      .trim()
      .max(
        MAX_DESCRIPTION_LENGTH
      )
      .optional()
      .nullable(),

    coverImage: z
      .string()
      .trim()
      .optional()
      .nullable(),

    isActive: z
      .boolean()
      .optional()
      .default(true),
  });

const UpdateCollectionSchema =
  z.object({
    title: z
      .string()
      .trim()
      .min(2)
      .max(
        MAX_TITLE_LENGTH
      )
      .optional(),

    description: z
      .string()
      .trim()
      .max(
        MAX_DESCRIPTION_LENGTH
      )
      .optional()
      .nullable(),

    coverImage: z
      .string()
      .trim()
      .optional()
      .nullable(),

    isActive: z
      .boolean()
      .optional(),

    sort: z
      .string()
      .trim()
      .max(32)
      .optional(),
  });

const AddProductsSchema =
  z.object({
    productIds: z
      .array(
        z.string().trim().min(1)
      )
      .min(1)
      .max(
        MAX_COLLECTION_PRODUCTS
      ),
  });

const ReorderProductsSchema =
  z.object({
    items: z
      .array(
        z.object({
          productId: z
            .string()
            .trim()
            .min(1),

          position: z
            .number()
            .int()
            .min(0),
        })
      )
      .min(1)
      .max(
        MAX_COLLECTION_PRODUCTS
      ),
  });

  const AiRecommendSchema =
  z.object({
    collectionId: z
      .string()
      .trim()
      .min(1),

    prompt: z
      .string()
      .trim()
      .max(1500)
      .optional()
      .nullable(),

    budgetMin: z
      .union([
        z.number(),
        z.string(),
        z.null(),
      ])
      .optional(),

    budgetMax: z
      .union([
        z.number(),
        z.string(),
        z.null(),
      ])
      .optional(),

    limit: z
      .union([
        z.number(),
        z.string(),
      ])
      .optional(),
  });

/* =========================================================
   GET /api/influencer/collections

   Lista colecțiilor influencerului curent.
========================================================= */

router.get(
  "/",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const collections =
        await prisma.influencerCollection.findMany({
          where: {
            influencerId:
              influencer.id,
          },

          orderBy: {
            createdAt:
              "desc",
          },

          include: {
            _count: {
              select: {
                items: true,
              },
            },
          },
        });

      return res.json({
        ok: true,

        collections:
          collections.map(
            formatCollection
          ),
      });
    } catch (error) {
      console.error(
        "[influencerCollections] GET / error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "influencer_collections_failed",
      });
    }
  }
);

/* =========================================================
   POST /api/influencer/collections

   Creează colecție.
========================================================= */

router.post(
  "/",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const parsed =
        CreateCollectionSchema.safeParse(
          req.body || {}
        );

      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error:
            "invalid_payload",
          details:
            parsed.error.flatten(),
        });
      }

      const {
        title,
        description,
        coverImage,
        isActive,
      } = parsed.data;

      const slug =
        await buildUniqueSlug(
          title
        );

      const collection =
        await prisma.influencerCollection.create({
          data: {
            influencerId:
              influencer.id,

            title,

            slug,

            description:
              description || null,

            coverImage:
              coverImage || null,

            isActive,

            sort:
              "curated",
          },

          include: {
            _count: {
              select: {
                items: true,
              },
            },
          },
        });

      return res
        .status(201)
        .json({
          ok: true,

          collection:
            formatCollection(
              collection
            ),
        });
    } catch (error) {
      console.error(
        "[influencerCollections] POST / error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "influencer_collection_create_failed",
      });
    }
  }
);

/* =========================================================
   POST /api/influencer/collections/ai-recommend

   AI-ul nu inventează produse.
   Filtrăm produse reale în Prisma, iar AI-ul doar
   alege și ordonează dintre candidații trimiși.
========================================================= */

router.post(
  "/ai-recommend",

  authRequired,
  enforceTokenVersion,

  async (req, res) => {
    try {
      /* =====================================================
         INFLUENCER
      ===================================================== */

      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      /* =====================================================
         VALIDARE BODY
      ===================================================== */

      const parsed =
        AiRecommendSchema.safeParse(
          req.body || {}
        );

      if (
        !parsed.success
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_payload",

            message:
              "Datele pentru recomandările AI nu sunt valide.",

            details:
              parsed.error.flatten(),
          });
      }

      const collectionId =
        normalizeString(
          parsed.data
            .collectionId
        );

      /* =====================================================
         OWNERSHIP COLLECTION
      ===================================================== */

      const collection =
        await prisma
          .influencerCollection
          .findFirst({
            where: {
              id:
                collectionId,

              influencerId:
                influencer.id,
            },

            select: {
              id: true,

              title: true,

              description:
                true,

              items: {
                select: {
                  productId:
                    true,
                },
              },
            },
          });

      if (!collection) {
        return res
          .status(404)
          .json({
            ok: false,

            error:
              "collection_not_found",

            message:
              "Colecția nu a fost găsită.",
          });
      }

      /* =====================================================
         PROMPT
      ===================================================== */

      const prompt =
        normalizeString(
          parsed.data.prompt
        ) ||
        normalizeString(
          collection.description
        ) ||
        normalizeString(
          collection.title
        );

      if (!prompt) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "ai_prompt_required",

            message:
              "Scrie ce fel de produse vrei să găsească AI-ul.",
          });
      }

      /* =====================================================
         BUDGET
      ===================================================== */

      const budgetMin =
        optionalMoney(
          parsed.data
            .budgetMin
        );

      const budgetMax =
        optionalMoney(
          parsed.data
            .budgetMax
        );

      if (
        parsed.data
          .budgetMin !==
          undefined &&
        parsed.data
          .budgetMin !==
          null &&
        parsed.data
          .budgetMin !==
          "" &&
        budgetMin === null
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_budget_min",

            message:
              "Bugetul minim nu este valid.",
          });
      }

      if (
        parsed.data
          .budgetMax !==
          undefined &&
        parsed.data
          .budgetMax !==
          null &&
        parsed.data
          .budgetMax !==
          "" &&
        budgetMax === null
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_budget_max",

            message:
              "Bugetul maxim nu este valid.",
          });
      }

      if (
        budgetMin !== null &&
        budgetMax !== null &&
        budgetMin >
          budgetMax
      ) {
        return res
          .status(400)
          .json({
            ok: false,

            error:
              "invalid_budget_range",

            message:
              "Bugetul minim nu poate fi mai mare decât bugetul maxim.",
          });
      }

      /* =====================================================
         LIMIT
      ===================================================== */

      const limit =
        clampInteger(
          Number(
            parsed.data.limit
          ),

          AI_DEFAULT_LIMIT,

          1,

          AI_MAX_LIMIT
        );

      /* =====================================================
         EXCLUDE PRODUSE DEJA ÎN COLECȚIE
      ===================================================== */

      const existingIds =
        collection.items.map(
          (item) =>
            item.productId
        );

      /* =====================================================
         FILTRARE DETERMINISTĂ PRISMA
      ===================================================== */

      const productWhere = {
        isActive:
          true,

        isHidden:
          false,

        moderationStatus:
          "APPROVED",

        availability: {
          not:
            "SOLD_OUT",
        },
      };

      if (
        existingIds.length
      ) {
        productWhere.id = {
          notIn:
            existingIds,
        };
      }

      if (
        budgetMin !== null ||
        budgetMax !== null
      ) {
        productWhere.priceCents =
          {};

        if (
          budgetMin !== null
        ) {
          productWhere
            .priceCents
            .gte =
            Math.round(
              budgetMin *
                100
            );
        }

        if (
          budgetMax !== null
        ) {
          productWhere
            .priceCents
            .lte =
            Math.round(
              budgetMax *
                100
            );
        }
      }

      /* =====================================================
         CANDIDAȚI REALI
      ===================================================== */

      const candidates =
        await prisma
          .product
          .findMany({
            where:
              productWhere,

            take:
              AI_CANDIDATE_LIMIT,

            orderBy: [
              {
                popularityScore:
                  "desc",
              },

              {
                createdAt:
                  "desc",
              },
            ],

            select: {
              id:
                true,

              title:
                true,

              description:
                true,

              priceCents:
                true,

              currency:
                true,

              images:
                true,

              category:
                true,

              color:
                true,

              materialMain:
                true,

              technique:
                true,

              styleTags:
                true,

              occasionTags:
                true,

              dimensions:
                true,

              acceptsCustom:
                true,

              orderMode:
                true,

              availability:
                true,

              leadTimeDays:
                true,

              service: {
                select: {
                  id:
                    true,

                  title:
                    true,

                  vendor: {
                    select: {
                      id:
                        true,

                      displayName:
                        true,
                    },
                  },
                },
              },
            },
          });

      if (
        !candidates.length
      ) {
        return res.json({
          ok:
            true,

          recommendations:
            [],

          meta: {
            candidates:
              0,

            requested:
              limit,
          },
        });
      }

      /* =====================================================
         PAYLOAD COMPACT PENTRU AI
      ===================================================== */

      const aiCandidates =
        candidates.map(
          (product) => ({
            id:
              product.id,

            title:
              product.title,

            description:
              normalizeString(
                product.description
              ).slice(
                0,
                700
              ),

            priceLei:
              Number(
                (
                  product.priceCents /
                  100
                ).toFixed(
                  2
                )
              ),

            category:
              product.category,

            color:
              product.color,

            material:
              product.materialMain,

            technique:
              product.technique,

            styleTags:
              product.styleTags ||
              [],

            occasionTags:
              product.occasionTags ||
              [],

            personalized:
              Boolean(
                product.acceptsCustom
              ),

            orderMode:
              product.orderMode,

            availability:
              product.availability,

            leadTimeDays:
              product.leadTimeDays,

            vendor:
              product.service
                ?.vendor
                ?.displayName ||
              null,
          })
        );

      /* =====================================================
         OPENAI
      ===================================================== */

      const response =
        await openai
          .responses
          .create({
            model:
              AI_RECOMMENDATION_MODEL,

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
Ești asistentul AI Artfest pentru influenceri.

Artfest este un marketplace cu produse handmade, produse personalizate și produse pentru evenimente.

Un influencer creează o colecție sau campanie și vrea să aleagă cele mai potrivite produse REALE din catalog.

CEREREA INFLUENCERULUI:

${prompt}

TITLUL COLECȚIEI:

${normalizeString(
  collection.title
)}

DESCRIEREA COLECȚIEI:

${
  normalizeString(
    collection.description
  ) ||
  "Nu există descriere."
}

BUGET:

minim:
${
  budgetMin !== null
    ? `${budgetMin} lei`
    : "nespecificat"
}

maxim:
${
  budgetMax !== null
    ? `${budgetMax} lei`
    : "nespecificat"
}

NUMĂR MAXIM DE RECOMANDĂRI:

${limit}

PRODUSE CANDIDATE REALE:

${JSON.stringify(
  aiCandidates
)}

REGULI OBLIGATORII:

1. Poți recomanda EXCLUSIV productId-uri din lista PRODUSE CANDIDATE REALE.

2. Nu inventa niciun produs și niciun ID.

3. Nu modifica prețurile sau caracteristicile produselor.

4. Alege produsele care se potrivesc cel mai bine intenției, ocaziei, publicului, stilului și bugetului.

5. Favorizează diversitatea. Evită ca toate recomandările să fie aproape identice dacă există alternative bune.

6. Dacă promptul cere produse personalizabile, favorizează produsele cu personalized=true.

7. Dacă există un termen sau o nevoie de disponibilitate imediată în prompt, ține cont de availability și leadTimeDays.

8. Motivul trebuie să fie concret, scurt și în limba română.

9. Nu spune lucruri despre produs care nu apar în datele primite.

10. Returnează cel mult ${limit} produse.

11. Dacă niciun produs nu este potrivit, returnează recommendations: [].

12. Returnează EXCLUSIV JSON valid, fără markdown.

SCHEMA EXACTĂ:

{
  "recommendations": [
    {
      "productId": "id-real-din-lista",
      "score": 0.95,
      "reason": "Motiv scurt și concret."
    }
  ]
}
`,
                  },
                ],
              },
            ],
          });

      /* =====================================================
         PARSE AI
      ===================================================== */

      const aiResult =
        safeJsonParse(
          response.output_text
        );

      if (
        !aiResult ||
        !Array.isArray(
          aiResult
            .recommendations
        )
      ) {
        return res
          .status(500)
          .json({
            ok:
              false,

            error:
              "invalid_ai_response",

            message:
              "AI-ul nu a returnat o selecție validă.",
          });
      }

      /* =====================================================
         SECURITY:
         acceptăm doar IDs care au fost trimise AI-ului
      ===================================================== */

      const candidateMap =
        new Map(
          candidates.map(
            (product) => [
              product.id,
              product,
            ]
          )
        );

      const seenIds =
        new Set();

      const normalized =
        aiResult
          .recommendations
          .map(
            (item) => {
              const productId =
                normalizeString(
                  item?.productId
                );

              if (
                !productId ||
                seenIds.has(
                  productId
                ) ||
                !candidateMap.has(
                  productId
                )
              ) {
                return null;
              }

              seenIds.add(
                productId
              );

              const rawScore =
                Number(
                  item?.score
                );

              const score =
                Number.isFinite(
                  rawScore
                )
                  ? Math.min(
                      1,
                      Math.max(
                        0,
                        rawScore
                      )
                    )
                  : null;

              return {
                productId,

                score,

                reason:
                  cleanAiReason(
                    item?.reason
                  ) ||
                  "Produs potrivit pentru această selecție.",

                product:
                  candidateMap.get(
                    productId
                  ),
              };
            }
          )
          .filter(
            Boolean
          )
          .slice(
            0,
            limit
          );

      /* =====================================================
         RESPONSE
      ===================================================== */

      return res.json({
        ok:
          true,

        recommendations:
          normalized,

        meta: {
          candidates:
            candidates.length,

          requested:
            limit,

          returned:
            normalized.length,

          model:
            AI_RECOMMENDATION_MODEL,
        },
      });
    } catch (error) {
      console.error(
        "[influencerCollections] POST /ai-recommend error:",
        error
      );

      return res
        .status(500)
        .json({
          ok:
            false,

          error:
            "influencer_collection_ai_recommend_failed",

          message:
            "Nu am putut genera recomandările AI. Te rog să încerci din nou.",
        });
    }
  }
);

/* =========================================================
   GET /api/influencer/collections/:id

   Detaliile unei colecții proprii.
========================================================= */

router.get(
  "/:id",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const collectionId =
        normalizeString(
          req.params.id
        );

      const collection =
        await prisma.influencerCollection.findFirst({
          where: {
            id: collectionId,

            influencerId:
              influencer.id,
          },

          include: {
            items: {
              orderBy: [
                {
                  position:
                    "asc",
                },
                {
                  createdAt:
                    "asc",
                },
              ],

              include: {
                product: {
                  select: {
                    id: true,
                    title: true,
                    priceCents: true,
                    currency: true,
                    images: true,
                    isActive: true,
                    isHidden: true,
                    moderationStatus:
                      true,
                    availability:
                      true,

                    service: {
                      select: {
                        id: true,
                        title: true,

                        vendor: {
                          select: {
                            id: true,
                            displayName:
                              true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });

      if (!collection) {
        return res.status(404).json({
          ok: false,
          error:
            "collection_not_found",
        });
      }

      return res.json({
        ok: true,

        collection: {
          ...formatCollection(
            collection
          ),

          items:
            collection.items.map(
              (item) => ({
                productId:
                  item.productId,

                position:
                  item.position,

                createdAt:
                  item.createdAt,

                product:
                  item.product,
              })
            ),
        },
      });
    } catch (error) {
      console.error(
        "[influencerCollections] GET /:id error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "influencer_collection_failed",
      });
    }
  }
);

/* =========================================================
   PATCH /api/influencer/collections/:id

   Editează titlu / descriere / copertă / status.
========================================================= */

router.patch(
  "/:id",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const collectionId =
        normalizeString(
          req.params.id
        );

      const existing =
        await getOwnedCollection(
          collectionId,
          influencer.id
        );

      if (!existing) {
        return res.status(404).json({
          ok: false,
          error:
            "collection_not_found",
        });
      }

      const parsed =
        UpdateCollectionSchema.safeParse(
          req.body || {}
        );

      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error:
            "invalid_payload",
          details:
            parsed.error.flatten(),
        });
      }

      const data = {};

      if (
        parsed.data.title !==
        undefined
      ) {
        data.title =
          parsed.data.title;

        if (
          parsed.data.title !==
          existing.title
        ) {
          data.slug =
            await buildUniqueSlug(
              parsed.data.title,
              existing.id
            );
        }
      }

      if (
        parsed.data.description !==
        undefined
      ) {
        data.description =
          parsed.data.description ||
          null;
      }

      if (
        parsed.data.coverImage !==
        undefined
      ) {
        data.coverImage =
          parsed.data.coverImage ||
          null;
      }

      if (
        parsed.data.isActive !==
        undefined
      ) {
        data.isActive =
          parsed.data.isActive;
      }

      if (
        parsed.data.sort !==
        undefined
      ) {
        data.sort =
          parsed.data.sort;
      }

      const collection =
        await prisma.influencerCollection.update({
          where: {
            id: existing.id,
          },

          data,

          include: {
            _count: {
              select: {
                items: true,
              },
            },
          },
        });

      return res.json({
        ok: true,

        collection:
          formatCollection(
            collection
          ),
      });
    } catch (error) {
      console.error(
        "[influencerCollections] PATCH /:id error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "influencer_collection_update_failed",
      });
    }
  }
);

/* =========================================================
   DELETE /api/influencer/collections/:id

   Șterge colecția.
   Item-urile sunt șterse automat prin Cascade.
========================================================= */

router.delete(
  "/:id",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const collectionId =
        normalizeString(
          req.params.id
        );

      const existing =
        await getOwnedCollection(
          collectionId,
          influencer.id
        );

      if (!existing) {
        return res.status(404).json({
          ok: false,
          error:
            "collection_not_found",
        });
      }

      await prisma.influencerCollection.delete({
        where: {
          id:
            existing.id,
        },
      });

      return res.json({
        ok: true,

        deletedId:
          existing.id,
      });
    } catch (error) {
      console.error(
        "[influencerCollections] DELETE /:id error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "influencer_collection_delete_failed",
      });
    }
  }
);

/* =========================================================
   POST /api/influencer/collections/:id/products

   Body:
   {
     productIds: ["...", "..."]
   }

   Adaugă unul sau mai multe produse.
========================================================= */

router.post(
  "/:id/products",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const collectionId =
        normalizeString(
          req.params.id
        );

      const collection =
        await getOwnedCollection(
          collectionId,
          influencer.id
        );

      if (!collection) {
        return res.status(404).json({
          ok: false,
          error:
            "collection_not_found",
        });
      }

      const parsed =
        AddProductsSchema.safeParse(
          req.body || {}
        );

      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error:
            "invalid_payload",
          details:
            parsed.error.flatten(),
        });
      }

      const productIds = [
        ...new Set(
          parsed.data
            .productIds
            .map(
              normalizeString
            )
            .filter(Boolean)
        ),
      ];

      const existingCount =
        await prisma.influencerCollectionItem.count({
          where: {
            collectionId:
              collection.id,
          },
        });

      if (
        existingCount +
          productIds.length >
        MAX_COLLECTION_PRODUCTS
      ) {
        return res.status(400).json({
          ok: false,

          error:
            "collection_product_limit",

          message:
            `O colecție poate avea maximum ${MAX_COLLECTION_PRODUCTS} produse.`,
        });
      }

      /*
       * Permitem doar produse publicabile.
       */

      const products =
        await prisma.product.findMany({
          where: {
            id: {
              in:
                productIds,
            },

            isActive:
              true,

            isHidden:
              false,

            moderationStatus:
              "APPROVED",
          },

          select: {
            id: true,
          },
        });

      const validProductIds =
        products.map(
          (product) =>
            product.id
        );

      if (
        !validProductIds.length
      ) {
        return res.status(400).json({
          ok: false,

          error:
            "no_valid_products",

          message:
            "Nu am găsit produse eligibile pentru colecție.",
        });
      }

      const currentItems =
        await prisma.influencerCollectionItem.findMany({
          where: {
            collectionId:
              collection.id,
          },

          select: {
            productId: true,
          },
        });

      const existingIds =
        new Set(
          currentItems.map(
            (item) =>
              item.productId
          )
        );

      const idsToAdd =
        validProductIds.filter(
          (productId) =>
            !existingIds.has(
              productId
            )
        );

      if (!idsToAdd.length) {
        return res.json({
          ok: true,

          added:
            0,

          message:
            "Produsele sunt deja în colecție.",
        });
      }

      const lastItem =
        await prisma.influencerCollectionItem.findFirst({
          where: {
            collectionId:
              collection.id,
          },

          orderBy: {
            position:
              "desc",
          },

          select: {
            position: true,
          },
        });

      const startPosition =
        Number(
          lastItem
            ?.position ??
            -1
        ) + 1;

      await prisma.influencerCollectionItem.createMany({
        data:
          idsToAdd.map(
            (
              productId,
              index
            ) => ({
              collectionId:
                collection.id,

              productId,

              position:
                startPosition +
                index,
            })
          ),

        skipDuplicates:
          true,
      });

      return res.json({
        ok: true,

        added:
          idsToAdd.length,

        productIds:
          idsToAdd,
      });
    } catch (error) {
      console.error(
        "[influencerCollections] POST /:id/products error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "influencer_collection_add_products_failed",
      });
    }
  }
);

/* =========================================================
   DELETE /api/influencer/collections/:id/products/:productId

   Elimină un produs din colecție.
========================================================= */

router.delete(
  "/:id/products/:productId",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const collectionId =
        normalizeString(
          req.params.id
        );

      const productId =
        normalizeString(
          req.params.productId
        );

      const collection =
        await getOwnedCollection(
          collectionId,
          influencer.id
        );

      if (!collection) {
        return res.status(404).json({
          ok: false,
          error:
            "collection_not_found",
        });
      }

      const item =
        await prisma.influencerCollectionItem.findUnique({
          where: {
            collectionId_productId: {
              collectionId:
                collection.id,

              productId,
            },
          },
        });

      if (!item) {
        return res.status(404).json({
          ok: false,
          error:
            "collection_product_not_found",
        });
      }

      await prisma.influencerCollectionItem.delete({
        where: {
          collectionId_productId: {
            collectionId:
              collection.id,

            productId,
          },
        },
      });

      return res.json({
        ok: true,

        productId,
      });
    } catch (error) {
      console.error(
        "[influencerCollections] DELETE /:id/products/:productId error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "influencer_collection_remove_product_failed",
      });
    }
  }
);

/* =========================================================
   PATCH /api/influencer/collections/:id/products/reorder

   Body:
   {
     items: [
       { productId: "...", position: 0 },
       { productId: "...", position: 1 }
     ]
   }
========================================================= */

router.patch(
  "/:id/products/reorder",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer =
        await requireInfluencer(
          req,
          res
        );

      if (!influencer) {
        return;
      }

      const collectionId =
        normalizeString(
          req.params.id
        );

      const collection =
        await getOwnedCollection(
          collectionId,
          influencer.id
        );

      if (!collection) {
        return res.status(404).json({
          ok: false,
          error:
            "collection_not_found",
        });
      }

      const parsed =
        ReorderProductsSchema.safeParse(
          req.body || {}
        );

      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error:
            "invalid_payload",
          details:
            parsed.error.flatten(),
        });
      }

      const currentItems =
        await prisma.influencerCollectionItem.findMany({
          where: {
            collectionId:
              collection.id,
          },

          select: {
            productId: true,
          },
        });

      const allowedIds =
        new Set(
          currentItems.map(
            (item) =>
              item.productId
          )
        );

      for (
        const item of
        parsed.data.items
      ) {
        if (
          !allowedIds.has(
            item.productId
          )
        ) {
          return res.status(400).json({
            ok: false,

            error:
              "product_not_in_collection",
          });
        }
      }

      await prisma.$transaction(
        parsed.data.items.map(
          (item) =>
            prisma.influencerCollectionItem.update({
              where: {
                collectionId_productId: {
                  collectionId:
                    collection.id,

                  productId:
                    item.productId,
                },
              },

              data: {
                position:
                  item.position,
              },
            })
        )
      );

      return res.json({
        ok: true,
      });
    } catch (error) {
      console.error(
        "[influencerCollections] PATCH reorder error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "influencer_collection_reorder_failed",
      });
    }
  }
);

/* =========================================================
   GET /api/influencer/collections/public/:slug

   Endpoint public.

   IMPORTANT:
   Trebuie declarat DUPĂ rutele protejate cu /:id,
   altfel "public" poate fi interpretat ca id.
========================================================= */

router.get(
  "/public/:slug",
  async (req, res) => {
    try {
      const slug =
        normalizeString(
          req.params.slug
        );

      if (!slug) {
        return res.status(400).json({
          ok: false,
          error:
            "slug_required",
        });
      }

      const collection =
        await prisma.influencerCollection.findFirst({
          where: {
            slug,

            isActive:
              true,

            influencer: {
              status:
                "ACTIVE",
            },
          },

          include: {
            influencer: {
              select: {
                id: true,
                displayName:
                  true,
              },
            },

            items: {
              where: {
                product: {
                  isActive:
                    true,

                  isHidden:
                    false,

                  moderationStatus:
                    "APPROVED",
                },
              },

              orderBy: [
                {
                  position:
                    "asc",
                },
                {
                  createdAt:
                    "asc",
                },
              ],

              include: {
                product: {
                  select: {
                    id: true,
                    title: true,
                    description:
                      true,
                    priceCents:
                      true,
                    currency:
                      true,
                    images: true,
                    availability:
                      true,
                    category:
                      true,

                    service: {
                      select: {
                        id: true,
                        title: true,

                        vendor: {
                          select: {
                            id: true,
                            displayName:
                              true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });

      if (!collection) {
        return res.status(404).json({
          ok: false,
          error:
            "collection_not_found",
        });
      }

      /*
       * Contorizare simplă a vizitei.
       * Nu blocăm răspunsul dacă update-ul eșuează.
       */

      prisma.influencerCollection
        .update({
          where: {
            id:
              collection.id,
          },

          data: {
            visits: {
              increment:
                1,
            },
          },
        })
        .catch(
          (error) => {
            console.error(
              "[influencerCollections] visit counter error:",
              error
            );
          }
        );

      return res.json({
        ok: true,

        collection: {
          id:
            collection.id,

          title:
            collection.title,

          slug:
            collection.slug,

          description:
            collection.description,

          coverImage:
            collection.coverImage,

          visits:
            collection.visits,

          influencer: {
            id:
              collection
                .influencer
                .id,

            displayName:
              collection
                .influencer
                .displayName,
          },

          products:
            collection.items.map(
              (item) =>
                item.product
            ),
        },
      });
    } catch (error) {
      console.error(
        "[influencerCollections] GET public/:slug error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error:
          "public_influencer_collection_failed",
      });
    }
  }
);

export default router;