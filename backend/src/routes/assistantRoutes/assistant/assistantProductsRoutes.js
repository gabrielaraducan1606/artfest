// src/routes/assistant/assistantProducts.routes.js

import { Router } from "express";
import multer from "multer";

import {
  searchByImage,
  searchByText,
  recommendGifts,
  searchByBudget,
  refineProductSearch,
  getSavedProductSearch,
} from "./assitantRoutes.service.js";

const router = Router();

/* ======================================================
   Configurare upload imagine
====================================================== */

const MAX_IMAGE_SIZE =
  10 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES =
  new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
  ]);

const uploadImage = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_IMAGE_SIZE,
    files: 1,
  },

  fileFilter: (
    _req,
    file,
    callback
  ) => {
    if (
      !ALLOWED_IMAGE_TYPES.has(
        file.mimetype
      )
    ) {
      callback(
        new Error(
          "Sunt acceptate doar imagini JPG, PNG sau WEBP."
        )
      );

      return;
    }

    callback(null, true);
  },
});

/* ======================================================
   Helpers HTTP
====================================================== */

function getErrorStatus(
  error,
  fallbackStatus = 500
) {
  const status = Number(
    error?.status ||
      error?.statusCode
  );

  if (
    Number.isInteger(status) &&
    status >= 400 &&
    status <= 599
  ) {
    return status;
  }

  return fallbackStatus;
}

function sendError(
  res,
  error,
  {
    code,
    fallbackMessage,
    fallbackStatus = 500,
  }
) {
  const status = getErrorStatus(
    error,
    fallbackStatus
  );

  return res
    .status(status)
    .json({
      error:
        error?.code || code,

      message:
        error?.message ||
        fallbackMessage,
    });
}

function cleanText(
  value,
  maxLength = 1000
) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parsePositiveInteger(
  value,
  fallback,
  max = null
) {
  const parsed = Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < 1
  ) {
    return fallback;
  }

  const integer =
    Math.floor(parsed);

  return max
    ? Math.min(integer, max)
    : integer;
}

/* ======================================================
   POST /api/assistant/products/search-by-image
====================================================== */

router.post(
  "/search-by-image",

  uploadImage.single("image"),

  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            error:
              "image_required",

            message:
              "Încarcă o fotografie pentru a căuta produse similare.",
          });
      }

      const result =
        await searchByImage({
          file: req.file,

          userId:
            req.user?.id ||
            null,
        });

      return res.json(result);
    } catch (error) {
      console.error(
        "Visual product search failed:",
        error
      );

      return sendError(
        res,
        error,
        {
          code:
            "visual_search_failed",

          fallbackMessage:
            "Nu am putut căuta produse după fotografie.",
        }
      );
    }
  }
);

/* ======================================================
   POST /api/assistant/products/search

   Body:
   {
     "query": "lumânare crem minimalistă",
     "minPriceCents": 0,
     "maxPriceCents": 25000,
     "customizableOnly": false
   }
====================================================== */

router.post(
  "/search",

  async (req, res) => {
    try {
      const query =
        cleanText(
          req.body?.query,
          1000
        );

      if (!query) {
        return res
          .status(400)
          .json({
            error:
              "query_required",

            message:
              "Descrie produsul pe care îl cauți.",
          });
      }

      const result =
        await searchByText({
          query,

          minPriceCents:
            req.body
              ?.minPriceCents,

          maxPriceCents:
            req.body
              ?.maxPriceCents,

          customizableOnly:
            req.body
              ?.customizableOnly ===
            true,

          userId:
            req.user?.id ||
            null,
        });

      return res.json(result);
    } catch (error) {
      console.error(
        "AI product search failed:",
        error
      );

      return sendError(
        res,
        error,
        {
          code:
            "product_search_failed",

          fallbackMessage:
            "Nu am putut căuta produsele.",
        }
      );
    }
  }
);

/* ======================================================
   POST /api/assistant/products/gift-recommendations

   Body:
   {
     "recipient": "Pentru ea",
     "occasion": "Zi de naștere",
     "budgetLabel": "100–250 lei",
     "minPriceCents": 10000,
     "maxPriceCents": 25000,
     "notes": "îi plac produsele minimaliste"
   }
====================================================== */

router.post(
  "/gift-recommendations",

  async (req, res) => {
    try {
      const recipient =
        cleanText(
          req.body
            ?.recipient,
          160
        );

      const occasion =
        cleanText(
          req.body
            ?.occasion,
          160
        );

      const notes =
        cleanText(
          req.body?.notes,
          1000
        );

      if (!recipient) {
        return res
          .status(400)
          .json({
            error:
              "recipient_required",

            message:
              "Spune pentru cine cauți cadoul.",
          });
      }

      if (!occasion) {
        return res
          .status(400)
          .json({
            error:
              "occasion_required",

            message:
              "Spune pentru ce ocazie este cadoul.",
          });
      }

      const result =
        await recommendGifts({
          recipient,
          occasion,
          notes,

          budgetLabel:
            req.body
              ?.budgetLabel,

          minPriceCents:
            req.body
              ?.minPriceCents,

          maxPriceCents:
            req.body
              ?.maxPriceCents,

          userId:
            req.user?.id ||
            null,
        });

      return res.json(result);
    } catch (error) {
      console.error(
        "Gift recommendations failed:",
        error
      );

      return sendError(
        res,
        error,
        {
          code:
            "gift_recommendations_failed",

          fallbackMessage:
            "Nu am putut genera recomandările de cadouri.",
        }
      );
    }
  }
);

/* ======================================================
   POST /api/assistant/products/search-by-budget

   Body:
   {
     "budgetLabel": "100–250 lei",
     "minPriceCents": 10000,
     "maxPriceCents": 25000,
     "query": "decorațiuni"
   }
====================================================== */

router.post(
  "/search-by-budget",

  async (req, res) => {
    try {
      const query =
        cleanText(
          req.body?.query,
          1000
        );

      const hasBudget =
        req.body
          ?.budgetLabel ||
        req.body
          ?.minPriceCents !==
          undefined ||
        req.body
          ?.maxPriceCents !==
          undefined;

      if (!hasBudget) {
        return res
          .status(400)
          .json({
            error:
              "budget_required",

            message:
              "Trimite un buget sau un interval de preț.",
          });
      }

      const result =
        await searchByBudget({
          query,

          budgetLabel:
            req.body
              ?.budgetLabel,

          minPriceCents:
            req.body
              ?.minPriceCents,

          maxPriceCents:
            req.body
              ?.maxPriceCents,

          customizableOnly:
            req.body
              ?.customizableOnly ===
            true,

          userId:
            req.user?.id ||
            null,
        });

      return res.json(result);
    } catch (error) {
      console.error(
        "Budget product search failed:",
        error
      );

      return sendError(
        res,
        error,
        {
          code:
            "budget_search_failed",

          fallbackMessage:
            "Nu am putut căuta produsele în bugetul ales.",
        }
      );
    }
  }
);

/* ======================================================
   POST /api/assistant/products/refine-search

   Body:
   {
     "searchId": "...",
     "instruction": "mai ieftine"
   }
====================================================== */

router.post(
  "/refine-search",

  async (req, res) => {
    try {
      const searchId =
        cleanText(
          req.body
            ?.searchId,
          120
        );

      const instruction =
        cleanText(
          req.body
            ?.instruction,
          1000
        );

      if (!searchId) {
        return res
          .status(400)
          .json({
            error:
              "search_id_required",

            message:
              "Identificatorul căutării lipsește.",
          });
      }

      if (!instruction) {
        return res
          .status(400)
          .json({
            error:
              "instruction_required",

            message:
              "Spune cum dorești să rafinezi rezultatele.",
          });
      }

      const result =
        await refineProductSearch({
          searchId,
          instruction,

          userId:
            req.user?.id ||
            null,
        });

      return res.json(result);
    } catch (error) {
      console.error(
        "Refine product search failed:",
        error
      );

      return sendError(
        res,
        error,
        {
          code:
            "refine_search_failed",

          fallbackMessage:
            "Nu am putut rafina căutarea.",
        }
      );
    }
  }
);

/* ======================================================
   GET /api/assistant/products/visual-search/:searchId

   Query:
   ?page=1&limit=24
====================================================== */

router.get(
  "/visual-search/:searchId",

  async (req, res) => {
    try {
      const searchId =
        cleanText(
          req.params
            ?.searchId,
          120
        );

      if (!searchId) {
        return res
          .status(400)
          .json({
            error:
              "search_id_required",

            message:
              "Identificatorul căutării lipsește.",
          });
      }

      const page =
        parsePositiveInteger(
          req.query?.page,
          1
        );

      const limit =
        parsePositiveInteger(
          req.query?.limit,
          24,
          60
        );

      const result =
        await getSavedProductSearch({
          searchId,
          page,
          limit,

          userId:
            req.user?.id ||
            null,
        });

      return res.json(result);
    } catch (error) {
      console.error(
        "Get saved product search failed:",
        error
      );

      return sendError(
        res,
        error,
        {
          code:
            "search_not_found",

          fallbackMessage:
            "Căutarea nu mai este disponibilă.",
          fallbackStatus: 404,
        }
      );
    }
  }
);

/* ======================================================
   Tratarea erorilor Multer
====================================================== */

router.use(
  (
    error,
    _req,
    res,
    next
  ) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res
          .status(413)
          .json({
            error:
              "image_too_large",

            message:
              "Imaginea este prea mare. Limita este de 10 MB.",
          });
      }

      if (
        error.code ===
        "LIMIT_FILE_COUNT"
      ) {
        return res
          .status(400)
          .json({
            error:
              "too_many_files",

            message:
              "Poți încărca o singură imagine.",
          });
      }

      if (
        error.code ===
        "LIMIT_UNEXPECTED_FILE"
      ) {
        return res
          .status(400)
          .json({
            error:
              "unexpected_file",

            message:
              "Imaginea trebuie trimisă în câmpul «image».",
          });
      }

      return res
        .status(400)
        .json({
          error:
            "upload_error",

          message:
            "Imaginea nu a putut fi încărcată.",
        });
    }

    if (
      error?.message ===
      "Sunt acceptate doar imagini JPG, PNG sau WEBP."
    ) {
      return res
        .status(400)
        .json({
          error:
            "invalid_image_type",

          message:
            error.message,
        });
    }

    return next(error);
  }
);

export default router;