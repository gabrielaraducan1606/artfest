// src/features/smartListing/smartListingMedia.js
//
// Artfest Smart Listing (PROTOTIP) - regulile pentru videoclipul produsului.
// Aceleași limite și mesaje ca fluxul real, NEMODIFICAT:
//   - backend/src/routes/uploadRoutes.js: ALLOWED_VIDEO_MIME_TYPES
//     ["video/mp4", "video/webm"], limits.fileSize 50 MB;
//   - frontend/src/components/ProductVideoField.jsx (mesajele de eroare).
// Testul smartListing.test.js verifică că valorile rămân sincronizate.
//
// În prototip videoclipul rămâne LOCAL (URL.createObjectURL) - nu se
// încarcă nicăieri. „Redă fără sunet” e doar o opțiune salvată în ciornă
// (videoMuted); în fluxul real, sunetul e eliminat definitiv de server.

export const VIDEO_MIME_TYPES = Object.freeze(["video/mp4", "video/webm"]);
export const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;

export const VIDEO_SIZE_ERROR =
  "Videoul este prea mare (peste 50 MB). Alege un fișier mai mic sau comprimă-l înainte de a-l încărca.";
export const VIDEO_TYPE_ERROR = "Acest tip de fișier nu este acceptat. Încarcă un video MP4 sau WebM.";

/**
 * @param {{ type?: string, size?: number }} file
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateVideoFile(file) {
  if (!file) return { ok: false, message: VIDEO_TYPE_ERROR };
  if (!VIDEO_MIME_TYPES.includes(String(file.type || "").toLowerCase())) {
    return { ok: false, message: VIDEO_TYPE_ERROR };
  }
  if (!(Number(file.size) > 0) || Number(file.size) > MAX_VIDEO_SIZE_BYTES) {
    return { ok: false, message: VIDEO_SIZE_ERROR };
  }
  return { ok: true };
}

export function formatFileSize(bytes) {
  const mb = Number(bytes) / (1024 * 1024);
  if (!Number.isFinite(mb) || mb <= 0) return "";
  return mb >= 1 ? `${mb.toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(mb * 1024))} KB`;
}

/* ---------------- fotografii ----------------
 * Validarea, pregătirea și upload-ul fotografiilor sunt COMUNE tuturor
 * formularelor de produs: src/lib/productImages/ (productImageRules.js,
 * prepareProductImage.js, productImageQueue.js). Aici rămâne doar selecția
 * fotografiilor pentru analiza AI.
 */

// câte fotografii primește analiza AI (getReadyImagesForAi: slice(0, 4))
export const MAX_AI_IMAGES = 4;

/** O imagine e „gata pentru AI” când are URL de server (isUploadedImage). */
export function isUploadedImageUrl(value) {
  const text = String(value || "").trim();
  return /^https?:\/\//i.test(text) || text.startsWith("/");
}

/** Imaginile trimise analizei AI: doar cele încărcate, primele 4, URL absolut. */
export function selectImagesForAi(urls = [], resolveUrl = (value) => value) {
  return (Array.isArray(urls) ? urls : [])
    .filter(isUploadedImageUrl)
    .slice(0, MAX_AI_IMAGES)
    .map(resolveUrl)
    .filter(Boolean);
}
