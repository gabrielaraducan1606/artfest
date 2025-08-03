import express from 'express';
import multer from 'multer';
import PaymentProfile from '../models/paymentProfile.js';
import Seller from '../models/seller.js';
import auth from '../middleware/auth.js';
import { uploadToStorage } from '../utils/storage.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 4 }, // 10MB, max 4 fișiere
});

router.post('/sellers/setup', auth, upload.any(), async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const seller = await Seller.findOne({ userId });
    if (!seller) return res.status(400).json({ msg: 'Creează mai întâi profilul de vânzător' });

    // uploads opționale
    let kycDocUrl, addressProofUrl;
    const kycDoc = req.files?.find((f) => f.fieldname === 'kycDoc');
    if (kycDoc) kycDocUrl = await uploadToStorage(kycDoc, `sellers/${userId}/kycDoc`);
    const addressProof = req.files?.find((f) => f.fieldname === 'addressProof');
    if (addressProof) addressProofUrl = await uploadToStorage(addressProof, `sellers/${userId}/addressProof`);

    // câmpuri permise din payload
    const body = {
      iban: (req.body.iban || '').trim(),
      emailFinance: (req.body.emailFinance || '').toLowerCase().trim(),
      phone: (req.body.phone || '').trim(),
      subscriptionPlan: (req.body.subscriptionPlan || 'start').toLowerCase().trim(),
      kycDocUrl: req.body.kycDocUrl || kycDocUrl,
      addressProofUrl: req.body.addressProofUrl || addressProofUrl,
    };

    const allowedPlans = ['start', 'growth', 'pro'];
    if (!allowedPlans.includes(body.subscriptionPlan)) {
      return res.status(400).json({ msg: 'subscriptionPlan invalid' });
    }
    if (!body.iban) return res.status(400).json({ msg: 'IBAN este obligatoriu' });
    if (!body.emailFinance) return res.status(400).json({ msg: 'emailFinance este obligatoriu' });

    // validare IBAN (simplă)
    const ibanRe = /^[A-Z]{2}[0-9A-Z]{13,32}$/i;
    if (!ibanRe.test(body.iban)) {
      return res.status(400).json({ msg: 'IBAN invalid' });
    }

    // create/update
    let payment = await PaymentProfile.findOne({ sellerId: seller._id });
    if (!payment) {
      payment = await PaymentProfile.create({
        sellerId: seller._id,
        ...body,
        planActivatedAt: new Date(),
        trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'active',
      });
    } else {
      payment.iban = body.iban;
      payment.emailFinance = body.emailFinance;
      payment.phone = body.phone;
      payment.subscriptionPlan = body.subscriptionPlan;
      if (body.kycDocUrl) payment.kycDocUrl = body.kycDocUrl;
      if (body.addressProofUrl) payment.addressProofUrl = body.addressProofUrl;
      await payment.save();
    }

    return res.status(201).json(payment);
  } catch (err) {
    console.warn('[payments/sellers/setup] error:', err);
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ msg: 'Fișier prea mare (max 10MB)' });
    }
    return res.status(400).json({ msg: 'Payment setup failed', error: err.message });
  }
});

export default router;
