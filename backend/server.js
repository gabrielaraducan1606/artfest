// server.js (ESM-style)
import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import sellerRoutes from './routes/sellerRoutes.js';
import productRoutes from './routes/productRoutes.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Use routes
app.use('/api/users', authRoutes);

//Seller routes
app.use('/api/seller', sellerRoutes);
app.use('/api/products', productRoutes);

// Connect to DB and start server
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Conectat la MongoDB');
    app.listen(process.env.PORT, () => {
      console.log(`🚀 Serverul rulează pe portul ${process.env.PORT}`);
    });
  })
  .catch(err => console.error('❌ Eroare la conectare:', err));
