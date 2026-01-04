import multer from "multer";

const MAX_FILE_SIZE_MB = Number(process.env.IMAGE_SEARCH_MAX_MB || 8);
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export const uploadSearchImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(
        new Error(
          "Tip de fișier neacceptat. Te rugăm să încarci o imagine (JPG, PNG, WebP sau GIF)."
        )
      );
    }
    cb(null, true);
  },
}).single("image");
