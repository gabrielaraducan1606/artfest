import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authRequired } from "../api/auth.js";

const router = Router();

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
} = process.env;

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(new Error("INVALID_FILE_TYPE"));
    }
    cb(null, true);
  },
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

function safeFileName(name = "file") {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]+/g, "-")
    .slice(0, 120);
}

function safeFolder(folder = "uploads") {
  const clean = String(folder)
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, "")
    .replace(/^\/+|\/+$/g, "");

  return clean || "uploads";
}

/* ================= DIRECT R2 UPLOAD - PRESIGNED URL ================= */
router.post("/presign", authRequired, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(403).json({ error: "unauthorized" });

    const { fileName, fileType, folder = "uploads" } = req.body || {};

    if (!fileName || !fileType) {
      return res.status(400).json({ error: "missing_file_data" });
    }

    if (!ALLOWED_TYPES.includes(fileType)) {
      return res.status(400).json({
        error: "invalid_file_type",
        message: "Doar JPG, PNG, WEBP sau PDF.",
      });
    }

    const key = `${safeFolder(folder)}/${userId}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(
      fileName
    )}`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      ContentType: fileType,
    });

    const uploadUrl = await getSignedUrl(r2Client, command, {
      expiresIn: 60,
    });

    return res.json({
      ok: true,
      uploadUrl,
      url: buildPublicUrl(key),
      key,
    });
  } catch (err) {
    console.error("Presign upload error:", err);
    return res.status(500).json({ error: "presign_failed" });
  }
});

/* ================= OLD SINGLE UPLOAD - FALLBACK ================= */
router.post("/", authRequired, upload.single("file"), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(403).json({ error: "unauthorized" });

    if (!req.file) return res.status(400).json({ error: "no_file" });

    const key = `uploads/${userId}/${Date.now()}-${safeFileName(req.file.originalname)}`;

    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    return res.json({
      ok: true,
      url: buildPublicUrl(key),
      key,
    });
  } catch (err) {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file_too_large" });
    }

    if (err?.message === "INVALID_FILE_TYPE") {
      return res.status(400).json({
        error: "invalid_file_type",
        message: "Doar JPG, PNG, WEBP sau PDF.",
      });
    }

    console.error("Upload error:", err);
    return res.status(500).json({ error: "upload_failed" });
  }
});

/* ================= OLD SUPPORT UPLOAD - FALLBACK ================= */
router.post("/support", authRequired, upload.array("files", 3), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(403).json({ error: "unauthorized" });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "no_file" });

    const uploaded = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];

      const key = `support/${userId}/${Date.now()}-${i}-${safeFileName(
        f.originalname
      )}`;

      await r2Client.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: f.buffer,
          ContentType: f.mimetype,
        })
      );

      uploaded.push({
        url: buildPublicUrl(key),
        key,
        name: f.originalname,
        size: f.size,
        mimeType: f.mimetype,
      });
    }

    return res.json({
      ok: true,
      items: uploaded,
    });
  } catch (err) {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file_too_large" });
    }

    if (err?.message === "INVALID_FILE_TYPE") {
      return res.status(400).json({
        error: "invalid_file_type",
        message: "Doar JPG, PNG, WEBP sau PDF.",
      });
    }

    console.error("Upload support error:", err);
    return res.status(500).json({ error: "upload_failed" });
  }
});

export default router;