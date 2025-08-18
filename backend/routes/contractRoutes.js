import { Router } from "express";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import Contract from "../models/Contract.js";
import Seller from "../models/Seller.js";
import { savePdfBuffer } from "../utils/pdf.js";
import { signContractPDF } from "../utils/contractTemplate.js";
import renderContractHtml from "../utils/renderContractHtml.js";
import htmlToPdfBuffer from "../utils/htmlToPdf.js";

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
function makeContractNumber(sellerDoc) {
  const d = new Date();
  const suffix = String(sellerDoc._id || "").slice(-6);
  return `${d.getFullYear()}-${suffix}-${d.getTime().toString().slice(-5)}`;
}

/** INIT: creează/restituie contract draft pentru seller (HTML -> PDF) */
router.post("/init", async (req, res, next) => {
  try {
    const anyId = getId(req);
    if (!anyId) return res.status(400).json({ msg: "sellerId lipsă (body/query/header)." });

    const seller =
      (await Seller.findById(anyId)) ||
      (await Seller.findOne({ userId: anyId }));
    if (!seller) return res.status(404).json({ msg: "Seller inexistent pentru id-ul primit." });

    let contract = await Contract.findOne({ sellerId: seller.userId, status: "draft" });
    const forceRegen = String(req.query?.regen || "").toLowerCase() === "1";

    const fileMissing = contract?.pdfPath && !fsSync.existsSync(contract.pdfPath);
    const sellerNewer =
      contract &&
      seller.updatedAt &&
      contract.updatedAt &&
      new Date(seller.updatedAt).getTime() > new Date(contract.updatedAt).getTime();

    const shouldRegen = !contract || forceRegen || fileMissing || sellerNewer;

    if (shouldRegen) {
      const data = {
        contract: { number: makeContractNumber(seller) },
        platform: {
          name: "ArtFest",
          domain: "artfest.ro",
          legalName: "ARTFEST MARKETPLACE SRL",
          representativeName: "Nume Prenume",
          address: "București, Str. ... nr. ...",
          regCom: "J00/0000/2024",
          cif: "RO12345678",
          email: "contact@artfest.ro",
          phone: "+40 31 234 56 78",
          bank: "BCR",
          iban: "RO49AAAA1B31007593840000",
        },
        seller: {
          _id: String(seller._id),
          companyName: seller.companyName || seller.shopName,
          shopName: seller.shopName,
          entityType: (seller.entityType || "").toUpperCase(), // PFA/SRL
          cui: seller.cui,
          regCom: seller.regCom,
          address: seller.address,
          city: seller.city,
          country: seller.country,
          publicEmail: seller.publicEmail,
          emailFinance: seller.emailFinance,
          phone: seller.phone,
          publicPhone: !!seller.publicPhone,
          iban: seller.iban,
          bank: seller.bank,
          representativeName: seller.representativeName,
          category: seller.category,
        },
        terms: {
          feePercent: 10,
          feeFixed: 0,
          currency: "lei",
          settlementDays: 7,
          withdrawMin: 0,
          otherFees: "",
          returnWindowDays: 14,
          noticeDays: 15,
          updateNoticeDays: 15,
          slaHours: 24,
          liabilityCapMonths: 3,
          forceMajeureNoticeDays: 5,
          jurisdictionCity: "București",
          extraNotes: "Comisionul se aplică la valoarea produselor fără taxele de livrare.",
        },
        signature: { imagePath: "", signedAt: null, ip: "" }, // draft
      };

      const html = await renderContractHtml({ ...data, now: new Date().toISOString() });
      const pdfBytes = await htmlToPdfBuffer(html);

      const baseName = `contract-${seller.userId}-${Date.now()}`;
      const { path: absPath, url } = await savePdfBuffer(pdfBytes, baseName);

      if (contract) {
        contract.pdfPath = absPath;
        contract.pdfUrl = url;
        await contract.save();
      } else {
        contract = await Contract.create({
          sellerId: seller.userId,
          status: "draft",
          pdfPath: absPath,
          pdfUrl: url,
        });
      }
    }

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
