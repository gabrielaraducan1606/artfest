import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

router.get("/", async (_req, res) => {
  const types = await prisma.serviceType.findMany({ orderBy: { name: "asc" } });
  res.json({ items: types });
});

export default router;
