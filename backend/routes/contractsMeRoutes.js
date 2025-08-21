// backend/routes/contractsMe.js
import { Router } from "express";
import mongoose from "mongoose";
import Seller from "../models/Seller.js";
import Contract from "../models/Contract.js";
import ensureAuth from "../middleware/ensureAuth.js";
import renderContractHtml from "../utils/renderContractHtml.js";
import htmlToPdfBuffer from "../utils/htmlToPdf.js";
import { savePdfBuffer } from "../utils/pdf.js";

const router = Router();

async function getSellerOr404(userId, res) {
  const seller = await Seller.findOne({ userId });
  if (!seller) {
    res.status(404).json({ msg: "Seller inexistent pentru utilizator." });
    return null;
  }
  if (!seller.userId) {
    res.status(409).json({ msg: "Seller fără userId asociat." });
    return null;
  }
  return seller;
}

// GET /contracts/me/summary
router.get("/me/summary", ensureAuth, async (req, res, next) => {
  try {
    const seller = await getSellerOr404(req.user._id, res);
    if (!seller) return;

    const draft = await Contract.findOne({ sellerId: seller.userId, status: "draft" }).sort({ updatedAt: -1 });
    const master = await Contract.findOne({ sellerId: seller.userId, status: "signed" }).sort({ signedAt: -1 });

    return res.json({
      draft: draft ? { id: draft._id, url: draft.pdfUrl, updatedAt: draft.updatedAt } : null,
      master: master ? { id: master._id, url: master.pdfUrl, updatedAt: master.updatedAt, signedAt: master.signedAt } : null,
    });
  } catch (e) { next(e); }
});

// POST /contracts/me/regenerate
router.post("/me/regenerate", ensureAuth, async (req, res, next) => {
  try {
    const seller = await getSellerOr404(req.user._id, res);
    if (!seller) return;

    const data = {
      contract: { number: `${new Date().getFullYear()}-${String(seller._id).slice(-6)}-${Date.now().toString().slice(-5)}` },
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
        entityType: (seller.entityType || "").toUpperCase(),
        cui: seller.cui,
        regCom: seller.regCom || seller.registrationNumber,
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
        feePercent: 10, feeFixed: 0, currency: "lei", settlementDays: 7, withdrawMin: 0, otherFees: "",
        returnWindowDays: 14, noticeDays: 15, updateNoticeDays: 15, slaHours: 24,
        liabilityCapMonths: 3, forceMajeureNoticeDays: 5, jurisdictionCity: "București",
        extraNotes: "Comisionul se aplică la valoarea produselor fără taxele de livrare.",
        shipHandoverHours: 48, shipClaimDays: 5, shipReturnAddress: `${seller.address}, ${seller.city}, ${seller.country}`,
      },
      signature: { imagePath: "", signedAt: null, ip: "" },
      now: new Date().toISOString(),
    };

    const html = await renderContractHtml(data);
    const pdf = await htmlToPdfBuffer(html);

    let draft = await Contract.findOne({ sellerId: seller.userId, status: "draft" });
    const baseName = `contract-${seller.userId}-${Date.now()}`;
    const { path, url } = await savePdfBuffer(pdf, baseName);

    if (!draft) {
      draft = await Contract.create({ sellerId: seller.userId, status: "draft", pdfPath: path, pdfUrl: url });
    } else {
      draft.pdfPath = path; draft.pdfUrl = url; await draft.save();
    }
    return res.json({ id: draft._id, url: draft.pdfUrl });
  } catch (e) {
    console.error("[contracts/me/regenerate] error:", e);
    next(e);
  }
});

// POST /contracts/me/annex/bank  { bank, iban }
router.post("/me/annex/bank", ensureAuth, async (req, res, next) => {
  try {
    const { bank, iban } = req.body || {};
    if (!bank || !iban) return res.status(400).json({ msg: "Lipsește banca sau IBAN-ul." });

    const seller = await getSellerOr404(req.user._id, res);
    if (!seller) return;

    const html = `
<!doctype html><html><head><meta charset="utf-8"/><style>
body{font-family:DejaVu,Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45;color:#111}
h1{font-size:18px;margin:0 0 10px} .small{color:#444;font-size:11px}
.table{width:100%;border-collapse:collapse} .table td{padding:6px;vertical-align:top}
.hr{border-top:1px solid #000;margin:12px 0}
</style></head><body>
<h1>Anexă la contract – Modificare cont bancar</h1>
<p class="small">Vânzător: <strong>${seller.companyName || seller.shopName}</strong></p>
<div class="hr"></div>
<table class="table">
  <tr><td style="width:160px">Cont bancar anterior</td><td>${seller.bank || "—"} / ${seller.iban || "—"}</td></tr>
  <tr><td>Cont bancar nou</td><td><strong>${bank}</strong> / <strong>${iban}</strong></td></tr>
  <tr><td>Dată</td><td>${new Date().toLocaleString("ro-RO")}</td></tr>
</table>
<p>Prezenta anexă intră în vigoare de la data semnării electronice și devine parte integrantă a contractului de colaborare.</p>
</body></html>`;

    const pdf = await htmlToPdfBuffer(html);
    const baseName = `annex-bank-${seller.userId}-${Date.now()}`;
    const { url } = await savePdfBuffer(pdf, baseName);

    // actualizează și profilul sellerului (opțional, deja o faci din UI separat)
    seller.bank = bank; seller.iban = iban; await seller.save();

    return res.json({ url });
  } catch (e) { next(e); }
});

// POST /contracts/me/amendment/profile  { fields: { ... } }
router.post("/me/amendment/profile", ensureAuth, async (req, res, next) => {
  try {
    const fields = req.body?.fields || {};
    if (!fields || typeof fields !== "object") {
      return res.status(400).json({ msg: "Lipsește obiectul fields." });
    }

    const seller = await getSellerOr404(req.user._id, res);
    if (!seller) return;

    // construiește tabel cu modificări
    const rows = Object.entries(fields).map(([k, v]) => {
      const before = seller[k] ?? "—";
      const after = v ?? "—";
      return `<tr><td style="width:200px">${k}</td><td>${before}</td><td><strong>${after}</strong></td></tr>`;
    }).join("");

    const html = `
<!doctype html><html><head><meta charset="utf-8"/><style>
body{font-family:DejaVu,Arial,Helvetica,sans-serif;font-size:12px;line-height:1.45;color:#111}
h1{font-size:18px;margin:0 0 10px} .small{color:#444;font-size:11px}
.table{width:100%;border-collapse:collapse} .table th,.table td{padding:6px;border:1px solid #ddd;vertical-align:top}
</style></head><body>
<h1>Amendament – Actualizare date profil</h1>
<p class="small">Vânzător: <strong>${seller.companyName || seller.shopName}</strong> &nbsp;|&nbsp; Data: ${new Date().toLocaleString("ro-RO")}</p>
<table class="table">
  <thead><tr><th>Câmp</th><th>Anterior</th><th>Nou</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p>Amendamentul intră în vigoare la data semnării electronice și devine parte integrantă a contractului.</p>
</body></html>`;
    const pdf = await htmlToPdfBuffer(html);
    const baseName = `amendment-profile-${seller.userId}-${Date.now()}`;
    const { url } = await savePdfBuffer(pdf, baseName);

    // opțional: scrie efectiv modificările în DB aici sau la alt pas de „confirm”
    Object.assign(seller, fields);
    await seller.save();

    return res.json({ url });
  } catch (e) { next(e); }
});

export default router;
