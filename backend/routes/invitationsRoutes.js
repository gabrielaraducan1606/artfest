// backend/routes/invitationsRoutes.js
import { Router } from "express";
import mongoose from "mongoose";
import Invitation from "../models/Invitation.js";
import slugify from "slugify";

const router = Router();
export const publicRouter = Router();

/* helpers */
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
function generateSlug(payload) {
  const groom = payload?.couple?.groom || "groom";
  const bride = payload?.couple?.bride || "bride";
  const date = (payload?.date || "").replaceAll("-", "") || new Date().toISOString().slice(0,10).replaceAll("-","");
  const base = `${groom}-${bride}-${date}-${Math.random().toString(36).slice(2,6)}`;
  return slugify(base, { lower: true, strict: true });
}
function deepMerge(base = {}, extra = {}) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === "object") {
    const out = { ...base };
    for (const k of Object.keys(extra || {})) out[k] = deepMerge(base[k], extra[k]);
    return out;
  }
  return extra !== undefined ? extra : base;
}

/* defaults */
const defaultPayload = {
  couple: { bride: "", groom: "" },
  date: "",
  city: "",
  ceremony: { name:"", address:"", time:"", mapUrl:"" },
  party:    { name:"", address:"", time:"", mapUrl:"" },
  rsvp:     { phone:"", deadline:"", link:"" },
  faq: [],
  parents: [],
  godparents: [],
  storyHeadline: "",
};

/* ownership mock (activează auth când e gata) */
async function loadOwnedInvitation(req, res, next) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ error: "Invalid id" });
  const inv = await Invitation.findById(id);
  if (!inv) return res.status(404).json({ error: "Not found" });
  // if (req.user && inv.ownerId?.toString() !== req.user._id.toString()) return res.status(403).json({ error: "Forbidden" });
  req.invitation = inv;
  next();
}

/* ============ PRIVATE API (/api/invitations) ============ */
router.post("/", async (req, res, next) => {
  try {
    const payload = deepMerge(defaultPayload, req.body?.payload || {});
    const ownerId = req.user?._id || new mongoose.Types.ObjectId(); // TODO: înlocuiește cu user real
    const doc = await Invitation.create({ ownerId, payload, status: "draft" });
    res.status(201).json({ id: doc._id.toString() });
  } catch (err) { next(err); }
});

router.get("/:id", loadOwnedInvitation, async (req, res, next) => {
  try {
    const inv = req.invitation;
    res.json({
      id: inv._id.toString(),
      status: inv.status,
      payload: deepMerge(defaultPayload, inv.payload || {}),
      slug: inv.slug || null,
      updatedAt: inv.updatedAt,
      createdAt: inv.createdAt,
    });
  } catch (err) { next(err); }
});

router.put("/:id", loadOwnedInvitation, async (req, res, next) => {
  try {
    const nextPayload = deepMerge(defaultPayload, req.body?.payload || {});
    req.invitation.payload = nextPayload;
    await req.invitation.save();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post("/:id/publish", loadOwnedInvitation, async (req, res, next) => {
  try {
    const inv = req.invitation;
    if (!inv.slug) inv.slug = generateSlug(inv.payload);
    inv.status = "published";
    await inv.save();
    res.json({ slug: inv.slug });
  } catch (err) { next(err); }
});

router.post("/:id/checkout", loadOwnedInvitation, async (req, res, next) => {
  try {
    const plan = req.body?.plan || "standard";
    res.json({ checkoutUrl: `/checkout/mock/${req.params.id}?plan=${encodeURIComponent(plan)}` });
  } catch (err) { next(err); }
});

/* ============ PUBLIC API (/api/public/invitations) ============ */
publicRouter.get("/:slug", async (req, res, next) => {
  try {
    const inv = await Invitation.findOne({ slug: req.params.slug, status: "published" }).lean();
    if (!inv) return res.status(404).json({ error: "Not found" });
    res.json({
      payload: deepMerge(defaultPayload, inv.payload || {}),
      slug: inv.slug,
      createdAt: inv.createdAt,
    });
  } catch (err) { next(err); }
});

/* errors locale */
router.use((err, _req, res, _next) => {
  console.error("Invitations route error:", err);
  res.status(500).json({ error: "Server error" });
});
publicRouter.use((err, _req, res, _next) => {
  console.error("Invitations public route error:", err);
  res.status(500).json({ error: "Server error" });
});

export default router;
