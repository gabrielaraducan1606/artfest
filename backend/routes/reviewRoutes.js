// backend/routes/reviewRoutes.js
import express from "express";
import Review from "../models/review.js";
import auth from "../middleware/auth.js";

const router = express.Router();

// Recenziile unui vânzător (public)
router.get("/seller/:id", async (req, res) => {
  try {
    const reviews = await Review.find({ sellerId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(parseInt(req.query.limit) || 10);
    res.json(reviews);
  } catch (err) {
    console.error("Eroare GET /reviews/seller/:id:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// Adaugă o recenzie (doar utilizator logat)
router.post("/seller/:id", auth, async (req, res) => {
  try {
    const { rating, comment } = req.body;
    if (!rating) {
      return res.status(400).json({ msg: "Rating-ul este obligatoriu" });
    }

    const review = new Review({
      sellerId: req.params.id,
      userId: req.user.id,
      userName: req.user.name || "Anonim",
      rating,
      comment
    });

    await review.save();
    res.status(201).json(review);
  } catch (err) {
    console.error("Eroare POST /reviews/seller/:id:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// Rating mediu pentru un vânzător
router.get("/seller/:id/average", async (req, res) => {
  try {
    const reviews = await Review.find({ sellerId: req.params.id });

    if (reviews.length === 0) {
      return res.json({ average: 0, count: 0 });
    }

    const average =
      reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length;

    res.json({ average: parseFloat(average.toFixed(1)), count: reviews.length });
  } catch (err) {
    console.error("Eroare GET /reviews/seller/:id/average:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

export default router;
