// routes/searchRoutes.js
import express from "express";
import {
  getSuggestions,
  searchProducts,
  searchShops,
  searchFacets,
  searchCombined,
} from "../controllers/searchController.js";

const router = express.Router();

router.get("/suggestions", getSuggestions);
router.get("/products", searchProducts);
router.get("/shops", searchShops);
router.get("/facets", searchFacets);
router.get("/", searchCombined); // agregat (opțional)

export default router;
