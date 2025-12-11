// src/api/upload.js
import { Router } from "express";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { authRequired } from "../api/auth.js";

const router = Router();

// ========== CONFIG R2 din env ==========
const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.warn(
    "[R2] Env incomplet. Verifică R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME."
  );
}

// Client compatibil S3 pentru Cloudflare R2
const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// Multer – memorie, max 5MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// helper URL public
function buildPublicUrl(key) {
  if (R2_PUBLIC_BASE_URL) {
    // ex: https://media.artfest.ro/avatars/...
    return `${R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key}`;
  }
  // fallback
  return `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`;
}

function getUserId(req) {
  return req.user?.sub || req.user?.id;
}

/**
 * POST /api/upload
 * FormData: file=<binary>
 * Răspuns: { ok: true, url, key }
 */
router.post("/", authRequired, upload.single("file"), async (req, res) => {
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

    const mime = req.file.mimetype || "application/octet-stream";

    const safeOriginalName = (req.file.originalname || "avatar")
      .toLowerCase()
      .replace(/[^a-z0-9.\-_]+/g, "-");

    const timestamp = Date.now();
    const key = `avatars/${userId}/${timestamp}-${safeOriginalName}`;

    const putCommand = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: req.file.buffer,
      ContentType: mime,
    });

    await r2Client.send(putCommand);

    const url = buildPublicUrl(key);

    return res.json({
      ok: true,
      url,
      key,
    });
  } catch (err) {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "file_too_large",
        message: "Fișierul este prea mare (max 5MB).",
      });
    }
    console.error("Upload error (R2):", err);
    return res.status(500).json({
      error: "upload_failed",
      message: "Upload eșuat. Încearcă din nou.",
    });
  }
});
router.post(
  "/support",
  authRequired,
  upload.array("files", 10), // până la 10 atașamente
  async (req, res) => {
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
        const f = files[i];
        const mime = f.mimetype || "application/octet-stream";

        const safeOriginalName = (f.originalname || "attachment")
          .toLowerCase()
          .replace(/[^a-z0-9.\-_]+/g, "-");

        const timestamp = Date.now();
        const key = `support/${userId}/${timestamp}-${i}-${safeOriginalName}`;

        const putCommand = new PutObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: key,
          Body: f.buffer,
          ContentType: mime,
        });

        await r2Client.send(putCommand);

        const url = buildPublicUrl(key);

        uploaded.push({
          url,
          key,
          name: f.originalname || safeOriginalName,
          size: f.size || null,
          mimeType: mime,
        });
      }

      return res.json({
        ok: true,
        items: uploaded,
      });
    } catch (err) {
      if (err && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: "file_too_large",
          message: "Fișierul este prea mare (max 5MB).",
        });
      }
      console.error("Upload error (R2 support):", err);
      return res.status(500).json({
        error: "upload_failed",
        message: "Upload eșuat. Încearcă din nou.",
      });
    }
  }
);
export default router;
