const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user'); 
require('dotenv').config();

const router = express.Router();

// Ruta pentru crearea unui cont
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  try {
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Emailul există deja!' });
    }

    // Criptarea parolei
    const hashedPassword = await bcrypt.hash(password, 10);

    // Crearea utilizatorului în baza de date
    const user = new User({ name, email, password: hashedPassword });
    await user.save();

    // Generarea token-ului JWT
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.status(201).json({ success: true, message: 'Cont creat cu succes!', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Eroare la crearea contului!' });
  }
});

// Ruta pentru logare (autentificare)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Email sau parolă incorectă!' });
    }

    // Comparăm parola introdusă cu parola criptată
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Email sau parolă incorectă!' });
    }

    // Generăm token-ul JWT
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.json({ success: true, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Eroare la logare!' });
  }
});

module.exports = router;
