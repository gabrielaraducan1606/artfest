// src/routes/paymentRoutes.js
import express from 'express';
import multer from 'multer';
import PaymentProfile from '../models/paymentProfile.js';
import Seller from '../models/Seller.js';
import  auth  from '../middleware/auth.js';
import { uploadToStorage } from '../utils/storage.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/sellers/setup', auth, upload.any(), async (req, res) => {
  try {
    const seller = await Seller.findOne({ userId: req.user._id });
    if (!seller) return res.status(400).json({ msg: 'Creează mai întâi profilul de vânzător' });

    // uploads opționale
    let kycDocUrl, addressProofUrl;
    const kycDoc = req.files?.find(f => f.fieldname === 'kycDoc');
    if (kycDoc) kycDocUrl = await uploadToStorage(kycDoc, `sellers/${req.user._id}/kycDoc`);
    const addressProof = req.files?.find(f => f.fieldname === 'addressProof');
    if (addressProof) addressProofUrl = await uploadToStorage(addressProof, `sellers/${req.user._id}/addressProof`);

    // câmpuri permise din payload
    const body = {
      iban: req.body.iban,
      emailFinance: req.body.emailFinance?.toLowerCase(),
      phone: req.body.phone,
      subscriptionPlan: (req.body.subscriptionPlan || 'start').toLowerCase(),
      // KYC (dacă nu sunt upload, pot veni ca link)
      kycDocUrl: req.body.kycDocUrl || kycDocUrl,
      addressProofUrl: req.body.addressProofUrl || addressProofUrl,
    };

    if (!['start', 'growth', 'pro'].includes(body.subscriptionPlan)) {
      return res.status(400).json({ msg: 'subscriptionPlan invalid' });
    }
    if (!body.iban) return res.status(400).json({ msg: 'IBAN este obligatoriu' });
    if (!body.emailFinance) return res.status(400).json({ msg: 'emailFinance este obligatoriu' });

    // create/update cu setarea trial-ului dacă nu există
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
      // dacă s-a schimbat planul, poți decide să reinițializezi trialul sau nu — aici NU îl resetăm
      payment.iban = body.iban;
      payment.emailFinance = body.emailFinance;
      payment.phone = body.phone;
      payment.subscriptionPlan = body.subscriptionPlan;
      if (body.kycDocUrl) payment.kycDocUrl = body.kycDocUrl;
      if (body.addressProofUrl) payment.addressProofUrl = body.addressProofUrl;
      await payment.save();
    }

    res.status(201).json(payment);
  } catch (err) {
    console.warn(err);
    res.status(400).json({ msg: 'Payment setup failed', error: err.message });
  }
});

export default router;
