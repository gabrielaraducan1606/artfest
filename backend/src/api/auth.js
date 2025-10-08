// backend/src/auth.js
import jwt from "jsonwebtoken";

export function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });
}

export function authRequired(req, res, next) {
  try {
    const fromCookie = req.cookies?.token;
    const fromHeader = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;

    const token = fromCookie || fromHeader;
    if (!token) return res.status(401).json({ error: "unauthenticated" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded?.sub) return res.status(401).json({ error: "unauthenticated" });

    req.user = decoded; // { sub, role }
    next();
  } catch (e) {
    console.error("authRequired error:", e?.message || e);
    return res.status(401).json({ error: "invalid_token" });
  }
}

// 🔽🔽🔽 ADĂUGAT:
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "unauthenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}
