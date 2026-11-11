// src/api/upload.js
import { Router } from "express";
import multer from "multer";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
  authRequired,
  enforceTokenVersion,
  optionalAuth,
  requireRole,
} from "../api/auth.js";
import { prisma } from "../db.js";
import { stripVideoAudio } from "../lib/videoAudio.js";
import {
  CUSTOMIZATION_MAX_BYTES,
  CustomizationImageError,
  newGuestUploaderId,
  uploadCustomizationImage,
} from "../services/customizationImage.js";
import {
  createCustomizationUploadLimiters,
  createInflightGuard,
} from "../middleware/customizationUploadRateLimit.js";
import {
  UPLOAD_TMP_DIR,
  UploadBusyError,
  claimTempFiles,
  createByteBudget,
  createFreeSpaceProbe,
  createProcessingLimiter,
  envInteger,
  envMegabytes,
  removeTempFiles,
  sendUploadBusy,
  tempDiskStorage,
  withBufferedFile,
} from "../middleware/uploadLoadGuards.js";
import {
  r2Client,
  buildPublicUrl,
  sanitizeFileName,
  uploadToR2,
  detectRealFileKind,
  getFileExtension as getRealFileExtension,
} from "../services/r2Storage.js";

const router = Router();

const {
  R2_ACCOUNT_ID,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
} = process.env;

const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/bmp",
  "image/tiff",
  "image/avif",
  "application/octet-stream",
];

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jfif",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
  "bmp",
  "tif",
  "tiff",
  "avif",
]);

const ALLOWED_SUPPORT_MIME_TYPES = [
  ...ALLOWED_IMAGE_MIME_TYPES,
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function getFileExtension(name = "") {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function isAllowedImageFile(file) {
  const ext = getFileExtension(file.originalname || "");
  const mime = String(file.mimetype || "").toLowerCase();

  return (
    mime.startsWith("image/") ||
    ALLOWED_IMAGE_MIME_TYPES.includes(mime) ||
    ALLOWED_IMAGE_EXTENSIONS.has(ext)
  );
}

function imageFileFilter(req, file, cb) {
  if (!isAllowedImageFile(file)) {
    console.warn("[UPLOAD] Format imagine respins:", {
      mimetype: file.mimetype,
      originalname: file.originalname,
      extension: getFileExtension(file.originalname || ""),
    });

    return cb(new Error("INVALID_IMAGE_TYPE"));
  }

  cb(null, true);
}

function supportFileFilter(req, file, cb) {
  const mime = String(file.mimetype || "").toLowerCase();
  const ext = getFileExtension(file.originalname || "");

  const isAllowedSupport =
    ALLOWED_SUPPORT_MIME_TYPES.includes(mime) ||
    ALLOWED_IMAGE_EXTENSIONS.has(ext);

  if (!isAllowedSupport) {
    console.warn("[UPLOAD] Format atașament respins:", {
      mimetype: file.mimetype,
      originalname: file.originalname,
      extension: ext,
    });

    return cb(new Error("INVALID_SUPPORT_FILE_TYPE"));
  }

  cb(null, true);
}

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

/*
 * /products și /support: fișierele merg pe disc (nu în RAM) și sunt citite
 * câte unul, abia când le vine rândul la procesare - vezi
 * middleware/uploadLoadGuards.js. Limitele per fișier rămân aceleași.
 */
const uploadProductImages = multer({
  storage: tempDiskStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const uploadSupport = multer({
  storage: tempDiskStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: supportFileFilter,
});

const ALLOWED_VIDEO_MIME_TYPES = ["video/mp4", "video/webm"];

function videoFileFilter(req, file, cb) {
  const mime = String(file.mimetype || "").toLowerCase();

  if (!ALLOWED_VIDEO_MIME_TYPES.includes(mime)) {
    console.warn("[UPLOAD] Format video respins:", {
      mimetype: file.mimetype,
      originalname: file.originalname,
    });

    return cb(new Error("INVALID_VIDEO_TYPE"));
  }

  cb(null, true);
}

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: videoFileFilter,
});

/*
 * Limite de pixeli verificate din header înainte de decodare (protecție
 * la imagini-bombă). Formatele decodate integral primesc automat mai
 * puțin - vezi pixelLimitForHeader în r2Storage.js.
 */
const IMAGE_MAX_PIXELS = 60_000_000;
const PRODUCT_IMAGE_MAX_PIXELS = 100_000_000;

const MB = 1024 * 1024;
const PRODUCT_MAX_REQUEST_BYTES = 12 * 100 * MB + MB; // 12 fișiere x 100 MB + câmpuri
const SUPPORT_MAX_REQUEST_BYTES = 10 * 20 * MB + MB; // 10 fișiere x 20 MB + câmpuri

/*
 * Câte cereri /products + /support se procesează simultan pe instanță
 * (citire de pe disc + decodare). Frontendul trimite o fotografie pe
 * cerere, deci încărcarea multiplă doar așteaptă la rând câteva secunde.
 */
const heavyUploadProcessing = createProcessingLimiter({
  concurrency: envInteger("UPLOAD_PROCESSING_CONCURRENCY", 1, 1),
  maxQueue: envInteger("UPLOAD_PROCESSING_MAX_QUEUE", 10, 0),
  // peste termen procesarea e anulată (inclusiv apelul R2) -> 503
  holdTimeoutMs: envInteger("UPLOAD_PROCESSING_HOLD_TIMEOUT_MS", 2 * 60 * 1000, 1),
});

/*
 * Spațiu pe disc pentru fișierele temporare aflate în lucru: plafonul fix
 * (UPLOAD_DISK_BUDGET_MB) dar niciodată mai mult decât spațiul liber real
 * minus o rezervă (UPLOAD_DISK_FREE_MARGIN_MB) - nu presupunem cât disc are
 * instanța (Render: sistem de fișiere efemer, mărime nedocumentată aici).
 */
const uploadDiskBudget = createByteBudget({
  name: "disk",
  budgetBytes: envMegabytes("UPLOAD_DISK_BUDGET_MB", 1536),
  freeBytes: createFreeSpaceProbe({ dir: UPLOAD_TMP_DIR }),
  freeMarginBytes: envMegabytes("UPLOAD_DISK_FREE_MARGIN_MB", 512),
});

/* starea protecțiilor (diagnostic / teste) */
export function uploadLoadStats() {
  return {
    processing: heavyUploadProcessing.stats(),
    diskReservedBytes: uploadDiskBudget.reserved(),
  };
}

function getUserId(req) {
  return req.user?.sub || req.user?.id;
}

function handleUploadError(err, res, context = "upload") {
  if (err instanceof UploadBusyError) {
    return sendUploadBusy(res, err.retryAfterSeconds);
  }

  // disc plin în timpul scrierii fișierului temporar - temporar, nu eroare de server
  if (err?.code === "ENOSPC") {
    console.error(`[UPLOAD] ${context}: disc plin (ENOSPC)`);
    return sendUploadBusy(res);
  }

  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "file_too_large",
      message:
        context === "support"
          ? "Fișierul este prea mare (max 20MB)."
          : context === "products"
          ? "Imaginea este prea mare (max 100MB)."
          : context === "video"
          ? "Videoul este prea mare (max 50MB)."
          : "Fișierul este prea mare (max 10MB).",
    });
  }

  if (err?.message === "INVALID_IMAGE_TYPE") {
    return res.status(415).json({
      error: "invalid_file_type",
      message:
        "Format invalid. Acceptăm JPG, JPEG, JFIF, PNG, WEBP, GIF, HEIC, HEIF, BMP, TIFF și AVIF.",
    });
  }

  if (err?.message === "INVALID_SUPPORT_FILE_TYPE") {
    return res.status(415).json({
      error: "invalid_file_type",
      message:
        "Format invalid. Acceptăm imagini JPG, PNG, WEBP, GIF, HEIC, HEIF, PDF, TXT, DOC sau DOCX.",
    });
  }

  if (err?.message === "INVALID_VIDEO_TYPE") {
    return res.status(415).json({
      error: "invalid_file_type",
      message: "Format invalid. Acceptăm doar video MP4 sau WebM.",
    });
  }

  if (err?.code === "upload_content_mismatch") {
    return res.status(415).json({
      error: "upload_content_mismatch",
      message:
        "Fișierul nu corespunde tipului declarat (extensie/format). Încearcă alt fișier.",
    });
  }

  if (err?.code === "image_too_many_pixels") {
    const mp = err.maxPixels ? Math.round(err.maxPixels / 1_000_000) : null;

    return res.status(422).json({
      error: "image_too_many_pixels",
      message: mp
        ? `Imaginea are o rezoluție prea mare (maxim ${mp} MP pentru acest format). Micșorează-o și încearcă din nou.`
        : "Imaginea are o rezoluție prea mare. Micșorează-o și încearcă din nou.",
    });
  }

  console.error(`Upload error (${context}):`, err);

  return res.status(500).json({
    error: "upload_failed",
    message:
      context === "products"
        ? "Nu am putut încărca imaginea. Încearcă din nou sau folosește o poză JPG/PNG."
        : "Upload eșuat. Încearcă din nou.",
  });
}

/**
 * Upload video direct pe R2, FĂRĂ sharp (sharp nu procesează video).
 * Reutilizează r2Client / buildPublicUrl / sanitizeFileName, la fel
 * ca uploadToR2, dar fără nicio conversie a conținutului.
 */
async function uploadVideoToR2({
  buffer,
  mimeType,
  originalname,
  folder,
  userId,
}) {
  /*
   * NU avem încredere doar în mimeType (declarat de client la primul
   * upload) - verificăm semnătura reală a containerului video înainte
   * de a-l trimite pe R2 cu acel Content-Type.
   */
  const detected = detectRealFileKind(buffer);
  const declaredExt = getRealFileExtension(originalname || "");
  const isRecognizedVideo =
    detected &&
    (detected.kind === "mp4" || detected.kind === "webm") &&
    detected.exts.includes(declaredExt);

  if (!isRecognizedVideo) {
    console.warn("[UPLOAD] Video rejected - content does not match a recognized video container:", {
      originalname,
      mimeType,
      declaredExt,
      detectedKind: detected?.kind || null,
    });

    const rejectionError = new Error("UPLOAD_CONTENT_MISMATCH");
    rejectionError.code = "upload_content_mismatch";
    throw rejectionError;
  }

  const mime = detected.mime;
  const safeOriginalName = sanitizeFileName(originalname || "video");

  const timestamp = Date.now();
  const key = `${folder}/${userId}/${timestamp}-${safeOriginalName}`;

  const putCommand = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: mime,
    CacheControl: "public, max-age=31536000, immutable",
  });

  console.info("[UPLOAD] Start R2 video upload:", {
    folder,
    userId,
    key,
    mime,
    size: buffer.length,
    originalname,
  });

  await r2Client.send(putCommand);

  console.info("[UPLOAD] R2 video upload success:", {
    folder,
    userId,
    key,
  });

  return {
    url: buildPublicUrl(key),
    key,
    name: safeOriginalName,
    size: buffer.length,
    mimeType: mime,
  };
}

/**
 * POST /api/upload
 * Pentru avatar / imagine simplă
 * FormData: file=<binary>
 */
router.post("/", authRequired, (req, res) => {
  uploadImage.single("file")(req, res, async (err) => {
    if (err) return handleUploadError(err, res, "avatar");

    try {
      const userId = getUserId(req);

      if (!userId) {
        return res.status(403).json({
          error: "unauthorized",
          message: "Trebuie să fii autentificat pentru upload.",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "no_file",
          message: "Nu ai trimis niciun fișier.",
        });
      }

      const uploaded = await uploadToR2({
        file: req.file,
        folder: "avatars",
        userId,
        policy: "image",
        maxPixels: IMAGE_MAX_PIXELS,
      });

      return res.json({
        ok: true,
        url: uploaded.url,
        key: uploaded.key,
        name: uploaded.name,
        size: uploaded.size,
        mimeType: uploaded.mimeType,
      });
    } catch (err) {
      return handleUploadError(err, res, "avatar");
    }
  });
});

/**
 * POST /api/upload/products
 * Pentru imagini produse
 * FormData:
 * - file=<binary> sau
 * - files=<binary[]>
 */
router.post(
  "/products",
  authRequired,
  enforceTokenVersion,
  requireRole("VENDOR", "ADMIN"),
  uploadDiskBudget.guard({ maxRequestBytes: PRODUCT_MAX_REQUEST_BYTES }),
  (req, res) => {
  uploadProductImages.fields([
    { name: "file", maxCount: 1 },
    { name: "files", maxCount: 12 },
  ])(req, res, async (err) => {
    claimTempFiles(req); // de aici fișierele sunt ale rutei (șterse în finally)

    if (err) {
      await removeTempFiles(req.files);
      return handleUploadError(err, res, "products");
    }

    try {
      const userId = getUserId(req);

      if (!userId) {
        return res.status(403).json({
          error: "unauthorized",
          message: "Trebuie să fii autentificat pentru upload.",
        });
      }

      const singleFile = req.files?.file?.[0] || null;
      const multipleFiles = Array.isArray(req.files?.files)
        ? req.files.files
        : [];

      const files = singleFile ? [singleFile, ...multipleFiles] : multipleFiles;

      if (!files.length) {
        return res.status(400).json({
          error: "no_file",
          message: "Nu ai trimis niciun fișier.",
        });
      }

      // un singur loc de procesare pentru toată cererea: fișierele sunt
      // citite de pe disc pe rând, deci în memorie e cel mult unul
      const uploaded = await heavyUploadProcessing(async (signal) => {
        const items = [];

        for (let i = 0; i < files.length; i += 1) {
          signal.throwIfAborted(); // anulat peste termen -> nu mai citim fișierul următor
          items.push(
            await withBufferedFile(files[i], (file) =>
              uploadToR2({
                file,
                folder: "products",
                userId,
                index: i,
                policy: "image",
                maxPixels: PRODUCT_IMAGE_MAX_PIXELS,
                abortSignal: signal,
              })
            )
          );
        }

        return items;
      });

      return res.json({
        ok: true,

        url: uploaded[0]?.url || null,
        key: uploaded[0]?.key || null,
        name: uploaded[0]?.name || null,
        size: uploaded[0]?.size || null,
        mimeType: uploaded[0]?.mimeType || null,

        items: uploaded,
        urls: uploaded.map((x) => x.url),
      });
    } catch (err) {
      return handleUploadError(err, res, "products");
    } finally {
      await removeTempFiles(req.files);
    }
  });
  }
);

/**
 * POST /api/upload/products/video
 * Video de produs - maxim 1 per produs (impus de câmpul unic
 * Product.videoUrl, nu de acest endpoint - fiecare upload nou
 * înlocuiește pur și simplu URL-ul salvat pe produs).
 * FormData: file=<binary>
 */
router.post(
  "/products/video",
  authRequired,
  enforceTokenVersion,
  requireRole("VENDOR", "ADMIN"),
  (req, res) => {
    uploadVideo.single("file")(req, res, async (err) => {
      if (err) return handleUploadError(err, res, "video");

      try {
        const userId = getUserId(req);

        if (!userId) {
          return res.status(403).json({
            error: "unauthorized",
            message: "Trebuie să fii autentificat pentru upload.",
          });
        }

        if (!req.file) {
          return res.status(400).json({
            error: "no_file",
            message: "Nu ai trimis niciun fișier.",
          });
        }

        const wantsMuted = String(req.body?.muted || "") === "true";

        let buffer = req.file.buffer;
        let muted = false;

        if (wantsMuted) {
          try {
            buffer = await stripVideoAudio(buffer, req.file.mimetype);
            muted = true;
          } catch (stripErr) {
            console.error("[UPLOAD] Audio strip failed:", stripErr);
            return res.status(500).json({
              error: "audio_strip_failed",
              message:
                "Nu am putut elimina sunetul din acest video. Încearcă alt fișier.",
            });
          }
        }

        const uploaded = await uploadVideoToR2({
          buffer,
          mimeType: req.file.mimetype,
          originalname: req.file.originalname,
          folder: "products-video",
          userId,
        });

        return res.json({
          ok: true,
          url: uploaded.url,
          key: uploaded.key,
          name: uploaded.name,
          size: uploaded.size,
          mimeType: uploaded.mimeType,
          videoMuted: muted,
        });
      } catch (err) {
        return handleUploadError(err, res, "video");
      }
    });
  }
);

function keyFromPublicUrl(url) {
  const base = R2_PUBLIC_BASE_URL
    ? R2_PUBLIC_BASE_URL.replace(/\/+$/, "")
    : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  if (!url.startsWith(`${base}/`)) return null;

  return url.slice(base.length + 1);
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * POST /api/upload/products/video/mute
 * Reprocesează un video DEJA urcat: elimină fizic pista audio,
 * urcă rezultatul ca obiect nou pe R2, șterge originalul (cu
 * sunet) ca să nu rămână accesibil pe vechiul URL. Se folosește
 * când vendorul activează "Fără sunet" pe un video existent, fără
 * să-l reîncarce.
 * Body JSON: { videoUrl: string }
 */
router.post(
  "/products/video/mute",
  authRequired,
  enforceTokenVersion,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    try {
      const userId = getUserId(req);
      const videoUrl = String(req.body?.videoUrl || "").trim();

      if (!videoUrl) {
        return res.status(400).json({
          error: "video_url_required",
          message: "Lipsește URL-ul videoului.",
        });
      }

      const key = keyFromPublicUrl(videoUrl);

      if (!key || !key.startsWith("products-video/")) {
        return res.status(400).json({
          error: "invalid_video_url",
          message: "URL de video invalid.",
        });
      }

      // Vendorii pot reprocesa doar propriile videouri (cheia
      // conține userId-ul de la upload-ul inițial). Adminii pot
      // reprocesa orice video.
      if (
        req.user?.role !== "ADMIN" &&
        !key.startsWith(`products-video/${userId}/`)
      ) {
        return res.status(403).json({
          error: "forbidden",
          message: "Nu ai acces la acest video.",
        });
      }

      let getResult;
      try {
        getResult = await r2Client.send(
          new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
        );
      } catch (getErr) {
        if (getErr?.name === "NoSuchKey" || getErr?.Code === "NoSuchKey") {
          // Cel mai probabil videoul a fost deja procesat (ex. dublu
          // request) - nu e o eroare de server reală.
          return res.status(404).json({
            error: "video_not_found",
            message:
              "Acest video a fost deja procesat sau nu mai există. Reîncarcă pagina.",
          });
        }
        throw getErr;
      }

      const originalBuffer = await streamToBuffer(getResult.Body);
      const mimeType = getResult.ContentType || "video/mp4";

      let stripped;
      try {
        stripped = await stripVideoAudio(originalBuffer, mimeType);
      } catch (stripErr) {
        console.error("[UPLOAD] Audio strip (reprocess) failed:", stripErr);
        return res.status(500).json({
          error: "audio_strip_failed",
          message:
            "Nu am putut elimina sunetul din acest video. Încearcă să încarci din nou fișierul.",
        });
      }

      const originalName = key.split("/").pop() || "video";

      const uploaded = await uploadVideoToR2({
        buffer: stripped,
        mimeType,
        originalname: originalName,
        folder: "products-video",
        userId: key.split("/")[1] || userId,
      });

      await r2Client
        .send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }))
        .catch((delErr) => {
          console.error("[UPLOAD] Failed to delete original video:", delErr);
        });

      return res.json({ ok: true, url: uploaded.url });
    } catch (err) {
      console.error("[UPLOAD] /products/video/mute error:", err);
      return res.status(500).json({
        error: "server_error",
        message: "Nu am putut procesa videoul. Încearcă din nou.",
      });
    }
  }
);

/**
 * POST /api/upload/support
 * Pentru atașamente support
 * FormData: files=<binary[]>
 */
router.post(
  "/support",
  authRequired,
  uploadDiskBudget.guard({ maxRequestBytes: SUPPORT_MAX_REQUEST_BYTES }),
  (req, res) => {
  uploadSupport.array("files", 10)(req, res, async (err) => {
    claimTempFiles(req); // de aici fișierele sunt ale rutei (șterse în finally)

    if (err) {
      await removeTempFiles(req.files);
      return handleUploadError(err, res, "support");
    }

    try {
      const userId = getUserId(req);

      if (!userId) {
        return res.status(403).json({
          error: "unauthorized",
          message: "Trebuie să fii autentificat pentru upload.",
        });
      }

      const files = req.files || [];

      if (!files.length) {
        return res.status(400).json({
          error: "no_file",
          message: "Nu ai trimis niciun fișier.",
        });
      }

      const uploaded = await heavyUploadProcessing(async (signal) => {
        const items = [];

        for (let i = 0; i < files.length; i += 1) {
          signal.throwIfAborted(); // anulat peste termen -> nu mai citim fișierul următor
          items.push(
            await withBufferedFile(files[i], (file) =>
              uploadToR2({
                file,
                folder: "support",
                userId,
                index: i,
                policy: "document",
                maxPixels: IMAGE_MAX_PIXELS,
                abortSignal: signal,
              })
            )
          );
        }

        return items;
      });

      return res.json({
        ok: true,
        items: uploaded,
      });
    } catch (err) {
      return handleUploadError(err, res, "support");
    } finally {
      await removeTempFiles(req.files);
    }
  });
  }
);

/**
 * POST /api/upload/customization
 * Pentru poze trimise de client
 * la personalizarea unui produs.
 *
 * Merge atât pentru utilizatori autentificați,
 * cât și pentru guest.
 *
 * Acceptă EXCLUSIV imagini decodabile (JPG, PNG, WEBP, AVIF), verificate
 * după conținut - vezi services/customizationImage.js. Fără fallback la
 * fișierul brut. Limitare: middleware/customizationUploadRateLimit.js.
 *
 * FormData:
 * file=<binary>
 */
const uploadCustomization = multer({
  storage: multer.memoryStorage(),
  // fără fileFilter: MIME-ul / extensia declarate nu decid nimic,
  // conținutul e verificat în processCustomizationImage
  limits: {
    fileSize: CUSTOMIZATION_MAX_BYTES,
    files: 1,
    fields: 10,
    parts: 12,
  },
});

/*
 * Identifică utilizatorul autentificat (dacă există). Un token invalid,
 * expirat sau revocat (tokenVersion schimbat) NU blochează upload-ul -
 * requestul continuă ca guest, la fel ca un vizitator fără cont.
 */
async function identifyCustomizationUploader(req, _res, next) {
  req.uploader = { userId: null };

  const userId = getUserId(req);

  if (!userId) return next();

  if (typeof req.user?.tv === "undefined") {
    req.uploader.userId = String(userId);
    return next();
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: String(userId) },
      select: { tokenVersion: true },
    });

    if (user && user.tokenVersion === req.user.tv) {
      req.uploader.userId = String(userId);
    }
  } catch (err) {
    console.warn("[UPLOAD] customization: token check failed, continuing as guest:", err?.message || err);
  }

  return next();
}

function sendCustomizationError(res, err) {
  if (err instanceof CustomizationImageError) {
    if (err.retryAfterSeconds) res.setHeader("Retry-After", String(err.retryAfterSeconds));
    return res.status(err.status).json({ error: err.code, message: err.message });
  }

  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "file_too_large",
      message: "Fișierul este prea mare (max 10MB).",
    });
  }

  if (
    err?.code === "LIMIT_FILE_COUNT" ||
    err?.code === "LIMIT_UNEXPECTED_FILE" ||
    err?.code === "LIMIT_PART_COUNT" ||
    err?.code === "LIMIT_FIELD_COUNT"
  ) {
    return res.status(400).json({
      error: "invalid_upload",
      message: "Trimite o singură fotografie.",
    });
  }

  return handleUploadError(err, res, "customization");
}

router.post(
  "/customization",
  optionalAuth,
  identifyCustomizationUploader,
  ...createCustomizationUploadLimiters(),
  createInflightGuard(),
  (req, res) => {
    uploadCustomization.single("file")(req, res, async (err) => {
      if (err) return sendCustomizationError(res, err);

      try {
        if (!req.file) {
          return res.status(400).json({
            error: "no_file",
            message: "Nu ai trimis nicio imagine.",
          });
        }

        const authenticatedUserId = req.uploader?.userId || null;

        const uploaded = await uploadCustomizationImage({
          buffer: req.file.buffer,
          originalname: req.file.originalname,
          ownerId: authenticatedUserId || newGuestUploaderId(),
        });

        return res.json({
          ok: true,
          url: uploaded.url,
          key: uploaded.key,
          name: uploaded.name,
          size: uploaded.size,
          mimeType: uploaded.mimeType,
          guest: !authenticatedUserId,
        });
      } catch (err) {
        return sendCustomizationError(res, err);
      }
    });
  }
);

export default router;
