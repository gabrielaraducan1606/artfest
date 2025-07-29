import mongoose from 'mongoose';

const sellerSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  shopName: { type: String, required: true },
  description: String,
  category: String,
  logo: String,

  fullName: String,
  phone: String,
  email: String,
  address: String,

  entityType: { type: String, enum: ['persoana_fizica', 'pfa', 'srl'] },
  companyName: String,
  cui: String,
  regNumber: String,
  iban: String,

  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model('Seller', sellerSchema);
