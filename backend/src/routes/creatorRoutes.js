// backend/src/routes/creatorRoutes.js
//
// Artfest Creators (etapa 1a) - rutele influencerului. Montat pe /api/creator.
// Disponibil permanent; toate rutele cer autentificare + cont de influencer.
//
//   GET    /state                      starea pentru dashboard / onboarding (entry, profil, tur)
//   GET    /options                    nișe, categorii, limbi, platforme, tipuri de conținut
//   POST   /profile                    creează profilul (draft) - „Începe” / „Completez mai târziu”
//   PATCH  /profile                    salvează draftul (câmpuri parțiale; expectedVersion opțional)
//   PUT    /profile/socials            înlocuiește lista rețelelor sociale
//   POST   /profile/portfolio          adaugă (fotografie încărcată prin /uploads sau link)
//   DELETE /profile/portfolio/:id
//   POST   /profile/submit             trimite spre aprobare (gate de conformitate dacă e activ)
//   POST   /profile/pause              { paused } - dezactivare temporară
//   POST   /tour                       { version } - turul finalizat / omis
//   GET    /offers | POST /offers | PUT /offers/:id | POST /offers/:id/active { active }
//   POST   /uploads                    o fotografie (avatar / portofoliu), doar imagini
//
// Doar conturi INFLUENCER active (create prin invitație). Fără legătură cu afilierea.

import { Router } from "express";
import multer from "multer";
import sharp from "sharp";

import { authRequired, enforceTokenVersion } from "../api/auth.js";
import { CREATOR_LIMITS, CREATOR_UPLOAD_FOLDER, creatorOptions } from "../config/creators.js";
import { enforceInfluencerComplianceGate } from "../middleware/enforceInfluencerComplianceGate.js";
import { enforceInfluencerTermsGate } from "../middleware/enforceInfluencerTermsGate.js";
import { UploadBusyError, sendUploadBusy } from "../middleware/uploadLoadGuards.js";
import { heicDecodeMaxPixels } from "../services/heicDecoder.js";
import { buildPublicUrl, uploadToR2 } from "../services/r2Storage.js";
import { heavyUploadProcessing } from "../services/sharedUploadProcessing.js";
import {
  UploadImageRejectedError,
  UploadMemoryBusyError,
  assertImageProcessable,
  ensureUploadMemory,
  estimateImageProcessingBytes,
} from "../services/uploadMemoryGuard.js";
import {
  CreatorError,
  addPortfolioItem,
  createOffer,
  ensureProfile,
  getCreatorState,
  listOffers,
  loadInfluencerAccount,
  markTourSeen,
  removePortfolioItem,
  replaceSocials,
  setOfferActive,
  setPaused,
  submitForReview,
  updateOffer,
  updateProfile,
} from "../services/creators/creatorProfileService.js";
import { prisma } from "../db.js";
import { creatorCategoryLabels, creatorCategoryOptions } from "../services/creators/creatorCatalogCategories.js";

// toate categoriile active din catalogul Artfest + etichetele valorilor deja salvate (inclusiv cele vechi)
export function catalogCategoryOptions() {
  return { categories: creatorCategoryOptions(), categoryLabels: creatorCategoryLabels() };
}

const router = Router();

export function sendCreatorError(res, error, scope) {
  if (error instanceof CreatorError) {
    return res.status(error.status).json({
      error: error.code,
      message: error.message,
      ...(error.fields ? { fields: error.fields } : {}),
      ...(error.problems ? { problems: error.problems } : {}),
      ...(error.currentStatus ? { currentStatus: error.currentStatus } : {}),
    });
  }
  console.error(`[${scope}]`, error?.message || error);
  return res.status(500).json({ error: "internal_error", message: "A apărut o problemă. Încearcă din nou în câteva momente." });
}

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    sendCreatorError(res, error, "creators");
  }
};

// imaginile proprii ale contului: doar acestea pot deveni avatar / fotografie de portofoliu
const uploadPrefixFor = (userId) => buildPublicUrl(`${CREATOR_UPLOAD_FOLDER}/${userId}/`);

router.use(authRequired, enforceTokenVersion);

router.get(
  "/state",
  handle(async (req, res) => {
    res.json(await getCreatorState({ userId: req.user.sub }));
  })
);

router.get(
  "/options",
  handle(async (req, res) => {
    await loadInfluencerAccount(prisma, req.user.sub);
    res.json({ ...creatorOptions(), ...catalogCategoryOptions() });
  })
);

router.post(
  "/profile",
  handle(async (req, res) => {
    await ensureProfile({ userId: req.user.sub });
    res.status(201).json(await getCreatorState({ userId: req.user.sub }));
  })
);

router.patch(
  "/profile",
  handle(async (req, res) => {
    res.json(await updateProfile({ userId: req.user.sub, body: req.body || {}, uploadPrefix: uploadPrefixFor(req.user.sub) }));
  })
);

router.put(
  "/profile/socials",
  handle(async (req, res) => {
    res.json(await replaceSocials({ userId: req.user.sub, list: req.body?.socials }));
  })
);

router.post(
  "/profile/portfolio",
  handle(async (req, res) => {
    res.status(201).json(await addPortfolioItem({ userId: req.user.sub, body: req.body || {}, uploadPrefix: uploadPrefixFor(req.user.sub) }));
  })
);

router.delete(
  "/profile/portfolio/:id",
  handle(async (req, res) => {
    res.json(await removePortfolioItem({ userId: req.user.sub, itemId: req.params.id }));
  })
);

// activitate publică nouă => aceleași gate-uri ca la coduri / colecții: acordul de influencer
// (versiunea curentă, dacă se cere reacceptare) + conformitate (ex. acord părinte), dacă e activ
router.post(
  "/profile/submit",
  enforceInfluencerTermsGate,
  enforceInfluencerComplianceGate,
  handle(async (req, res) => {
    res.json(await submitForReview({ userId: req.user.sub }));
  })
);

router.post(
  "/profile/pause",
  handle(async (req, res) => {
    res.json(await setPaused({ userId: req.user.sub, paused: req.body?.paused === true }));
  })
);

router.post(
  "/tour",
  handle(async (req, res) => {
    res.json(await markTourSeen({ userId: req.user.sub, version: req.body?.version }));
  })
);

router.get(
  "/offers",
  handle(async (req, res) => {
    res.json({ items: await listOffers({ userId: req.user.sub }) });
  })
);

router.post(
  "/offers",
  enforceInfluencerTermsGate,
  enforceInfluencerComplianceGate,
  handle(async (req, res) => {
    res.status(201).json({ item: await createOffer({ userId: req.user.sub, body: req.body || {} }) });
  })
);

router.put(
  "/offers/:id",
  enforceInfluencerTermsGate,
  enforceInfluencerComplianceGate,
  handle(async (req, res) => {
    res.json({ item: await updateOffer({ userId: req.user.sub, offerId: req.params.id, body: req.body || {} }) });
  })
);

router.post(
  "/offers/:id/active",
  handle(async (req, res) => {
    res.json({ item: await setOfferActive({ userId: req.user.sub, offerId: req.params.id, active: req.body?.active === true }) });
  })
);

/* ---------------- încărcare fotografie (avatar / portofoliu) ---------------- */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CREATOR_LIMITS.uploadMaxBytes, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, String(file.mimetype || "").toLowerCase().startsWith("image/")),
});

router.post("/uploads", async (req, res) => {
  try {
    await loadInfluencerAccount(prisma, req.user.sub);
  } catch (error) {
    return sendCreatorError(res, error, "creators.upload");
  }

  upload.single("file")(req, res, async (err) => {
    if (err) {
      const tooLarge = err?.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "file_too_large" : "upload_failed",
        message: tooLarge ? "Fotografia este prea mare (maximum 10 MB)." : "Nu am putut încărca fotografia.",
      });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ error: "no_file", message: "Alege o fotografie (JPG, PNG, WebP sau HEIC)." });

    try {
      // același rând de procesare și aceeași protecție de memorie ca fotografiile de produs
      const uploaded = await heavyUploadProcessing(async (signal) => {
        const header = await sharp(file.buffer, { limitInputPixels: false }).metadata().catch(() => null);
        const costBytes = estimateImageProcessingBytes({ header, fileBytes: file.size });
        await ensureUploadMemory(costBytes, {
          precheck: (state) =>
            assertImageProcessable({
              header,
              costBytes,
              productMaxPixels: CREATOR_LIMITS.uploadMaxPixels,
              heicMaxPixels: heicDecodeMaxPixels(),
              pixelLimit: (_header, max) => max,
              limitBytes: state.limitBytes,
            }),
        });
        return uploadToR2({
          file,
          folder: CREATOR_UPLOAD_FOLDER,
          userId: req.user.sub,
          policy: "image",
          maxPixels: CREATOR_LIMITS.uploadMaxPixels,
          abortSignal: signal,
        });
      });
      res.status(201).json({ ok: true, url: uploaded.url });
    } catch (error) {
      if (error?.code === "upload_content_mismatch") {
        return res.status(415).json({ error: "invalid_image", message: "Fișierul nu este o fotografie validă." });
      }
      if (error?.code === "image_too_many_pixels" || error instanceof UploadImageRejectedError) {
        return res.status(422).json({ error: "image_too_many_pixels", message: "Fotografia are o rezoluție prea mare." });
      }
      if (error instanceof UploadMemoryBusyError) {
        return sendUploadBusy(res, error.retryAfterSeconds || 10, { message: error.message, reason: "memory" });
      }
      if (error instanceof UploadBusyError || error?.code === "server_busy") {
        return sendUploadBusy(res, error.retryAfterSeconds || 5);
      }
      console.error("[creators] upload:", error?.message || error);
      res.status(500).json({ error: "upload_failed", message: "Nu am putut încărca fotografia. Încearcă din nou." });
    }
  });
});

export default router;
