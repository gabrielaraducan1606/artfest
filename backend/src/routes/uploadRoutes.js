import { Router } from "express";
import multer from "multer";
import { authRequired } from "../api/auth.js";

const router = Router();

// Limite decente pentru upload (ex. 5MB) și stocare în memorie pentru DEV/local
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/**
 * POST /api/upload
 * FormData: file=<binary>
 * Răspuns: { url }
 *
 * DEV/LOCAL: întoarce un Data URL pentru preview imediat.
 * (în producție înlocuiește cu S3/Cloudinary și returnează URL public)
 */
router.post("/", authRequired, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no_file", message: "Nu ai trimis niciun fișier." });

    const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    return res.json({ url: base64 });
  } catch (err) {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file_too_large", message: "Fișierul este prea mare (max 5MB)." });
    }
    console.error("Upload error:", err);
    return res.status(500).json({ error: "upload_failed", message: "Upload eșuat. Încearcă din nou." });
  }
});

export default router;
