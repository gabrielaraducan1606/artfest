// backend/src/modules/invitations/invitation.routes.js
import { Router } from "express";
import mongoose from "mongoose";
import Invitation from "../models/invitation.js";
// import { authRequired } from "../../middlewares/auth.js"; // activează când ai auth
import slugify from "slugify";

const router = Router();

/* ------------------------- helpers ------------------------- */
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
    for (const k of Object.keys(extra || {})) {
      out[k] = deepMerge(base[k], extra[k]);
    }
    return out;
  }
  return extra !== undefined ? extra : base;
}

/* ------------------------- defaults ------------------------ */
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

/* -------------------- ownership middleware ----------------- */
async function loadOwnedInvitation(req, res, next) {
  const { id } = req.params;
  if (!isValidObjectId(id)) return res.status(400).json({ error: "Invalid id" });

  const inv = await Invitation.findById(id);
  if (!inv) return res.status(404).json({ error: "Not found" });

  // dacă ai auth, verifică ownerId
  if (req.user && inv.ownerId?.toString() !== req.user._id.toString()) {
    return res.status(403).json({ error: "Forbidden" });
  }
  // dacă NU ai auth încă, sari peste verificare (dar recomandat e să o ai)
  req.invitation = inv;
  next();
}

/* ========================= ROUTES ========================== */

/** Create draft */
router.post(
  "/",
  // authRequired, // <— activează când ai login
  async (req, res, next) => {
    try {
      const payload = deepMerge(defaultPayload, req.body?.payload || {});
      const ownerId = req.user?._id || new mongoose.Types.ObjectId(); // TODO: înlocuiește când ai auth
      const doc = await Invitation.create({ ownerId, payload, status: "draft" });
      return res.status(201).json({ id: doc._id.toString() });
    } catch (err) { next(err); }
  }
);

/** Get draft (owned) */
router.get(
  "/:id",
  // authRequired,
  loadOwnedInvitation,
  async (req, res, next) => {
    try {
      const inv = req.invitation;
      return res.json({
        id: inv._id.toString(),
        status: inv.status,
        payload: deepMerge(defaultPayload, inv.payload || {}),
        slug: inv.slug || null,
        updatedAt: inv.updatedAt,
        createdAt: inv.createdAt,
      });
    } catch (err) { next(err); }
  }
);

/** Update draft (autosave) */
router.put(
  "/:id",
  // authRequired,
  loadOwnedInvitation,
  async (req, res, next) => {
    try {
      const nextPayload = deepMerge(defaultPayload, req.body?.payload || {});
      req.invitation.payload = nextPayload;
      await req.invitation.save();
      return res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

/** Publish (assign slug) */
router.post(
  "/:id/publish",
  // authRequired,
  loadOwnedInvitation,
  async (req, res, next) => {
    try {
      const inv = req.invitation;

      // TODO: verifică plată dacă e cazul (inv.payment?.paid === true)
      if (!inv.slug) {
        inv.slug = generateSlug(inv.payload);
      }
      inv.status = "published";
      await inv.save();

      return res.json({ slug: inv.slug });
    } catch (err) { next(err); }
  }
);

/** Checkout (placeholder – întoarce un URL de plată/mock) */
router.post(
  "/:id/checkout",
  // authRequired,
  loadOwnedInvitation,
  async (req, res, next) => {
    try {
      const plan = req.body?.plan || "standard";
      // TODO: creează intent la procesator (Stripe/Netopia/PlatiOnline/etc) și salvează în inv.payment
      return res.json({
        checkoutUrl: `/checkout/mock/${req.params.id}?plan=${encodeURIComponent(plan)}`
      });
    } catch (err) { next(err); }
  }
);

/* -------------------- Public route by slug ------------------ */
/**
 * Montează asta în app.js pe /api/public/invitations
 * app.use("/api/public/invitations", publicRouter)
 */
export const publicRouter = Router();

publicRouter.get("/:slug", async (req, res, next) => {
  try {
    const inv = await Invitation.findOne({ slug: req.params.slug, status: "published" }).lean();
    if (!inv) return res.status(404).json({ error: "Not found" });
    return res.json({
      payload: deepMerge(defaultPayload, inv.payload || {}),
      slug: inv.slug,
      createdAt: inv.createdAt,
    });
  } catch (err) { next(err); }
});

/* ---------------------- error handling ---------------------- */
router.use((err, _req, res, _next) => {
  console.error("Invitations route error:", err);
  res.status(500).json({ error: "Server error" });
});

publicRouter.use((err, _req, res, _next) => {
  console.error("Invitations public route error:", err);
  res.status(500).json({ error: "Server error" });
});

export default router;
