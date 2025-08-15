// routes/contractRoutes.js
import express from 'express';
import auth from '../middleware/auth.js';
import {
  createPreview,
  getContract,
  signContract,
  downloadContract,
} from '../controllers/contractController.js';

const router = express.Router();

// Generează un preview (draft)
router.post('/preview', auth, createPreview);

// Detalii contract
router.get('/:id', auth, getContract);

// Semnare contract
router.post('/:id/sign', auth, signContract);

// Download (draft sau semnat)
router.get('/:id/download', auth, downloadContract);

export default router;
