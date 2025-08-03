// utils/auth.js  (ESM)
import jwt from 'jsonwebtoken';

/**
 * Middleware: verifică tokenul Bearer și atașează req.user.
 * Cere: process.env.JWT_SECRET
 */
export function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    // opțional: suport cookie
    const cookieToken = req.cookies?.token;

    const useToken = token || cookieToken;
    if (!useToken) {
      return res.status(401).json({ msg: 'Missing token' });
    }

    const payload = jwt.verify(useToken, process.env.JWT_SECRET);
    // atașăm pe req.user ce ai pus în payload la login (ex: _id, email, role)
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ msg: 'Invalid or expired token' });
  }
}

/**
 * Helper: wrapper pentru rute async (evită try/catch repetitive)
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
