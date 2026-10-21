// src/middleware/aiImageSearchRateLimit.js
//
// Căutarea vizuală AI a Asistentului (POST /api/assistant/products/
// search-by-image - OpenAI cu imagine, cost per apel) e publică, deci
// limitată per IP: implicit 10 / oră (RATE_AI_IMAGE_SEARCH_MAX).
// Fără DB: memory store, per instanță.
//
// keyGenerator primește IP-ul (ipKeyGenerator(req.ip)), nu `req` -
// în express-rate-limit 8, ipKeyGenerator(ip) așteaptă un string.

import rateLimit, { ipKeyGenerator } from "express-rate-limit";

export function createAiImageSearchLimiter({
  max = Number(process.env.RATE_AI_IMAGE_SEARCH_MAX || 10),
  windowMs = 60 * 60 * 1000,
} = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip || ""),
    message: {
      error: "image_search_rate_limited",
      message: `Ai atins limita de ${max} căutări după fotografie pe oră. Încearcă din nou mai târziu sau descrie în cuvinte ce cauți.`,
    },
  });
}
