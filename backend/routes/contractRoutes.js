// backend/routes/contractRoutes.js (fără requireAuth)
import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import Contract from "../models/Contract.js";
import { savePdfBuffer } from "../utils/pdf.js";

/** PDF demo minimal – înlocuiește cu generatorul tău real oricând */
function createMinimalPdf(text = "Contract") {
  const body = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 64>>stream
BT /F1 24 Tf 72 700 Td (${text}) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000061 00000 n 
0000000116 00000 n 
0000000234 00000 n 
0000000361 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
430
%%EOF`;
  return Buffer.from(body, "utf8");
}

/** Helper: extrage sellerId din ce e disponibil ca să nu mai depindem de auth middleware */
function getSellerId(req) {
  return (
    req.user?.id ||
    req.user?._id ||
    req.body?.sellerId ||
    req.query?.sellerId ||
    req.headers["x-user-id"] || // fallback
    null
  );
}

const router = Router();

/** POST /api/contracts/init
 * Creează (sau reîntoarce) un contract draft pentru sellerId și generează un PDF inițial.
 * Răspuns: { contract }
 */
router.post("/init", async (req, res, next) => {
  try {
    const sellerId = getSellerId(req);
    if (!sellerId) {
      return res
        .status(400)
        .json({ msg: "sellerId lipsă. Trimite-l în body { sellerId }, sau query ?sellerId=..., sau header x-user-id." });
    }

    let contract = await Contract.findOne({ sellerId, status: "draft" }).lean();

    if (!contract) {
      const baseName = `contract-${sellerId}-${Date.now()}`;
      const pdfBytes = createMinimalPdf(`Contract seller ${sellerId}`);
      const { path: absPath, url } = await savePdfBuffer(pdfBytes, baseName);

      const doc = await Contract.create({
        sellerId,
        status: "draft",
        pdfPath: absPath,
        pdfUrl: url,
      });
      contract = doc.toObject();
    }

    return res.status(200).json({ contract });
  } catch (err) {
    next(err);
  }
});

/** POST /api/contracts/:id/sign
 * Body: { signerName, signerEmail, signatureImageBase64, consentAccepted }
 * Răspuns: { pdfUrl, signedAt }
 */
router.post("/:id/sign", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { signerName, signerEmail, signatureImageBase64, consentAccepted } = req.body || {};
    if (!signerName || !signerEmail || !consentAccepted || !signatureImageBase64) {
      return res.status(400).json({ msg: "Date semnare incomplete." });
    }

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ msg: "Contract inexistent." });

    // (Demo) generează un nou PDF „semnat”
    const signedAt = new Date();
    const baseName = `contract-${id}-signed-${signedAt.getTime()}`;
    const pdfBytes = createMinimalPdf(`Contract SIGNED de ${signerName} la ${signedAt.toISOString()}`);
    const { path: absPath, url } = await savePdfBuffer(pdfBytes, baseName);

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

/** GET /api/contracts/:id/download
 * Descarcă PDF-ul curent (draft sau semnat)
 */
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
