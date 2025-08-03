import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Contract from '../models/contract.js';
import Seller from '../models/seller.js';
import PaymentProfile from '../models/paymentProfile.js';
import auth from '../middleware/auth.js';
import { generateContractPDF } from '../utils/pdf.js';

const router = express.Router();

// Folder local pentru PDF-uri
const CONTRACTS_DIR = path.resolve('storage/contracts');

// Creează un director dacă lipsește
function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  } catch (e) {
    console.error('Nu pot crea directorul:', dirPath, e);
    throw e;
  }
}

// POST /api/contracts/preview – generează draft și îl scrie pe disc
router.post('/preview', auth, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const seller = await Seller.findOne({ userId });
    if (!seller) return res.status(400).json({ msg: 'Seller inexistent' });

    const pp = await PaymentProfile.findOne({ sellerId: seller._id });
    const version = req.body.version || 'v1.0';

    const snapshot = {
      seller: {
        shopName: seller.shopName,
        username: seller.username,
        email: seller.email,
        phone: seller.phone,
        publicPhone: seller.publicPhone,
        profileImageUrl: seller.profileImageUrl,
        coverImageUrl: seller.coverImageUrl,
        shortDescription: seller.shortDescription,
        brandStory: seller.brandStory,
        category: seller.category,
        city: seller.city,
        country: seller.country,
        deliveryNotes: seller.deliveryNotes,
        returnNotes: seller.returnNotes,
        entityType: seller.entityType,
        companyName: seller.companyName,
        cui: seller.cui,
        registrationNumber: seller.registrationNumber,
        iban: seller.iban,
      },
      platform: {
        name: 'ArtFest',
        url: 'https://artfest.ro',
        plan: pp?.subscriptionPlan || 'start',
      },
    };

    const { buffer } = await generateContractPDF(snapshot, version);

    // scrie PDF pe disc
    ensureDir(CONTRACTS_DIR);
    const sellerDir = path.join(CONTRACTS_DIR, String(seller._id));
    ensureDir(sellerDir);
    const filename = `draft-${Date.now()}.pdf`;
    const filePath = path.join(sellerDir, filename);
    fs.writeFileSync(filePath, buffer);

    // salvează în DB (servim prin /download)
    const contract = await Contract.create({
      sellerId: seller._id,
      version,
      dataSnapshot: snapshot,
      pdfUrl: null,
      status: 'draft',
      pdfPath: filePath,
    });

    const apiDownloadUrl = `/api/contracts/${contract._id}/download`;
    return res.status(201).json({ ...contract.toObject(), pdfUrl: apiDownloadUrl });
  } catch (err) {
    console.error('[contracts/preview] error:', err);
    return res.status(500).json({ msg: 'Eroare la generarea draftului' });
  }
});

// GET /api/contracts/:id – încărcare pentru UI
router.get('/:id', auth, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ msg: 'Contract inexistent' });

    const apiDownloadUrl = `/api/contracts/${contract._id}/download`;
    return res.json({ ...contract.toObject(), pdfUrl: contract.pdfUrl || apiDownloadUrl });
  } catch (err) {
    console.error('[contracts/get] error:', err);
    return res.status(500).json({ msg: 'Eroare la încărcarea contractului' });
  }
});

// POST /api/contracts/:id/sign – finalizează cu semnătură și scrie PDF-ul pe disc
router.post('/:id/sign', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { signerName, signerEmail, signatureImageBase64 } = req.body || {};
    if (!signerName || !signerEmail || !signatureImageBase64) {
      return res.status(400).json({ msg: 'Câmpuri lipsă: nume/email/semnătură' });
    }

    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ msg: 'Contract inexistent' });

    const { buffer } = await generateContractPDF(
      contract.dataSnapshot,
      contract.version,
      { signatureImageBase64, signerName }
    );

    ensureDir(CONTRACTS_DIR);
    const sellerDir = path.join(CONTRACTS_DIR, String(contract.sellerId));
    ensureDir(sellerDir);
    const filename = `signed-${Date.now()}.pdf`;
    const filePath = path.join(sellerDir, filename);
    fs.writeFileSync(filePath, buffer);

    const hash = crypto.createHash('sha256').update(buffer).digest('hex');

    contract.status = 'signed';
    contract.pdfUrl = null;      // servim prin endpoint
    contract.pdfPath = filePath; // calea pe disc
    contract.signedAt = new Date();
    contract.signerName = signerName;
    contract.signerEmail = (signerEmail || '').toLowerCase();
    contract.audit = { ip: req.ip, userAgent: req.headers['user-agent'], hash };
    await contract.save();

    const apiDownloadUrl = `/api/contracts/${contract._id}/download`;
    return res.json({ msg: 'Semnat', contractId: contract._id, pdfUrl: apiDownloadUrl, hash });
  } catch (err) {
    console.error('[contracts/sign] error:', err);
    return res.status(500).json({ msg: 'Eroare la semnarea contractului' });
  }
});

// GET /api/contracts/:id/download – streaming PDF (autentificat)
router.get('/:id/download', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const contract = await Contract.findById(id);
    if (!contract) return res.status(404).json({ msg: 'Contract inexistent' });

    const filePath = contract.pdfPath;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ msg: 'Fișier PDF inexistent.' });
    }

    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="contract-${id}.pdf"`);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(filePath);
    stream.on('error', (e) => {
      console.error('Stream error:', e);
      if (!res.headersSent) res.status(500).end('Eroare la citirea fișierului');
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[contracts/download] error:', err);
    return res.status(500).json({ msg: 'Eroare la descărcare' });
  }
});

export default router;
