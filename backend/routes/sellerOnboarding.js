// routes/sellerOnboardingRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { becomeSeller, updateStep1, updateStep2, updateStep3 } from "../controllers/sellerOnboardingController.js";

const router = express.Router();

router.post("/become-seller", protect, becomeSeller);
router.put("/step-1", protect, updateStep1);
router.put("/step-2", protect, updateStep2);
router.put("/step-3", protect, updateStep3);

export default router;
