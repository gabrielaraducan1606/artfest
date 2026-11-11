// backend/src/middleware/aiImageEditingGate.js
//
// Oprire TEMPORARĂ a editării / generării fotografiilor cu AI (modelul
// gpt-image-1, retras de OpenAI pe 2026-10-23), până la decizia de migrare.
//
//   AI_IMAGE_EDITING_ENABLED = "1" / "true" -> pornit
//   orice altă valoare sau nesetat          -> OPRIT (și local)
//
// Oprit -> endpointurile răspund 503 ai_image_editing_disabled ÎNAINTE de
// orice procesare (fără descărcare de imagine, fără OpenAI, fără R2).
// Implementarea rutelor rămâne neschimbată, pentru reactivare.
//
// Folosit pe:
//   POST /api/ai/product-image-enhance                    (aiRoutes.js)
//   POST /api/admin/homepage-features/:id/generate-image  (adminHomepageFeatureRoutes.js)
//
// NU se aplică analizei fotografiilor (/api/ai/product-analyze etc.),
// încărcării în R2 sau administrării produselor.
//
// Flag-ul pereche din frontend: AI_IMAGE_EDITING_ENABLED (frontend/src/config/features.js).

export const AI_IMAGE_EDITING_DISABLED_ERROR = "ai_image_editing_disabled";
export const AI_IMAGE_EDITING_DISABLED_MESSAGE = "Funcționalitate temporar indisponibilă";

export function isAiImageEditingEnabled(env = process.env) {
  const raw = String(env.AI_IMAGE_EDITING_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export function requireAiImageEditingEnabled(_req, res, next) {
  if (isAiImageEditingEnabled()) return next();
  return res.status(503).json({
    ok: false,
    error: AI_IMAGE_EDITING_DISABLED_ERROR,
    message: AI_IMAGE_EDITING_DISABLED_MESSAGE,
  });
}
