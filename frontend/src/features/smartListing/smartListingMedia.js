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

/* ---------------- fotografii (aceleași reguli ca editorul actual) ----------------
 * Sursa: modals/useProductEditorController.js (onFilesPicked,
 * compressImageBeforeUpload, getReadyImagesForAi) - copiate fără modificări
 * de comportament, ca editorul existent să rămână neatins.
 */

export const MAX_PHOTOS = 12;
export const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
// câte fotografii primește analiza AI (getReadyImagesForAi: slice(0, 4))
export const MAX_AI_IMAGES = 4;

const IMAGE_EXT_RE = /\.(jpe?g|jfif|png|webp|gif|heic|heif|bmp|tiff?|avif)$/i;

export const IMAGE_TYPE_ERROR = (name) =>
  `Fișier ignorat: ${name}. Acceptăm JPG, PNG, WEBP, GIF, HEIC, HEIF, BMP, TIFF sau AVIF.`;
export const IMAGE_SIZE_ERROR = (name) => `Fișierul ${name} este prea mare. Maxim 100MB.`;

/** Același test ca onFilesPicked (inclusiv fotografiile de pe telefon fără tip MIME). */
export function checkImageFile(file) {
  const name = file?.name || "imagine";
  const type = String(file?.type || "").toLowerCase();
  const isImage = /^image\//i.test(type) || type === "application/octet-stream" || IMAGE_EXT_RE.test(name);
  if (!isImage) return { ok: false, message: IMAGE_TYPE_ERROR(name) };
  if (Number(file?.size) > MAX_IMAGE_BYTES) return { ok: false, message: IMAGE_SIZE_ERROR(name) };
  return { ok: true };
}

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

/**
 * Comprimare înainte de upload - identică cu compressImageBeforeUpload din
 * editorul actual (max 1800 px, JPEG 0,82; GIF/HEIC/HEIF/AVIF/TIFF/BMP
 * rămân originale; dacă nu câștigă >5% sau eșuează, se trimite originalul).
 * Doar în browser.
 */
export async function compressImageForUpload(file) {
  try {
    const fileType = String(file.type || "").toLowerCase();
    const fileName = String(file.name || "").toLowerCase();

    if (!/^image\//i.test(fileType)) return file;
    if (
      /image\/gif/i.test(fileType) ||
      /heic|heif|avif|tiff|bmp/i.test(fileType) ||
      /\.(heic|heif|avif|tiff?|bmp|gif)$/i.test(fileName)
    ) {
      return file;
    }

    const imageUrl = URL.createObjectURL(file);
    try {
      const image = await Promise.race([
        new Promise((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve(element);
          element.onerror = reject;
          element.src = imageUrl;
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("IMAGE_COMPRESSION_TIMEOUT")), 4000)),
      ]);

      const maxSize = 1800;
      const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * ratio);
      canvas.height = Math.round(image.height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return file;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const blob = await Promise.race([
        new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("CANVAS_COMPRESSION_TIMEOUT")), 4000)),
      ]);

      if (!blob || blob.size >= file.size * 0.95) return file;
      return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "imagine"}.jpg`, { type: "image/jpeg" });
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  } catch {
    return file;
  }
}
