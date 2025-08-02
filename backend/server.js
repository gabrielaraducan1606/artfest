// server.js (ESM)
import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';

// rute
import authRoutes from './routes/authRoutes.js';
import sellerRoutes from './routes/sellerRoutes.js';
import productRoutes from './routes/productRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';    // <- dacă le folosești
import contractRoutes from './routes/contractRoutes.js';  // <- dacă le folosești

dotenv.config();

const app = express();

// opțional: CORS mai strict
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*',
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// healthcheck
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// mount routes
app.use('/api/users', authRoutes);
app.use('/api/seller', sellerRoutes);        // e.g. GET /api/seller/me, POST /api/seller
app.use('/api/products', productRoutes);
app.use('/api/payments', paymentRoutes);     // e.g. POST /api/payments/sellers/setup
app.use('/api/contracts', contractRoutes);   // e.g. POST /api/contracts/preview, POST /:id/sign

// 404
app.use((req, res) => {
  res.status(404).json({ msg: 'Not Found' });
});

// error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ msg: 'Server error' });
});

// connect & start
const { MONGO_URI = 'mongodb://localhost:27017/artfest', PORT = 4000 } = process.env;

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ Conectat la MongoDB');
    app.listen(PORT, () => {
      console.log(`🚀 Serverul rulează pe portul ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Eroare la conectarea MongoDB:', err);
    process.exit(1);
  });

// shutdown grațios (opțional)
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  process.exit(0);
});
