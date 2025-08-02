import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'seller'], default: 'user' },
  cart: [
    {
      id: String,
      title: String,
      price: String,
      image: String,
      quantity: Number
    }
  ],
  favorites: [
    {
      id: String,
      title: String,
      price: String,
      image: String
    }
  ]
});

const User = mongoose.model('User', userSchema);
export default User;
