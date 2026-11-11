// backend/src/services/messageAttachmentImage.js
//
// Atașamentele din Mesaje (client <-> vânzător) sunt doar imagini - așa le
// acceptă deja moderarea (moderateMarketplaceImage). Aici ne asigurăm că
// ce ajunge pe R2 și la moderare e cu adevărat o imagine: verificată după
// conținut (nu după MIME-ul / extensia trimise de browser), re-encodată
// JPEG, fără EXIF/GPS. GIF-ul animat păstrează doar primul cadru - exact
// cadrul pe care îl vede moderarea.

import {
  CustomizationImageError,
  processSafeImage,
} from "./customizationImage.js";
import {
  createByteBudget,
  envMegabytes,
} from "../middleware/uploadLoadGuards.js";

/* aceeași limită ca multer în rutele de mesaje */
export const MESSAGE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/*
 * Atașamentele rămân în memorie (moderarea are nevoie de buffer), deci
 * limităm câți octeți pot fi primiți simultan pe instanță - comun pentru
 * client și vânzător. Decodarea e deja la rând (coada din customizationImage).
 */
const messageUploadBudget = createByteBudget({
  name: "messages",
  budgetBytes: envMegabytes("MESSAGE_UPLOAD_MEMORY_BUDGET_MB", 300),
});

export const messageUploadReservedBytes = () => messageUploadBudget.reserved();

export const messageUploadGuard = messageUploadBudget.guard({
  maxRequestBytes: 10 * MESSAGE_ATTACHMENT_MAX_BYTES + 1024 * 1024,
});

/* singurele tipuri pe care proxy-ul de previzualizare le afișează inline */
const INLINE_SAFE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * @param {Array<{buffer: Buffer, originalname?: string}>} files (multer)
 * @returns {Promise<Array<{buffer: Buffer, filename: string, mime: string, size: number}>>}
 */
export async function prepareMessageAttachments(files) {
  const prepared = [];

  for (const file of files || []) {
    const image = await processSafeImage(file?.buffer, {
      maxBytes: MESSAGE_ATTACHMENT_MAX_BYTES,
      allowGif: true,
    });

    const base = String(file?.originalname || "imagine").replace(/\.[^.]*$/, "") || "imagine";

    prepared.push({
      buffer: image.buffer,
      filename: `${base}.jpg`,
      mime: "image/jpeg",
      size: image.buffer.length,
    });
  }

  return prepared;
}

/**
 * Răspunsul HTTP pentru o imagine respinsă, în forma deja folosită de
 * rutele de mesaje (attachment_blocked / 503). null = altă eroare.
 */
export function messageAttachmentErrorResponse(error) {
  if (!(error instanceof CustomizationImageError)) return null;

  if (error.status === 503) {
    return {
      status: 503,
      retryAfterSeconds: error.retryAfterSeconds || 5,
      body: { error: "server_busy", reason: error.code, message: error.message },
    };
  }

  return {
    status: error.status === 413 ? 413 : 422,
    body: {
      error: "attachment_blocked",
      reason: error.code,
      detections: [],
      message:
        error.code === "invalid_image"
          ? "Fișierul nu este o imagine acceptată. Încarcă o imagine JPG, PNG, WEBP sau GIF."
          : error.message,
    },
  };
}

/**
 * Antetele pentru proxy-ul /attachments/:id/download. Proxy-ul rulează pe
 * domeniul aplicației, deci un atașament vechi (dinaintea moderării) cu
 * MIME text/html sau SVG nu are voie să fie randat inline acolo.
 */
export function attachmentProxyHeaders({ mime, filename, forceDownload }) {
  const type = String(mime || "").split(";")[0].trim().toLowerCase();
  const inline = !forceDownload && INLINE_SAFE_MIME_TYPES.has(type);

  return {
    "Content-Type": inline ? type : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename || "atasament")}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
}
