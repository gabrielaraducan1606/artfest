import multer from "multer";
import sharp from "sharp";

const MAX_FILE_SIZE_MB = Number(process.env.IMAGE_SEARCH_MAX_MB || 4);

/*
 * Rezoluția maximă acceptată la căutarea după imagine, verificată din HEADER,
 * înainte de orice decodare. Un fișier de câteva sute de KB (ex. PNG de o
 * singură culoare) poate avea zeci sau sute de megapixeli; sharp acceptă
 * implicit până la 268 MP.
 *
 * 24 MP (măsurat 2026-11-13, lanțul din lib/embeddings.js): JPEG 24 MP +2 MB,
 * PNG 24 MP +34 MB, WEBP 24 MP +3 MB. Frontend-ul trimite oricum maximum
 * 1024 px (hooks/useImageSearch.js), iar fotografiile de telefon au 12-24 MP.
 * Configurabil: IMAGE_SEARCH_MAX_PIXELS.
 */
export const IMAGE_SEARCH_MAX_PIXELS = (() => {
  const value = Number.parseInt(process.env.IMAGE_SEARCH_MAX_PIXELS, 10);
  return Number.isFinite(value) && value > 0 ? value : 24_000_000;
})();

export const IMAGE_SEARCH_TOO_LARGE_MESSAGE = `Imaginea are o rezoluție prea mare pentru căutare (maximum ${Math.round(
  IMAGE_SEARCH_MAX_PIXELS / 1_000_000
)} MP). Încearcă o fotografie mai mică sau o captură de ecran.`;

const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const multerSingle = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(
        new Error(
          "Tip de fișier neacceptat. Te rugăm să încarci o imagine JPG, PNG, WebP sau GIF."
        )
      );
    }

    cb(null, true);
  },
}).single("image");

/** Dimensiunile din header (fără decodare) sau null dacă nu se pot citi. */
export async function readSearchImageSize(buffer) {
  try {
    const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
    const width = Number(meta?.width) || 0;
    const height = Number(meta?.height) || 0;
    return width && height ? { width, height, pixels: width * height } : null;
  } catch {
    return null; // nedecodabil: decide lanțul existent (embedding eșuat -> răspunsul existent)
  }
}

/*
 * Același contract ca înainte (multer .single("image") -> (req, res, next)),
 * plus verificarea rezoluției: o imagine prea mare primește 422 direct, fără
 * să ajungă la decodare sau la modelul CLIP. Rutele NU se modifică.
 */
export function uploadSearchImage(req, res, next) {
  multerSingle(req, res, async (err) => {
    if (err || !req.file?.buffer) return next(err);

    const size = await readSearchImageSize(req.file.buffer);
    if (size && size.pixels > IMAGE_SEARCH_MAX_PIXELS) {
      console.warn("[image-search] rezoluție prea mare - refuzat înainte de decodare", {
        width: size.width,
        height: size.height,
        bytes: req.file.size,
      });
      req.file.buffer = null;
      return res.status(422).json({
        error: "IMAGE_TOO_LARGE",
        message: IMAGE_SEARCH_TOO_LARGE_MESSAGE,
        maxPixels: IMAGE_SEARCH_MAX_PIXELS,
      });
    }

    return next();
  });
}
