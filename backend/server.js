// server.js (ESM)
import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import expressPkg from 'express'; // pentru debug pe Router

// rute
import authRoutes from './routes/authRoutes.js';
import sellerRoutes from './routes/sellerRoutes.js';
import productRoutes from './routes/productRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import contractRoutes from './routes/contractRoutes.js';

dotenv.config();

const app = express();

/* ===================== DEBUG ROUTE PATCH (o singură dată) ===================== */
if (!app._routeDebugPatched) {
  function findCallerInStack(stack) {
    const lines = String(stack).split('\n');
    const hit =
      lines.find(l => l.includes('\\backend\\')) ||
      lines.find(l => l.includes('/backend/')) ||
      lines[1] ||
      lines[0];
    return hit;
  }
  function wrapReg(obj, methodName) {
    const orig = obj[methodName].bind(obj);
    obj[methodName] = (...args) => {
      const first = args[0];
      if (typeof first === 'string') {
        const s = first;
        const looksLikeWinPath = /^[A-Za-z]:[\\/]/.test(s);   // ex: C:\...
        const looksLikeURL     = /^https?:\/\//i.test(s);     // ex: https://...
        const hasBadColon = /\/:(?![A-Za-z_])/.test(s);   // ex: /:/download
        if (looksLikeWinPath || looksLikeURL || hasBadColon) {
          const err = new Error(`Route path invalid pentru ${methodName}: "${s}"`);
          const caller = findCallerInStack(err.stack);
          console.error(`[BAD ${methodName}]`, s);
          console.error(' ↳ definit aici:', caller);
          throw err;
        } else {
          // console.log(`[mount ${methodName}]`, s); // deblochează dacă vrei logging complet
        }
      }
      return orig(...args);
    };
  }
  ['use','get','post','put','patch','delete','options','all'].forEach((m)=>wrapReg(app, m));

  const RouterProto = expressPkg.Router && expressPkg.Router().constructor.prototype;
  if (RouterProto) {
    ['use','get','post','put','patch','delete','options','all'].forEach((m)=>{
      if (typeof RouterProto[m] === 'function') wrapReg(RouterProto, m);
    });
  }

  app._routeDebugPatched = true;
}
/* =================== /DEBUG ROUTE PATCH (o singură dată) ===================== */

// CORS (vite: 5173)
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : ['http://localhost:5173'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  allowedHeaders: ['Content-Type','Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Asigură existența folderului pentru contracte
const CONTRACTS_DIR = path.resolve('storage/contracts');
if (!fs.existsSync(CONTRACTS_DIR)) {
  fs.mkdirSync(CONTRACTS_DIR, { recursive: true });
  console.log(`📂 Folder creat: ${CONTRACTS_DIR}`);
}

// healthcheck
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// mount routes
app.use('/api/users', authRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/contracts', contractRoutes);

// 404
app.use((req, res) => res.status(404).json({ msg: 'Not Found' }));

// error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ msg: 'Server error' });
});

// connect & start
const { MONGO_URI = 'mongodb://localhost:27017/artfest', PORT = 5000 } = process.env;

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('✅ Conectat la MongoDB');
    app.listen(PORT, () => console.log(`🚀 Serverul rulează pe portul ${PORT}`));
  })
  .catch(err => {
    console.error('❌ Eroare la conectarea MongoDB:', err);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  await mongoose.connection.close();
  process.exit(0);
});
