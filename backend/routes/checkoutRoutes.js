import { Router } from "express";
import { quote } from "../controllers/checkoutController.js"; // ← extensia .js este obligatorie în ESM

const router = Router();
router.post("/quote", quote);
export default router;
