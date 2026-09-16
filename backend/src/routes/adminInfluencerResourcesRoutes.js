// backend/src/routes/adminInfluencerResourcesRoutes.js
//
// Admin CRUD pentru InfluencerResource (materiale de promovare pentru
// influenceri: produsul zilei, idei de postări, materiale de campanie
// etc.). ADMIN only.

import { Router } from "express";
import multer from "multer";
import { z } from "zod";

import { prisma } from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
  requireRole,
} from "../api/auth.js";

import { uploadToR2 } from "../services/r2Storage.js";

const router = Router();

router.use(
  authRequired,
  enforceTokenVersion,
  requireRole("ADMIN")
);

/*
 * Interval FIX (nu în Prisma, nu configurabil per resursă
 * momentan) - dacă vrem un interval diferit per resursă pe
 * viitor, se adaugă separat, explicit.
 */
const REPOST_THRESHOLD_DAYS = 14;

function daysSince(value, now = Date.now()) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return Math.floor(
    (now - date.getTime()) / 86400000
  );
}

/* =========================================================
   UPLOAD - IMAGE sau VIDEO
   Reutilizează uploadToR2() (extras deja din uploadRoutes.js) -
   nu duplică logica S3/R2, doar adaugă un folder dedicat.
========================================================= */

const ALLOWED_IMAGE_MIME_TYPES = new Set([
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
]);

/*
 * Aceleași tipuri/limită folosite deja pentru
 * /api/upload/products/video (uploadRoutes.js) - nu inventăm
 * limite noi pentru video.
 */
const ALLOWED_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
]);

const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;

const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_VIDEO_SIZE_BYTES,
  },
  fileFilter(req, file, cb) {
    const mime = String(file.mimetype || "").toLowerCase();

    if (
      ALLOWED_IMAGE_MIME_TYPES.has(mime) ||
      ALLOWED_VIDEO_MIME_TYPES.has(mime)
    ) {
      return cb(null, true);
    }

    return cb(new Error("INVALID_MEDIA_TYPE"));
  },
});

router.post(
  "/upload",
  (req, res) => {
    uploadMedia.single("file")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            ok: false,
            error: "file_too_large",
            message:
              "Fișierul este prea mare (max 20MB pentru imagini, 50MB pentru video).",
          });
        }

        if (err.message === "INVALID_MEDIA_TYPE") {
          return res.status(415).json({
            ok: false,
            error: "invalid_media_type",
            message:
              "Format invalid. Acceptăm imagini (JPG, PNG, WEBP, GIF, HEIC, HEIF, BMP, TIFF, AVIF) sau video (MP4, WEBM).",
          });
        }

        console.error(
          "[admin-influencer-resources] upload error:",
          err
        );

        return res.status(500).json({
          ok: false,
          error: "upload_failed",
          message: "Upload eșuat. Încearcă din nou.",
        });
      }

      try {
        if (!req.file) {
          return res.status(400).json({
            ok: false,
            error: "no_file",
            message: "Nu ai trimis niciun fișier.",
          });
        }

        const mime = String(
          req.file.mimetype || ""
        ).toLowerCase();

        const mediaType = ALLOWED_IMAGE_MIME_TYPES.has(mime)
          ? "IMAGE"
          : ALLOWED_VIDEO_MIME_TYPES.has(mime)
          ? "VIDEO"
          : null;

        if (!mediaType) {
          return res.status(415).json({
            ok: false,
            error: "invalid_media_type",
            message: "Format invalid.",
          });
        }

        if (
          mediaType === "IMAGE" &&
          req.file.size > MAX_IMAGE_SIZE_BYTES
        ) {
          return res.status(413).json({
            ok: false,
            error: "file_too_large",
            message: "Imaginea este prea mare (max 20MB).",
          });
        }

        const uploaded = await uploadToR2({
          file: req.file,
          folder: "influencer-resources",
          userId: req.user?.sub || "admin",
        });

        return res.json({
          ok: true,
          url: uploaded.url,
          mediaType,
        });
      } catch (uploadError) {
        if (uploadError?.code === "upload_content_mismatch") {
          return res.status(415).json({
            ok: false,
            error: "invalid_media_type",
            message:
              "Conținutul fișierului nu corespunde formatului declarat. Încearcă alt fișier.",
          });
        }

        console.error(
          "[admin-influencer-resources] upload error:",
          uploadError
        );

        return res.status(500).json({
          ok: false,
          error: "upload_failed",
          message: "Nu am putut încărca fișierul.",
        });
      }
    });
  }
);

/* =========================================================
   VALIDARE
========================================================= */

const RESOURCE_TYPES = [
  "PRODUCT_OF_DAY",
  "ARTISAN_OF_WEEK",
  "POST_IDEA",
  "ARTFEST_FEATURE",
  "CAMPAIGN",
  "GENERIC",
];

const RESOURCE_MEDIA_TYPES = ["IMAGE", "VIDEO"];

const RESOURCE_STATUSES = ["DRAFT", "PUBLISHED"];

const ResourcePayloadSchema = z.object({
  type: z.enum(RESOURCE_TYPES).default("GENERIC"),

  title: z.string().trim().min(1).max(200),

  description: z
    .string()
    .trim()
    .max(5000)
    .optional()
    .nullable(),

  mediaType: z
    .enum(RESOURCE_MEDIA_TYPES)
    .optional()
    .nullable(),

  mediaUrl: z
    .string()
    .trim()
    .url()
    .max(2000)
    .optional()
    .nullable(),

  targetUrl: z
    .string()
    .trim()
    .url()
    .max(2000)
    .optional()
    .nullable(),

  status: z
    .enum(RESOURCE_STATUSES)
    .default("DRAFT"),

  expiresAt: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .optional()
    .nullable(),
});

function normalizePayload(data) {
  let expiresAt = null;

  if (data.expiresAt) {
    const parsedDate = new Date(data.expiresAt);

    if (!Number.isNaN(parsedDate.getTime())) {
      expiresAt = parsedDate;
    }
  }

  return {
    type: data.type,
    title: data.title,
    description: data.description || null,

    /*
     * mediaUrl obligă mediaType (și invers) - o resursă tip
     * POST_IDEA poate rămâne fără media deloc.
     */
    mediaType: data.mediaUrl ? data.mediaType || null : null,
    mediaUrl: data.mediaUrl || null,

    targetUrl: data.targetUrl || null,
    status: data.status,

    expiresAt,
  };
}

function validateMediaConsistency(payload) {
  if (payload.mediaUrl && !payload.mediaType) {
    return "Selectează tipul media (imagine sau video) pentru fișierul încărcat.";
  }

  return null;
}

/* =========================================================
   GET /api/admin/influencer-resources
========================================================= */

router.get(
  "/",
  async (_req, res) => {
    try {
      /*
       * activeInfluencersCount = un singur query (nu depinde de
       * resursă), reutilizat pentru toate item-urile.
       *
       * Toate activitățile (pentru toate resursele) - UN SINGUR
       * query, grupate în JS pe resourceId. Evită N+1 (nu facem
       * un query de activități per resursă).
       */
      const [items, activeInfluencersCount, allActivities] =
        await Promise.all([
          prisma.influencerResource.findMany({
            orderBy: [
              { createdAt: "desc" },
            ],
          }),

          prisma.influencerProfile.count({
            where: {
              status: "ACTIVE",
            },
          }),

          prisma.influencerResourceActivity.findMany({
            where: {
              lastPostedAt: {
                not: null,
              },
            },

            select: {
              resourceId: true,
              lastPostedAt: true,
            },
          }),
        ]);

      const activitiesByResourceId = new Map();

      for (const activity of allActivities) {
        const list =
          activitiesByResourceId.get(
            activity.resourceId
          ) || [];

        list.push(activity);

        activitiesByResourceId.set(
          activity.resourceId,
          list
        );
      }

      const now = Date.now();

      const itemsWithActivityCount = items.map(
        (item) => {
          const activities =
            activitiesByResourceId.get(item.id) ||
            [];

          /*
           * "de reluat" per influencer = ultima lui
           * postare pentru ACEASTĂ resursă are cel
           * puțin REPOST_THRESHOLD_DAYS zile - fix,
           * nu configurabil (nu ținem asta în Prisma).
           */
          const postedStaleCount = activities.filter(
            (activity) =>
              daysSince(
                activity.lastPostedAt,
                now
              ) >= REPOST_THRESHOLD_DAYS
          ).length;

          const postedRecentCount =
            activities.length - postedStaleCount;

          const activeCount = activeInfluencersCount;

          const neverPostedCount = Math.max(
            0,
            activeCount - activities.length
          );

          return {
            ...item,

            influencersPostedCount: activities.length,
            activeInfluencersCount: activeCount,

            postedRecentCount,
            postedStaleCount,
            neverPostedCount,
          };
        }
      );

      return res.json({
        ok: true,
        items: itemsWithActivityCount,
      });
    } catch (error) {
      console.error(
        "[admin-influencer-resources] GET / error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_resources_load_failed",
        message: "Nu am putut încărca resursele.",
      });
    }
  }
);

/* =========================================================
   GET /api/admin/influencer-resources/:id/activity

   Toți influencerii ACTIVI + activitatea lor (dacă există)
   pentru resursa asta - un singur query pe influenceri, un
   singur query pe activities, join în JS (nu N+1).
========================================================= */

router.get(
  "/:id/activity",
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();

      if (!id) {
        return res.status(400).json({
          ok: false,
          error: "resource_id_required",
        });
      }

      const resource = await prisma.influencerResource.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
        },
      });

      if (!resource) {
        return res.status(404).json({
          ok: false,
          error: "influencer_resource_not_found",
        });
      }

      const [influencers, activities] =
        await Promise.all([
          prisma.influencerProfile.findMany({
            where: {
              status: "ACTIVE",
            },

            select: {
              id: true,
              displayName: true,
              status: true,

              user: {
                select: {
                  email: true,
                  name: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },

            orderBy: {
              createdAt: "desc",
            },
          }),

          prisma.influencerResourceActivity.findMany({
            where: {
              resourceId: id,
            },

            select: {
              influencerId: true,
              lastPostedAt: true,
              postedCount: true,
            },
          }),
        ]);

      const activityByInfluencerId = new Map(
        activities.map((activity) => [
          activity.influencerId,
          activity,
        ])
      );

      const now = Date.now();

      const rows = influencers.map((influencer) => {
        const activity = activityByInfluencerId.get(
          influencer.id
        );

        const fallbackName = [
          influencer.user?.firstName,
          influencer.user?.lastName,
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

        const hasPosted = Boolean(
          activity?.lastPostedAt
        );

        const isStale =
          hasPosted &&
          daysSince(activity.lastPostedAt, now) >=
            REPOST_THRESHOLD_DAYS;

        return {
          influencerId: influencer.id,

          displayName:
            influencer.displayName ||
            influencer.user?.name ||
            fallbackName ||
            influencer.user?.email ||
            "Influencer",

          email: influencer.user?.email || null,
          status: influencer.status,

          lastPostedAt:
            activity?.lastPostedAt || null,

          postedCount: activity?.postedCount || 0,

          hasPosted,
          isStale,
        };
      });

      /*
       * Sortare: întâi cei care au postat, cei mai recenți
       * primii; apoi cei care încă n-au postat.
       */
      rows.sort((a, b) => {
        if (a.hasPosted && !b.hasPosted) return -1;
        if (!a.hasPosted && b.hasPosted) return 1;

        if (a.hasPosted && b.hasPosted) {
          return (
            new Date(b.lastPostedAt).getTime() -
            new Date(a.lastPostedAt).getTime()
          );
        }

        return a.displayName.localeCompare(
          b.displayName,
          "ro"
        );
      });

      return res.json({
        ok: true,

        resource: {
          id: resource.id,
          title: resource.title,
        },

        influencers: rows,

        summary: {
          activeInfluencersCount: rows.length,

          postedCount: rows.filter(
            (row) => row.hasPosted
          ).length,

          notPostedCount: rows.filter(
            (row) => !row.hasPosted
          ).length,

          recentCount: rows.filter(
            (row) => row.hasPosted && !row.isStale
          ).length,

          staleCount: rows.filter(
            (row) => row.isStale
          ).length,
        },
      });
    } catch (error) {
      console.error(
        "[admin-influencer-resources] GET /:id/activity error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_resource_activity_load_failed",
        message: "Nu am putut încărca activitatea.",
      });
    }
  }
);

/* =========================================================
   POST /api/admin/influencer-resources
========================================================= */

router.post(
  "/",
  async (req, res) => {
    try {
      const parsed = ResourcePayloadSchema.safeParse(
        req.body || {}
      );

      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }

      const payload = normalizePayload(parsed.data);

      const mediaError = validateMediaConsistency(payload);

      if (mediaError) {
        return res.status(400).json({
          ok: false,
          error: "invalid_media",
          message: mediaError,
        });
      }

      const created = await prisma.influencerResource.create({
        data: {
          ...payload,

          publishedAt:
            payload.status === "PUBLISHED"
              ? new Date()
              : null,
        },
      });

      return res.status(201).json({
        ok: true,
        resource: created,
      });
    } catch (error) {
      console.error(
        "[admin-influencer-resources] POST / error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_resource_create_failed",
        message: "Nu am putut salva resursa.",
      });
    }
  }
);

/* =========================================================
   PATCH /api/admin/influencer-resources/:id
========================================================= */

router.patch(
  "/:id",
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();

      if (!id) {
        return res.status(400).json({
          ok: false,
          error: "resource_id_required",
        });
      }

      const existing = await prisma.influencerResource.findUnique({
        where: { id },

        select: {
          id: true,
          status: true,
          publishedAt: true,
        },
      });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          error: "influencer_resource_not_found",
        });
      }

      const parsed = ResourcePayloadSchema.safeParse(
        req.body || {}
      );

      if (!parsed.success) {
        return res.status(400).json({
          ok: false,
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }

      const payload = normalizePayload(parsed.data);

      const mediaError = validateMediaConsistency(payload);

      if (mediaError) {
        return res.status(400).json({
          ok: false,
          error: "invalid_media",
          message: mediaError,
        });
      }

      /*
       * publishedAt se setează o singură dată, la prima
       * publicare - nu îl resetăm dacă adminul retrage și
       * republică resursa (rămâne data primei publicări).
       */
      const publishedAt =
        payload.status === "PUBLISHED"
          ? existing.publishedAt || new Date()
          : existing.publishedAt;

      const updated = await prisma.influencerResource.update({
        where: { id },

        data: {
          ...payload,
          publishedAt,
        },
      });

      return res.json({
        ok: true,
        resource: updated,
      });
    } catch (error) {
      console.error(
        "[admin-influencer-resources] PATCH /:id error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_resource_update_failed",
        message: "Nu am putut actualiza resursa.",
      });
    }
  }
);

/* =========================================================
   DELETE /api/admin/influencer-resources/:id

   Șterge doar rândul din DB - NU șterge automat asset-ul
   din R2 în această primă versiune.
========================================================= */

router.delete(
  "/:id",
  async (req, res) => {
    try {
      const id = String(req.params.id || "").trim();

      if (!id) {
        return res.status(400).json({
          ok: false,
          error: "resource_id_required",
        });
      }

      const existing = await prisma.influencerResource.findUnique({
        where: { id },
        select: { id: true },
      });

      if (!existing) {
        return res.status(404).json({
          ok: false,
          error: "influencer_resource_not_found",
        });
      }

      await prisma.influencerResource.delete({
        where: { id },
      });

      return res.json({
        ok: true,
        deletedId: id,
      });
    } catch (error) {
      console.error(
        "[admin-influencer-resources] DELETE /:id error:",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "influencer_resource_delete_failed",
        message: "Nu am putut șterge resursa.",
      });
    }
  }
);

export default router;
