// controllers/contractController.js
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs/promises";
import fsSync from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

import Contract from "../models/Contract.js";
import User from "../models/user.js";
// ⚠️ păstrează casing-ul exact ca pe disc (Seller.js vs seller.js)
import Seller from "../models/Seller.js";
import { savePdfBuffer } from "../utils/pdf.js";

/* =========================
   Config fonturi PDF (TTF/OTF)
   ========================= */
const __dirname = dirname(fileURLToPath(import.meta.url));
// <repo>/backend
const BACKEND_ROOT = path.resolve(__dirname, "..");
// <repo>/backend/assets/fonts
const FONT_DIR = path.join(BACKEND_ROOT, "assets", "fonts");

// Modifică aceste nume dacă folosești alte fișiere
const FONT_REGULAR_NAME = "EBGaramond-Regular.ttf"; // sau .otf
const FONT_BOLD_NAME    = "EBGaramond-Bold.ttf";    // sau .otf

// Cache în memorie ca să nu re-citim fonturile de pe disc
/** @type {{regular:Uint8Array,bold:Uint8Array}|null} */
let _fontBytesCache = null;

async function readFontBytes(p) {
  const bytes = await fs.readFile(p);
  // Validare minimă TTF/OTF
  const sig = bytes.subarray(0, 4);
  const ascii = sig.toString("ascii");
  const isTTF = sig[0] === 0x00 && sig[1] === 0x01 && sig[2] === 0x00 && sig[3] === 0x00;
  const isOTF = ascii === "OTTO" || ascii === "true";
  if (!isTTF && !isOTF) {
    throw new Error(`Fișier font invalid/nesuportat: ${p}`);
  }
  return bytes;
}

async function ensureFontBytesLoaded() {
  if (_fontBytesCache) return _fontBytesCache;

  const regularPath = path.join(FONT_DIR, FONT_REGULAR_NAME);
  const boldPath    = path.join(FONT_DIR, FONT_BOLD_NAME);

  // log vizibil în dev
  if (process.env.NODE_ENV !== "production") {
    try {
      const list = await fs.readdir(FONT_DIR);
      console.log("[fonts] DIR     =", FONT_DIR);
      console.log("[fonts] CONTENT =", list);
    } catch (e) {
      console.error("[fonts] nu pot citi directorul:", FONT_DIR, e.message);
    }
    console.log("[fonts] load    =", regularPath, "|", boldPath);
  }

  const regular = await readFontBytes(regularPath);
  const bold    = await readFontBytes(boldPath);
  _fontBytesCache = { regular, bold };
  return _fontBytesCache;
}

async function embedFonts(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);
  const { regular, bold } = await ensureFontBytesLoaded();
  const fontRegular = await pdfDoc.embedFont(regular, { subset: true });
  const fontBold    = await pdfDoc.embedFont(bold,    { subset: true });
  return { fontRegular, fontBold };
}

/* ============ helpers ============ */

async function generateContractPdfForSeller({ seller, version = "v1.0" }) {
  const pdfDoc = await PDFDocument.create();

  let fonts;
  try {
    fonts = await embedFonts(pdfDoc);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    e.message = `Nu s-au putut încărca fonturile PDF (TTF/OTF). Verifică ${FONT_DIR} și numele fișierelor. Detalii: ${e.message}`;
    throw e;
  }
  const { fontRegular, fontBold } = fonts;

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const titleSize = 18;
  const bodySize = 11;
  let y = 800;

  const draw = (text, size = bodySize, bold = false) => {
    page.drawText(String(text ?? ""), {
      x: 50,
      y,
      size,
      font: bold ? fontBold : fontRegular,
      color: rgb(0, 0, 0),
    });
    y -= size + 8;
  };

  draw("CONTRACT DE COLABORARE", titleSize, true);
  y -= 6;

  draw(`Versiune: ${version}`);
  draw(`Generat: ${new Date().toLocaleString("ro-RO")}`);
  y -= 6;

  draw("Părțile:", bodySize, true);
  draw(`- Vânzător: ${seller.shopName || "-"} (${seller.username || "-"})`);
  draw(`- Email: ${seller.email || "-"}`);
  draw(`- CUI: ${seller.cui || "-"}`);
  draw(`- IBAN: ${seller.iban || "-"}`);
  draw(`- Locație: ${seller.city || "-"}, ${seller.country || "-"}`);

  y -= 12;
  draw("Clauze principale:", bodySize, true);
  draw("1. Vânzătorul își asumă responsabilitatea pentru produsele listate.");
  draw("2. Platforma procesează comenzi conform termenilor agreați.");
  draw("3. Politici de livrare și retur conform setărilor din cont.");
  draw("4. Taxe și comisioane conform planului de abonament.");

  y -= 20;
  draw("Semnătură vânzător: ____________________________");
  draw("Data: __________________");

  const bytes = await pdfDoc.save();
  return savePdfBuffer(bytes, `contract-${seller._id}-${Date.now()}`);
}

async function getOrCreateContractForUser(userId, version = "v1.0") {
  const seller = await Seller.findOne({ userId });
  if (!seller) {
    const err = new Error("Seller inexistent – finalizează profilul înainte de contract.");
    err.status = 400;
    throw err;
  }

  let contract = await Contract.findOne({ userId });

  // Dacă există contract dar fișierul lipsește pe disc → regenerează
  if (contract) {
    const src = contract.pdfSignedPath || contract.pdfPath;
    if (!src || !fsSync.existsSync(src)) {
      const { path: filePath, url } = await generateContractPdfForSeller({ seller, version });
      contract.pdfPath = filePath;
      contract.pdfUrl = url;
      contract.pdfSignedPath = undefined;
      contract.pdfSignedUrl = undefined;
      contract.status = "draft";
      await contract.save();
    }
    return contract;
  }

  // Altfel, creează unul nou
  const { path: filePath, url } = await generateContractPdfForSeller({ seller, version });
  contract = await Contract.create({
    userId,
    sellerId: seller._id,
    version,
    status: "draft",
    pdfPath: filePath,
    pdfUrl: url,
    snapshot: {
      shopName: seller.shopName,
      username: seller.username,
      companyName: seller.companyName,
      cui: seller.cui,
      iban: seller.iban,
      city: seller.city,
      country: seller.country,
      generatedAt: new Date(),
    },
  });

  return contract;
}

/* ============ controllers ============ */

/** POST /api/contracts/init — creează sau întoarce draftul de contract pentru userul curent */
export const initContract = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ msg: "Neautorizat" });

    const user = await User.findById(req.user.id).select("_id");
    if (!user) return res.status(401).json({ msg: "Neautorizat" });

    const version = req.body?.version || "v1.0";
    const contract = await getOrCreateContractForUser(user._id, version);

    return res.json({ ok: true, contract });
  } catch (e) {
    console.error("initContract error:", e);
    return res.status(e.status || 500).json({ msg: e.message || "Eroare init contract" });
  }
};

/** GET /api/contracts/me — contractul curent al userului */
export const getMyContract = async (req, res) => {
  const c = await Contract.findOne({ userId: req.user.id });
  if (!c) return res.status(404).json({ msg: "Contract inexistent" });
  res.json(c);
};

/** GET /api/contracts/:id — citește contract după id */
export const getContract = async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ msg: "Contract inexistent" });
  if (String(contract.userId) !== String(req.user.id)) {
    return res.status(403).json({ msg: "Acces interzis" });
  }
  res.json(contract);
};

/** POST /api/contracts/:id/sign — semnează contractul și inserează semnătura în PDF */
export const signContract = async (req, res) => {
  try {
    const { id } = req.params;
    const { signerName, signerEmail, signatureImageBase64, consentAccepted } = req.body || {};

    if (!signerName || !signerEmail || !signatureImageBase64 || !consentAccepted) {
      return res.status(400).json({ msg: "Date de semnare incomplete" });
    }

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ msg: "Contract inexistent" });
    if (String(contract.userId) !== String(req.user.id)) {
      return res.status(403).json({ msg: "Acces interzis" });
    }

    const srcPath = contract.pdfSignedPath || contract.pdfPath;
    if (!srcPath) return res.status(404).json({ msg: "PDF sursă lipsă" });

    const basePdfBytes = await fs.readFile(srcPath);
    const pdfDoc = await PDFDocument.load(basePdfBytes);

    const { fontRegular } = await embedFonts(pdfDoc);

    const page = pdfDoc.getPages()[0];

    // Semnătură ca imagine (acceptăm png/jpg)
    const b64 = String(signatureImageBase64);
    const base64data = b64.includes(",") ? b64.split(",")[1] : b64;
    const imgBytes = Buffer.from(base64data, "base64");
    let sigImage;
    try {
      sigImage = await pdfDoc.embedPng(imgBytes);
    } catch {
      sigImage = await pdfDoc.embedJpg(imgBytes);
    }

    const { width, height } = sigImage.scale(1);
    const sigW = 260;
    const ratio = sigW / width;
    const sigH = height * ratio;

    page.drawImage(sigImage, { x: 50, y: 120, width: sigW, height: sigH });

    page.drawText(`Semnat de: ${signerName} (${signerEmail})`, {
      x: 50,
      y: 100,
      size: 10,
      font: fontRegular,
    });
    page.drawText(`Data: ${new Date().toLocaleString("ro-RO")}`, {
      x: 50,
      y: 86,
      size: 10,
      font: fontRegular,
    });

    const signedBytes = await pdfDoc.save();
    const { path: filePath, url } = await savePdfBuffer(
      signedBytes,
      `contract-signed-${contract._id}-${Date.now()}`
    );

    contract.status = "signed";
    contract.signerName = signerName;
    contract.signerEmail = signerEmail;
    contract.signedAt = new Date();
    contract.pdfSignedPath = filePath;
    contract.pdfSignedUrl = url;
    await contract.save();

    return res.json({ ok: true, pdfUrl: contract.pdfSignedUrl, signedAt: contract.signedAt });
  } catch (e) {
    console.error("signContract error:", e);
    return res.status(500).json({ msg: e.message || "Eroare semnare contract" });
  }
};

/** GET /api/contracts/:id/download — descarcă PDF (semnat dacă există) */
export const downloadContract = async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ msg: "Contract inexistent" });
  if (String(contract.userId) !== String(req.user.id)) {
    return res.status(403).json({ msg: "Acces interzis" });
  }

  const filePath = contract.pdfSignedPath || contract.pdfPath;
  if (!filePath) return res.status(404).json({ msg: "Fișier lipsă" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="contract-${contract._id}.pdf"`);
  res.sendFile(path.resolve(filePath));
};
