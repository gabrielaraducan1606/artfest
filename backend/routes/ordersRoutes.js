import { Router } from "express";
import { create } from "../controllers/ordersController.js"; // ← extensie .js obligatorie
// import auth from "../middleware/auth.js"; // dacă vrei doar user logat

const router = Router();
// router.post("/", auth, create); // DOAR user logat
router.post("/", create); // permite și guest (recomandat pt. început)

export default router;
