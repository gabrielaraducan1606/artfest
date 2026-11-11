// src/pages/Vendor/Produse/hooks/customizationUpload.js
//
// Fotografia trimisă de client la personalizarea unui produs
// (POST /api/upload/customization, același endpoint ca până acum).
//
// Limitele de aici oglindesc backend-ul (services/customizationImage.js:
// 10MB, JPG/PNG/WEBP/AVIF verificate după conținut, HEIC refuzat) -
// doar ca să refuzăm înainte de a trimite 10MB pe internet mobil.
// Backend-ul rămâne singura validare care contează.

export const CUSTOMIZATION_UPLOAD_ENDPOINT = "/api/upload/customization";

export const CUSTOMIZATION_MAX_BYTES = 10 * 1024 * 1024;

export const CUSTOMIZATION_ACCEPTED_EXTENSIONS = [
  "jpg",
  "jpeg",
  "jfif",
  "png",
  "webp",
  "avif",
];

export const CUSTOMIZATION_FORMATS_LABEL = "JPG, PNG, WEBP sau AVIF";

/* Același text ca backend-ul (heic_not_supported). */
export const HEIC_NOT_SUPPORTED_MESSAGE =
  "Fotografiile HEIC/HEIF nu pot fi procesate momentan. Salvează fotografia ca JPG sau PNG și încearcă din nou.";

/*
 * Fotografiile mai mari de atât (și pe care browserul le poate decoda)
 * sunt micșorate local înainte de upload. Serverul le aduce oricum la
 * maxim 2400px / JPEG 88 (uploadToR2), deci calitatea finală e aceeași,
 * doar că trimitem mult mai puțini MB.
 */
const DOWNSCALE_MIN_BYTES = 3 * 1024 * 1024;
const DOWNSCALE_MAX_SIDE = 2400;
const DOWNSCALE_QUALITY = 0.9;

/* Fără niciun progres atâta timp -> considerăm conexiunea blocată. */
const STALL_TIMEOUT_MS = 60 * 1000;
const TOTAL_TIMEOUT_MS = 5 * 60 * 1000;

export function getFileExtension(name = "") {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1).replace(/\.0$/, "").replace(".", ",")} MB`;
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export function isHeicFile(file) {
  const ext = getFileExtension(file?.name);
  const type = String(file?.type || "").toLowerCase();

  return (
    ext === "heic" ||
    ext === "heif" ||
    type === "image/heic" ||
    type === "image/heif"
  );
}

/*
 * Verificare rapidă după tip/extensie, doar pentru un mesaj imediat;
 * backend-ul decide după conținutul real (un HEIC redenumit .jpg e
 * refuzat tot acolo, cu același mesaj).
 */
export function validateCustomizationFile(file) {
  if (!file) {
    return "Nu ai ales nicio fotografie.";
  }

  const type = String(file.type || "").toLowerCase();
  const ext = getFileExtension(file.name);

  if (isHeicFile(file)) {
    return HEIC_NOT_SUPPORTED_MESSAGE;
  }

  const looksLikeImage =
    type.startsWith("image/") ||
    CUSTOMIZATION_ACCEPTED_EXTENSIONS.includes(ext);

  if (!looksLikeImage || type === "image/svg+xml" || ext === "svg") {
    return `Fișierul ales nu este o fotografie acceptată. Folosește ${CUSTOMIZATION_FORMATS_LABEL}.`;
  }

  if (!file.size) {
    return "Fișierul ales este gol. Alege altă fotografie.";
  }

  return null;
}

export function sizeLimitMessage(size) {
  return `Fotografia are ${formatBytes(size)}. Limita este ${formatBytes(
    CUSTOMIZATION_MAX_BYTES
  )}.`;
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode_failed"));
    img.src = url;
  });
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob || null), "image/jpeg", quality);
    } catch {
      resolve(null);
    }
  });
}

/*
 * Micșorează local fotografiile mari pe care browserul le poate decoda
 * (JPG/WEBP mereu; PNG doar dacă altfel ar depăși limita, pentru că
 * transparența se pierde la JPEG). Orientarea EXIF e aplicată de browser
 * la desenarea <img> (image-orientation: from-image, implicit în
 * browserele actuale). Orice eșec -> trimitem fișierul original.
 */
export async function prepareCustomizationImage(file) {
  if (!file || typeof document === "undefined") {
    return file;
  }

  const type = String(file.type || "").toLowerCase();
  const isJpegLike = type === "image/jpeg" || type === "image/jpg" || type === "image/webp";
  const isPng = type === "image/png";
  // AVIF e mic ca fișier, dar serverul îl acceptă doar până la 8 MP
  // (decodare costisitoare) -> îl convertim mereu dacă browserul îl poate citi
  const isAvif = type === "image/avif";

  const shouldTry =
    isAvif ||
    (isJpegLike && file.size > DOWNSCALE_MIN_BYTES) ||
    (isPng && file.size > CUSTOMIZATION_MAX_BYTES);

  if (!shouldTry) {
    return file;
  }

  let url = null;

  try {
    url = URL.createObjectURL(file);
    const img = await loadImageElement(url);

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;

    if (!width || !height) {
      return file;
    }

    const scale = Math.min(1, DOWNSCALE_MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return file;
    }

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await canvasToBlob(canvas, DOWNSCALE_QUALITY);

    canvas.width = 0;
    canvas.height = 0;

    if (!blob || (!isAvif && blob.size >= file.size)) {
      return file;
    }

    const baseName = String(file.name || "fotografie").replace(/\.[^.]+$/, "");

    return new File([blob], `${baseName || "fotografie"}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified || Date.now(),
    });
  } catch {
    return file;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function uploadErrorMessage(status, body) {
  if (status === 413) {
    return `Fotografia este prea mare. Limita este ${formatBytes(CUSTOMIZATION_MAX_BYTES)}.`;
  }

  if (status === 429) {
    return "Ai încărcat prea multe fotografii într-un timp scurt. Încearcă din nou peste câteva minute.";
  }

  if (body?.message && status >= 400 && status < 500) {
    return body.message;
  }

  if (status === 503) {
    return "Serverul procesează acum multe fotografii. Încearcă din nou peste câteva secunde.";
  }

  if (status >= 500) {
    return "Serverul nu a putut salva fotografia. Încearcă din nou.";
  }

  return "Nu am putut încărca fotografia. Încearcă din nou.";
}

export class CustomizationUploadError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CustomizationUploadError";
    this.code = code;
  }
}

/*
 * Upload prin XMLHttpRequest (nu fetch) doar pentru progresul real
 * (xhr.upload.onprogress). Întoarce { promise, abort }.
 */
export function uploadCustomizationImage(file, { onProgress } = {}) {
  let xhr = null;
  let stallTimer = null;
  let totalTimer = null;
  let settled = false;
  let abortReason = null;

  const clearTimers = () => {
    clearTimeout(stallTimer);
    clearTimeout(totalTimer);
  };

  const promise = new Promise((resolve, reject) => {
    const fail = (message, code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(new CustomizationUploadError(message, code));
    };

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      fail("Nu ești conectat la internet. Verifică conexiunea și încearcă din nou.", "offline");
      return;
    }

    xhr = new XMLHttpRequest();

    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        abortReason = "stalled";
        xhr.abort();
      }, STALL_TIMEOUT_MS);
    };

    xhr.open("POST", CUSTOMIZATION_UPLOAD_ENDPOINT, true);
    xhr.withCredentials = true;
    xhr.responseType = "text";

    xhr.upload.onprogress = (event) => {
      armStallTimer();

      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };

    xhr.upload.onload = () => {
      onProgress?.(99);
      armStallTimer();
    };

    xhr.onload = () => {
      if (settled) return;

      const body = parseJson(xhr.responseText);

      if (xhr.status >= 200 && xhr.status < 300 && body?.url) {
        settled = true;
        clearTimers();
        onProgress?.(100);
        resolve({
          url: body.url,
          name: body.name || file.name,
          size: body.size || file.size,
          mimeType: body.mimeType || file.type,
        });
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        fail("Serverul nu a returnat fotografia. Încearcă din nou.", "no_url");
        return;
      }

      fail(uploadErrorMessage(xhr.status, body), body?.error || `http_${xhr.status}`);
    };

    xhr.onerror = () => {
      fail("Conexiunea s-a întrerupt în timpul încărcării. Încearcă din nou.", "network");
    };

    xhr.onabort = () => {
      if (abortReason === "stalled") {
        fail("Încărcarea durează prea mult (conexiune lentă sau întreruptă). Încearcă din nou.", "timeout");
        return;
      }

      fail("Încărcarea a fost anulată.", "aborted");
    };

    const form = new FormData();
    form.append("file", file, file.name);

    armStallTimer();
    totalTimer = setTimeout(() => {
      abortReason = "stalled";
      xhr.abort();
    }, TOTAL_TIMEOUT_MS);

    xhr.send(form);
  });

  return {
    promise,
    abort: () => {
      if (!settled && xhr) {
        abortReason = "user";
        xhr.abort();
      }
    },
  };
}
