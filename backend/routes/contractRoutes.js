// backend/routes/contractRoutes.js
import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import Contract from "../models/Contract.js";
import Seller from "../models/Seller.js";
import { savePdfBuffer } from "../utils/pdf.js";
import { buildContractForSellerPDF, signContractPDF } from "../utils/contractTemplate.js";

const router = Router();

function getId(req) {
  return (
    req.user?.id ||
    req.user?._id ||
    req.body?.sellerId ||
    req.query?.sellerId ||
    req.headers["x-user-id"] ||
    null
  );
}
function makeNumber(sellerDoc) {
  const d = new Date();
  const suffix = String(sellerDoc._id || "").slice(-6);
  return `${d.getFullYear()}-${suffix}-${d.getTime().toString().slice(-5)}`;
}

/** INIT: creează/restituie contract draft pentru seller */
router.post("/init", async (req, res, next) => {
  try {
    const anyId = getId(req);
    if (!anyId) return res.status(400).json({ msg: "sellerId lipsă (body/query/header)." });

    // acceptă fie Seller._id, fie User._id
    const seller =
      (await Seller.findById(anyId)) ||
      (await Seller.findOne({ userId: anyId }));

    if (!seller) return res.status(404).json({ msg: "Seller inexistent pentru id-ul primit." });

    // căutăm contractul draft pe baza userId (Contract.sellerId = User._id conform modelului tău)
    let contract = await Contract.findOne({ sellerId: seller.userId, status: "draft" });
    if (!contract) {
      const number = makeNumber(seller);
      const pdfBytes = await buildContractForSellerPDF({ seller, number });

      const baseName = `contract-${seller.userId}-${Date.now()}`;
      const { path: absPath, url } = await savePdfBuffer(pdfBytes, baseName);

      contract = await Contract.create({
        sellerId: seller.userId,      // rămâne ref la User conform modelului tău
        status: "draft",
        pdfPath: absPath,
        pdfUrl: url,
      });
    }

    // trimitem și câteva info utile frontend-ului
    const json = contract.toObject ? contract.toObject() : contract;
    return res.status(200).json({
      contract: {
        ...json,
        sellerDisplay: seller.shopName,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** SIGN: inserează semnătura pe PDF */
router.post("/:id/sign", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { signerName, signerEmail, signatureImageBase64, consentAccepted } = req.body || {};
    if (!signerName || !signerEmail || !consentAccepted || !signatureImageBase64) {
      return res.status(400).json({ msg: "Date semnare incomplete." });
    }

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ msg: "Contract inexistent." });
    if (!contract.pdfPath || !fsSync.existsSync(contract.pdfPath)) {
      return res.status(404).json({ msg: "PDF de semnat inexistent." });
    }

    const original = await fs.readFile(contract.pdfPath);
    const signedAt = new Date();
    const signerIp = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim();

    const outBytes = await signContractPDF({
      pdfBuffer: original,
      signaturePngBase64: signatureImageBase64,
      signerName,
      signedAt,
      signerIp,
    });

    const baseName = `contract-${id}-signed-${signedAt.getTime()}`;
    const { path: absPath, url } = await savePdfBuffer(outBytes, baseName);

    contract.status = "signed";
    contract.signerName = signerName;
    contract.signerEmail = signerEmail;
    contract.signedAt = signedAt;
    contract.pdfPath = absPath;
    contract.pdfUrl = url;
    await contract.save();

    return res.status(200).json({ pdfUrl: url, signedAt: signedAt.toISOString() });
  } catch (err) {
    next(err);
  }
});

/** DOWNLOAD: întoarce PDF curent */
router.get("/:id/download", async (req, res, next) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ msg: "Contract inexistent." });
    if (!contract.pdfPath || !fsSync.existsSync(contract.pdfPath)) {
      return res.status(404).json({ msg: "Fișier PDF inexistent." });
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="contract-${id}.pdf"`);
    return res.sendFile(path.resolve(contract.pdfPath));
  } catch (err) {
    next(err);
  }
});

export default router;
