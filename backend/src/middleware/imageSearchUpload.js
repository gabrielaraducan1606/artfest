// server/middleware/imageSearchUpload.js
import multer from "multer";

const MAX_FILE_SIZE_MB = Number(process.env.IMAGE_SEARCH_MAX_MB || 5);
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
  },
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
});

// numele câmpului din form-data va fi "image"
export const uploadSearchImage = upload.single("image");
