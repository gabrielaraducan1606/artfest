// middleware/auth.js (ESM)
import jwt from 'jsonwebtoken';

const auth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ msg: 'Token lipsă' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Normalizează forma id-ului pentru compatibilitate
    const id = decoded.id || decoded._id;
    if (!id) return res.status(401).json({ msg: 'Token invalid' });

    req.user = { ...decoded, id, _id: id };
    next();
  } catch (err) {
    return res.status(401).json({ msg: 'Token invalid' });
  }
};

export default auth;
