// backend/middlewares/ensureAuth.js
import jwt from "jsonwebtoken";
import User from "../models/user.js";

export default async function ensureAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ msg: "Neautorizat" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id).select("_id email role");
    if (!user) return res.status(401).json({ msg: "Sesiune invalidă" });

    req.user = { _id: user._id, email: user.email, role: user.role };
    next();
  } catch (e) {
    return res.status(401).json({ msg: "Neautorizat" });
  }
}
