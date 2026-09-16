// backend/src/routes/influencerFilesRoutes.js

import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import {
  r2Client,
  uploadToR2,
  getSignedDownloadUrl,
} from "../services/r2Storage.js";

const router = Router();

/* =========================================================
   „Fișierele mele” - documente pe care influencerul le
   încarcă pentru colaborarea cu Artfest (InfluencerFile).

   NU este legat de Invoice (facturile de payout rămân
   complet separate, gestionate de influencerPayoutService.js).
========================================================= */

const {
  R2_ACCOUNT_ID,
  R2_BUCKET_NAME,
  R2_PUBLIC_BASE_URL,
} = process.env;

/* =========================================================
   VALIDARE UPLOAD

   Whitelist strict - documente uzuale de colaborare. NU
   acceptăm executabile, scripturi, HTML sau arhive.
========================================================= */

const ALLOWED_INFLUENCER_FILE_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  /*
   * Unele browsere/OS-uri trimit acest mime generic pentru
   * DOC/DOCX/XLS/XLSX - acceptat DOAR combinat cu o extensie
   * validă (vezi influencerFileFilter mai jos).
   */
  "application/octet-stream",
];

const ALLOWED_INFLUENCER_FILE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
]);

const INFLUENCER_FILE_MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function getFileExtension(name = "") {
  const match = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function influencerFileFilter(req, file, cb) {
  const ext = getFileExtension(file.originalname || "");
  const mime = String(file.mimetype || "").toLowerCase();

  const extAllowed = ALLOWED_INFLUENCER_FILE_EXTENSIONS.has(ext);
  const mimeAllowed = ALLOWED_INFLUENCER_FILE_MIME_TYPES.includes(mime);

  if (!extAllowed || !mimeAllowed) {
    console.warn("[influencerFiles] Format respins:", {
      mimetype: file.mimetype,
      originalname: file.originalname,
      extension: ext,
    });

    return cb(new Error("INVALID_INFLUENCER_FILE_TYPE"));
  }

  cb(null, true);
}

const uploadInfluencerFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: INFLUENCER_FILE_MAX_SIZE_BYTES },
  fileFilter: influencerFileFilter,
});

function handleInfluencerFileUploadError(err, res) {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      ok: false,
      error: "file_too_large",
      message: "Fișierul este prea mare (max 10MB).",
    });
  }

  if (err?.message === "INVALID_INFLUENCER_FILE_TYPE") {
    return res.status(415).json({
      ok: false,
      error: "invalid_file_type",
      message:
        "Format invalid. Acceptăm PDF, JPG, PNG, WEBP, DOC, DOCX, XLS sau XLSX.",
    });
  }

  console.error("[influencerFiles] Upload error:", err);

  return res.status(500).json({
    ok: false,
    error: "upload_failed",
    message: "Upload eșuat. Încearcă din nou.",
  });
}

/* =========================================================
   OWNERSHIP

   Identic ca formă cu requireInfluencerForPayoutProfile din
   influencerRoutes.js - influencerul e rezolvat din
   req.user.sub, nu poate fi trimis de client.
========================================================= */

async function requireInfluencerProfile(req, res) {
  const userId = req.user?.sub;

  if (!userId) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }

  const influencer = await prisma.influencerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!influencer) {
    res.status(403).json({ ok: false, error: "influencer_required" });
    return null;
  }

  return influencer;
}

/* =========================================================
   TYPE
========================================================= */

const InfluencerFileTypeSchema = z.enum([
  "CONTRACT",
  "BRIEF",
  "DOCUMENT",
  "OTHER",
]);

function parseInfluencerFileType(value) {
  const parsed = InfluencerFileTypeSchema.safeParse(
    String(value || "OTHER").toUpperCase()
  );

  return parsed.success ? parsed.data : "OTHER";
}

function normalizeTitle(value) {
  if (value === undefined) return undefined;
  const trimmed = String(value || "").trim().slice(0, 200);
  return trimmed || null;
}

/* =========================================================
   SERIALIZARE - FĂRĂ fileUrl

   fileUrl e URL-ul public permanent din R2 - documente potențial
   sensibile (contract/brief) nu trebuie expuse niciodată prin el în
   API. Clientul cere un URL semnat, temporar, prin GET /:id/download.
========================================================= */

function serializeInfluencerFile(row) {
  const { fileUrl, ...rest } = row;
  return rest;
}

/* =========================================================
   R2 KEY FROM PUBLIC URL

   Extras identic ca logică din uploadRoutes.js
   (keyFromPublicUrl) - reutilizăm formatul URL-ului public,
   fără să atingem fișierul existent.
========================================================= */

function keyFromPublicUrl(url) {
  const base = R2_PUBLIC_BASE_URL
    ? R2_PUBLIC_BASE_URL.replace(/\/+$/, "")
    : `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  if (!url || !url.startsWith(`${base}/`)) return null;

  return url.slice(base.length + 1);
}

/* =========================================================
   GET /api/influencer/files
========================================================= */

router.get(
  "/",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer = await requireInfluencerProfile(req, res);
      if (!influencer) return;

      const items = await prisma.influencerFile.findMany({
        where: { influencerId: influencer.id },
        orderBy: { createdAt: "desc" },
      });

      return res.json({
        ok: true,
        items: items.map(serializeInfluencerFile),
      });
    } catch (error) {
      console.error(
        "[influencerFilesRoutes] GET / error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_files_load_failed",
      });
    }
  }
);

/* =========================================================
   GET /api/influencer/files/:id/download

   InfluencerFile e un document potențial sensibil (contract/brief) -
   NU se mai returnează niciodată URL-ul public permanent direct în
   listă. Doar acest endpoint, DUPĂ ce verifică ownership, generează
   un URL semnat cu expirare scurtă (5 minute) pe care frontend-ul îl
   deschide imediat.
========================================================= */

router.get(
  "/:id/download",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer = await requireInfluencerProfile(req, res);
      if (!influencer) return;

      const id = String(req.params.id || "").trim();

      if (!id) {
        return res.status(400).json({ ok: false, error: "file_id_required" });
      }

      const existing = await prisma.influencerFile.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          error: "influencer_file_not_found",
        });
      }

      if (existing.influencerId !== influencer.id) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      const key = keyFromPublicUrl(existing.fileUrl);

      if (!key) {
        return res.status(500).json({
          ok: false,
          error: "influencer_file_key_unresolvable",
        });
      }

      const url = await getSignedDownloadUrl({
        key,
        filename: existing.originalFilename,
      });

      return res.json({ ok: true, url, expiresInSeconds: 300 });
    } catch (error) {
      console.error(
        "[influencerFilesRoutes] GET /:id/download error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_file_download_failed",
      });
    }
  }
);

/* =========================================================
   POST /api/influencer/files

   FormData: file=<binary>, title?=<string>, type?=<enum>
========================================================= */

router.post(
  "/",
  authRequired,
  enforceTokenVersion,
  (req, res) => {
    uploadInfluencerFile.single("file")(req, res, async (err) => {
      if (err) return handleInfluencerFileUploadError(err, res);

      try {
        const influencer = await requireInfluencerProfile(req, res);
        if (!influencer) return;

        if (!req.file) {
          return res.status(400).json({
            ok: false,
            error: "no_file",
            message: "Nu ai trimis niciun fișier.",
          });
        }

        const type = parseInfluencerFileType(req.body?.type);
        const title = normalizeTitle(req.body?.title) ?? null;

        const uploaded = await uploadToR2({
          file: req.file,
          folder: "influencer-files",
          userId: influencer.id,
        });

        const created = await prisma.influencerFile.create({
          data: {
            influencerId: influencer.id,
            type,
            title,
            originalFilename: req.file.originalname || uploaded.name,
            fileUrl: uploaded.url,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.size,
          },
        });

        return res
          .status(201)
          .json({ ok: true, item: serializeInfluencerFile(created) });
      } catch (error) {
        if (error?.code === "upload_content_mismatch") {
          return res.status(415).json({
            ok: false,
            error: "invalid_file_type",
            message:
              "Conținutul fișierului nu corespunde formatului declarat. Încearcă alt fișier.",
          });
        }

        console.error(
          "[influencerFilesRoutes] POST / error:",
          error
        );

        return res.status(500).json({
          ok: false,
          error: "influencer_file_upload_failed",
          message: "Nu am putut încărca fișierul. Încearcă din nou.",
        });
      }
    });
  }
);

/* =========================================================
   PATCH /api/influencer/files/:id

   Opțional - schimbă doar titlul/tipul. NU permite
   schimbarea fileUrl/mimeType/sizeBytes.
========================================================= */

router.patch(
  "/:id",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer = await requireInfluencerProfile(req, res);
      if (!influencer) return;

      const id = String(req.params.id || "").trim();

      if (!id) {
        return res.status(400).json({ ok: false, error: "file_id_required" });
      }

      const existing = await prisma.influencerFile.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          error: "influencer_file_not_found",
        });
      }

      if (existing.influencerId !== influencer.id) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      const patch = {};

      if (req.body?.title !== undefined) {
        patch.title = normalizeTitle(req.body.title);
      }

      if (req.body?.type !== undefined) {
        const parsed = InfluencerFileTypeSchema.safeParse(
          String(req.body.type || "").toUpperCase()
        );

        if (!parsed.success) {
          return res.status(400).json({
            ok: false,
            error: "invalid_type",
          });
        }

        patch.type = parsed.data;
      }

      const updated = await prisma.influencerFile.update({
        where: { id },
        data: patch,
      });

      return res.json({ ok: true, item: serializeInfluencerFile(updated) });
    } catch (error) {
      console.error(
        "[influencerFilesRoutes] PATCH /:id error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_file_update_failed",
      });
    }
  }
);

/* =========================================================
   DELETE /api/influencer/files/:id
========================================================= */

router.delete(
  "/:id",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const influencer = await requireInfluencerProfile(req, res);
      if (!influencer) return;

      const id = String(req.params.id || "").trim();

      if (!id) {
        return res.status(400).json({ ok: false, error: "file_id_required" });
      }

      const existing = await prisma.influencerFile.findUnique({
        where: { id },
      });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          error: "influencer_file_not_found",
        });
      }

      if (existing.influencerId !== influencer.id) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      await prisma.influencerFile.delete({ where: { id } });

      const key = keyFromPublicUrl(existing.fileUrl);

      if (key) {
        await r2Client
          .send(
            new DeleteObjectCommand({
              Bucket: R2_BUCKET_NAME,
              Key: key,
            })
          )
          .catch((delErr) => {
            console.error(
              "[influencerFilesRoutes] R2 delete failed:",
              delErr
            );
          });
      }

      return res.json({ ok: true });
    } catch (error) {
      console.error(
        "[influencerFilesRoutes] DELETE /:id error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_file_delete_failed",
      });
    }
  }
);

export default router;
