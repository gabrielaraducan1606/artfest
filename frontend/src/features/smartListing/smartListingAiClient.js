// src/features/smartListing/smartListingAiClient.js
//
// Analiza AI REALĂ a fotografiilor - EXACT integrarea folosită azi de
// ProductModal (useProductEditorController.handleAiAnalyze):
//   POST /ai/product-analyze  { images: [până la 4 URL-uri încărcate] }
//   backend/src/routes/aiRoutes.js (model, prompt, reguli - NEMODIFICATE).
//
// Diferența față de ProductModal e DOAR în cum se aplică rezultatul: aici
// trece prin proposalFromLegacyAnalysis (format validat; preț / stoc /
// GPSR eliminate; material / tehnică doar sugestii) și NU suprascrie ce a
// scris vânzătorul (applyProposalToDraft). Nu există date demonstrative aici:
// mock-urile stau doar în teste (smartListingMockAi.js).

import { selectImagesForAi } from "./smartListingMedia.js";
import { proposalFromLegacyAnalysis } from "./smartListingProposal.js";

export const AI_ENDPOINT = "/ai/product-analyze";

export class SmartListingAiError extends Error {
  constructor(message, { code = "ai_failed", status = null } = {}) {
    super(message);
    this.name = "SmartListingAiError";
    this.code = code;
    this.status = status;
  }
}

function friendlyError(error) {
  const status = Number(error?.status || error?.response?.status || error?.data?.status) || null;
  const serverMessage = error?.data?.message || error?.message || "";

  if (status === 401 || status === 403) {
    return new SmartListingAiError("Sesiunea a expirat sau contul nu are acces la analiza AI. Autentifică-te din nou.", {
      code: "ai_forbidden",
      status,
    });
  }
  if (status === 429) {
    return new SmartListingAiError("Ai atins limita de analize AI pentru moment. Poți completa manual.", {
      code: "ai_rate_limited",
      status,
    });
  }
  if (status && status >= 500) {
    return new SmartListingAiError("Analiza AI nu este disponibilă acum. Poți încerca din nou sau poți completa manual.", {
      code: "ai_unavailable",
      status,
    });
  }
  return new SmartListingAiError(serverMessage || "Nu am putut analiza fotografiile. Poți completa manual.", {
    code: "ai_failed",
    status,
  });
}

/**
 * @param {{ imageUrls: string[], api: Function, resolveUrl?: (url: string) => string }} input
 *   imageUrls - URL-urile fotografiilor DEJA încărcate (ordinea din galerie)
 *   api       - clientul existent (lib/api.js); injectat pentru teste
 * @returns {Promise<{ proposal: Object, dropped: string[], errors: string[], sentImages: string[] }>}
 */
export async function analyzeProductPhotos({ imageUrls, api, resolveUrl }) {
  const images = selectImagesForAi(imageUrls, resolveUrl);
  if (!images.length) {
    throw new SmartListingAiError("Încarcă mai întâi cel puțin o fotografie.", { code: "no_images" });
  }

  let raw;
  try {
    raw = await api(AI_ENDPOINT, { method: "POST", body: { images } });
  } catch (error) {
    throw friendlyError(error);
  }

  const result = proposalFromLegacyAnalysis(raw);
  if (!result.ok) {
    throw new SmartListingAiError("AI-ul nu a putut recunoaște produsul din fotografii. Poți completa manual.", {
      code: "ai_empty",
    });
  }

  return { proposal: result.proposal, dropped: result.dropped, errors: result.errors, sentImages: images };
}
