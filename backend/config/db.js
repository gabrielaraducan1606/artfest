const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('Eroare la conectarea cu MongoDB:', error);
    process.exit(1); // închide serverul dacă baza de date nu merge
  }
};

module.exports = connectDB;
