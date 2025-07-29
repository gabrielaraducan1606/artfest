const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Înregistrare
const registerUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ msg: 'Email deja folosit.' });

    const hashedPassword = await bcrypt.hash(password, 10);

    // Verifică linia de salvare:
    const newUser = await User.create({ email, password: hashedPassword });

    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET);
    res.json({ token });

  } catch (err) {
    console.error('Eroare la înregistrare:', err);
    res.status(500).json({ msg: 'Eroare la înregistrare.' });
  }
};


// Logare
const loginUser = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: 'Utilizator inexistent.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Parolă greșită.' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ msg: 'Eroare la logare.' });
  }
};

const getProfile = async (req, res) => {
  res.json({ msg: 'Bine ai venit, utilizator!', userId: req.user.id });
};


module.exports = { registerUser, loginUser, getProfile };
