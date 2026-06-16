// src/api/upload.js
import { Router } from "express";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { authRequired } from "../api/auth.js";

const router = Router();

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
} = process.env;

if (
  !R2_ACCOUNT_ID ||
  !R2_ACCESS_KEY_ID ||
  !R2_SECRET_ACCESS_KEY ||
  !R2_BUCKET_NAME
) {
  console.warn(
    "[R2] Env incomplet. Verifică R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME."
  );
}

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

const ALLOWED_IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
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

  return (
    String(file.mimetype || "").startsWith("image/") ||
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
  if (!ALLOWED_SUPPORT_MIME_TYPES.includes(file.mimetype)) {
    console.warn("[UPLOAD] Format atașament respins:", {
      mimetype: file.mimetype,
      originalname: file.originalname,
    });

    return cb(new Error("INVALID_SUPPORT_FILE_TYPE"));
  }

  cb(null, true);
}

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const uploadProductImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

const uploadSupport = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: supportFileFilter,
});

function buildPublicUrl(key) {
  if (R2_PUBLIC_BASE_URL) {
    return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key}`;
  }

  return `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
}

function getUserId(req) {
  return req.user?.sub || req.user?.id;
}

function sanitizeFileName(name = "file") {
  const safe = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safe || "file";
}

function handleUploadError(err, res, context = "upload") {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: "file_too_large",
      message:
        context === "support"
          ? "Fișierul este prea mare (max 10MB)."
          : context === "products"
         ? "Imaginea este prea mare (max 50MB)."
          : "Fișierul este prea mare (max 5MB).",
    });
  }

  if (err?.message === "INVALID_IMAGE_TYPE") {
    return res.status(415).json({
      error: "invalid_file_type",
      message:
      "Format invalid. Acceptăm JPG, JPEG, PNG, WEBP, GIF, HEIC, HEIF, BMP, TIFF și AVIF.",
    });
  }

  if (err?.message === "INVALID_SUPPORT_FILE_TYPE") {
    return res.status(415).json({
      error: "invalid_file_type",
      message:
        "Format invalid. Acceptăm imagini JPG, PNG, WEBP, GIF, HEIC, HEIF, PDF, TXT, DOC sau DOCX.",
    });
  }

  console.error(`Upload error (${context}):`, err);

  return res.status(500).json({
    error: "upload_failed",
    message: "Upload eșuat. Încearcă din nou.",
  });
}

async function uploadToR2({ file, folder, userId, index = null }) {
  const originalMime = file.mimetype || "application/octet-stream";
  const originalName = file.originalname || "file";

  let body = file.buffer;
  let mime = originalMime;

  let safeOriginalName = sanitizeFileName(
    originalName.replace(/\.[^.]+$/, ".jpg")
  );

  try {
    body = await sharp(file.buffer, {
      failOn: "none",
      animated: false,
      limitInputPixels: false,
    })
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 88,
        mozjpeg: true,
      })
      .toBuffer();

    mime = "image/jpeg";
    } catch (err) {
    console.error("Sharp convert failed, uploading original file:", err);

    body = file.buffer;
    mime = originalMime;
    safeOriginalName = sanitizeFileName(originalName);
  }

  const timestamp = Date.now();
  const indexPart =
    index === null || index === undefined ? "" : `${index}-`;

  const key = `${folder}/${userId}/${timestamp}-${indexPart}${safeOriginalName}`;

  const putCommand = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: body,
    ContentType: mime,
    CacheControl: "public, max-age=31536000, immutable",
  });

  console.info("[UPLOAD] Start R2 upload:", {
    folder,
    userId,
    key,
    originalMime,
    finalMime: mime,
    originalSize: file.size,
    finalSize: body.length,
    originalname: file.originalname,
    convertedToJpeg: mime === "image/jpeg",
  });

  await r2Client.send(putCommand);

  console.info("[UPLOAD] R2 upload success:", {
    folder,
    userId,
    key,
  });

  return {
    url: buildPublicUrl(key),
    key,
    name: safeOriginalName,
    size: body.length,
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
router.post("/products", authRequired, (req, res) => {
  uploadProductImages.fields([
    { name: "file", maxCount: 1 },
    { name: "files", maxCount: 12 },
  ])(req, res, async (err) => {
    if (err) return handleUploadError(err, res, "products");

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

      const uploaded = [];

      for (let i = 0; i < files.length; i += 1) {
        const item = await uploadToR2({
          file: files[i],
          folder: "products",
          userId,
          index: i,
        });

        uploaded.push(item);
      }

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
    }
  });
});

/**
 * POST /api/upload/support
 * Pentru atașamente support
 * FormData: files=<binary[]>
 */
router.post("/support", authRequired, (req, res) => {
  uploadSupport.array("files", 10)(req, res, async (err) => {
    if (err) return handleUploadError(err, res, "support");

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

      const uploaded = [];

      for (let i = 0; i < files.length; i += 1) {
        const item = await uploadToR2({
          file: files[i],
          folder: "support",
          userId,
          index: i,
        });

        uploaded.push(item);
      }

      return res.json({
        ok: true,
        items: uploaded,
      });
    } catch (err) {
      return handleUploadError(err, res, "support");
    }
  });
});

export default router;