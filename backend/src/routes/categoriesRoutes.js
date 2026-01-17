// backend/src/routes/public/categories.js
import express from "express";
import { CATEGORIES_DETAILED, CATEGORY_SET } from "../constants/categories.js";

const router = express.Router();

router.get("/categories", (req, res) => {
  // trimitem doar cheile din CATEGORIES (valid set)
  const items = CATEGORIES_DETAILED.filter((c) => CATEGORY_SET.has(c.key));
  res.json({ items });
});

export default router;
