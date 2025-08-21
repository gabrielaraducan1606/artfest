// backend/routes/contractsMe.js
import { Router } from "express";
import fs from "fs/promises";
import fsSync from "fs";
import Seller from "../models/Seller.js";
import Contract from "../models/Contract.js";
import ensureAuth from "../middleware/ensureAuth.js"; // ← ajustează daca ai alt path
import renderContractHtml from "../utils/renderContractHtml.js";
import htmlToPdfBuffer from "../utils/htmlToPdf.js";
import { savePdfBuffer } from "../utils/pdf.js";

const router = Router();

// ---------- helpers ----------
function buildContractData(sellerDoc) {
  return {
    contract: {
      number: `${new Date().getFullYear()}-${String(sellerDoc._id).slice(-6)}-${Date.now().toString().slice(-5)}`,
    },
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
      _id: String(sellerDoc._id),
      companyName: sellerDoc.companyName || sellerDoc.shopName,
      shopName: sellerDoc.shopName,
      entityType: (sellerDoc.entityType || "").toUpperCase(),
      cui: sellerDoc.cui,
      regCom: sellerDoc.regCom || sellerDoc.registrationNumber, // map
      address: sellerDoc.address,
      city: sellerDoc.city,
      country: sellerDoc.country,
      publicEmail: sellerDoc.publicEmail,
      emailFinance: sellerDoc.emailFinance,
      phone: sellerDoc.phone,
      publicPhone: !!sellerDoc.publicPhone,
      iban: sellerDoc.iban,
      bank: sellerDoc.bank,
      representativeName: sellerDoc.representativeName,
      category: sellerDoc.category,
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
      // câmpuri pe care le-ai folosit în template la livrare/retur:
      shipHandoverHours: 48,
      shipClaimDays: 5,
      shipReturnAddress: `${sellerDoc.address || ""}${sellerDoc.city ? ", " + sellerDoc.city : ""}${sellerDoc.country ? ", " + sellerDoc.country : ""}`,
      extraNotes: "Comisionul se aplică la valoarea produselor fără taxele de livrare.",
    },
    signature: { imagePath: "", signedAt: null, ip: "" },
    now: new Date().toISOString(),
  };
}

async function regenerateDraftForSeller(sellerDoc) {
  const data = buildContractData(sellerDoc);
  const html = await renderContractHtml(data);      // folosește contract.ro.html (ai deja în utils)
  const pdfBytes = await htmlToPdfBuffer(html);
  const { path: absPath, url } = await savePdfBuffer(pdfBytes, `contract-${sellerDoc.userId}-${Date.now()}`);

  let draft = await Contract.findOne({ sellerId: sellerDoc.userId, status: "draft" });
  if (!draft) {
    draft = await Contract.create({ sellerId: sellerDoc.userId, status: "draft", pdfPath: absPath, pdfUrl: url });
  } else {
    draft.pdfPath = absPath;
    draft.pdfUrl  = url;
    await draft.save();
  }
  return { url, draft };
}

// ---------- routes ----------

// Rezumat (pentru Setari.jsx)
router.get("/me/summary", ensureAuth, async (req, res) => {
  const master = await Contract.findOne({ sellerId: req.user._id, status: "signed" }).lean();
  const draft  = await Contract.findOne({ sellerId: req.user._id, status: "draft"  }).lean();
  res.json({
    master: master ? { url: master.pdfUrl, signedAt: master.signedAt, updatedAt: master.updatedAt } : null,
    draft:  draft  ? { url: draft.pdfUrl,  updatedAt: draft.updatedAt } : null,
  });
});

// Regenerare manuală (butonul din Setări)
router.post("/me/regenerate", ensureAuth, async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) return res.status(404).json({ msg: "Seller inexistent." });

  const { url, draft } = await regenerateDraftForSeller(seller);
  res.json({ url, updatedAt: draft.updatedAt });
});

// Anexă IBAN + regen draft
router.post("/me/annex/bank", ensureAuth, async (req, res) => {
  const { bank, iban } = req.body || {};
  if (!bank || !iban) return res.status(400).json({ msg: "Lipsește banca sau IBAN." });

  let seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) return res.status(404).json({ msg: "Seller inexistent." });

  // 1) update profil (bump updatedAt)
  seller.bank = bank;
  seller.iban = iban;
  seller.updatedAt = new Date();
  await seller.save();

  // 2) generează anexă (simplu; înlocuiește cu template propriu dacă vrei)
  const annexHtml = `
    <html><body style="font-family:Arial,sans-serif;">
      <h1>Anexa IBAN</h1>
      <p>Magazin: <strong>${seller.shopName}</strong></p>
      <p>Banca: <strong>${bank}</strong></p>
      <p>IBAN: <strong>${iban}</strong></p>
      <small>${new Date().toLocaleString()}</small>
    </body></html>
  `;
  const annexPdf = await htmlToPdfBuffer(annexHtml);
  const { url: annexUrl } = await savePdfBuffer(annexPdf, `annex-iban-${seller.userId}-${Date.now()}`);

  // 3) recitește seller-ul și regenerează draftul
  seller = await Seller.findById(seller._id);
  const { url: draftUrl, draft } = await regenerateDraftForSeller(seller);

  res.json({ url: annexUrl, draftUrl, updatedAt: draft.updatedAt });
});

// Amendament profil + regen draft
router.post("/me/amendment/profile", ensureAuth, async (req, res) => {
  const fields = req.body?.fields || {};
  let seller = await Seller.findOne({ userId: req.user._id });
  if (!seller) return res.status(404).json({ msg: "Seller inexistent." });

  const allowed = [
    "shopName","bank","iban","address","city","country",
    "cui","regCom","registrationNumber","companyName","entityType",
    "emailFinance","publicEmail","phone","representativeName","category"
  ];

  for (const k of allowed) {
    if (k in fields && fields[k] !== "") {
      if (k === "registrationNumber") seller.regCom = fields[k]; // map
      else seller[k] = fields[k];
    }
  }
  seller.updatedAt = new Date();
  await seller.save();

  // PDF amendament (simplu)
  const list = Object.entries(fields).map(([k, v]) => `<li><strong>${k}</strong>: ${v}</li>`).join("");
  const amendHtml = `
    <html><body style="font-family:Arial,sans-serif;">
      <h1>Amendament profil</h1>
      <ul>${list}</ul>
      <small>${new Date().toLocaleString()}</small>
    </body></html>
  `;
  const amendPdf = await htmlToPdfBuffer(amendHtml);
  const { url: amendUrl } = await savePdfBuffer(amendPdf, `amendment-${seller.userId}-${Date.now()}`);

  // recitește și regenerează draftul
  seller = await Seller.findById(seller._id);
  const { url: draftUrl, draft } = await regenerateDraftForSeller(seller);

  res.json({ url: amendUrl, draftUrl, updatedAt: draft.updatedAt });
});

export default router;
