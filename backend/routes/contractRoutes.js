// src/routes/contractRoutes.js
import express from 'express';
import crypto from 'crypto';
import Contract from '../models/contract.js';
import Seller from '../models/Seller.js';
import PaymentProfile from '../models/paymentProfile.js';
import  auth from '../middleware/auth.js';
import { generateContractPDF } from '../utils/pdf.js';
import { uploadToStorage } from '../utils/storage.js';

const router = express.Router();

// POST /api/contracts/preview – creează draft pe baza datelor
router.post('/preview', auth, async (req, res) => {
  const seller = await Seller.findOne({ userId: req.user._id });
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
  const pdfUrl = await uploadToStorage(
    { buffer, originalname: 'contract-draft.pdf', mimetype: 'application/pdf' },
    `contracts/${seller._id}/draft-${Date.now()}.pdf`
  );

  const contract = await Contract.create({
    sellerId: seller._id,
    version,
    dataSnapshot: snapshot,
    pdfUrl,
    status: 'draft',
  });

  res.status(201).json(contract);
});

// GET /api/contracts/:id – pentru UI de previzualizare
router.get('/:id', auth, async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ msg: 'Contract inexistent' });
  res.json(contract);
});

// POST /api/contracts/:id/sign – finalizează cu semnătură
router.post('/:id/sign', auth, async (req, res) => {
  const { id } = req.params;
  const { signerName, signerEmail, signatureImageBase64 } = req.body;

  const contract = await Contract.findById(id);
  if (!contract) return res.status(404).json({ msg: 'Contract inexistent' });

  const { buffer } = await generateContractPDF(
    contract.dataSnapshot,
    contract.version,
    { signatureImageBase64, signerName }
  );

  const pdfUrl = await uploadToStorage(
    { buffer, originalname: 'contract-signed.pdf', mimetype: 'application/pdf' },
    `contracts/${contract.sellerId}/signed-${Date.now()}.pdf`
  );

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  contract.status = 'signed';
  contract.pdfUrl = pdfUrl;
  contract.signedAt = new Date();
  contract.signerName = signerName;
  contract.signerEmail = (signerEmail || '').toLowerCase();
  contract.audit = { ip: req.ip, userAgent: req.headers['user-agent'], hash };
  await contract.save();

  res.json({ msg: 'Semnat', contractId: contract._id, pdfUrl, hash });
});

export default router;
