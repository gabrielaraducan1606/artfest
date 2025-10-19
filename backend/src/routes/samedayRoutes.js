import { Router } from "express";
import { authRequired } from "../api/auth.js";
import { samedayClient } from "../services/samedayClient.js";

const router = Router();

router.get("/shipping/sameday/counties", authRequired, async (_req, res) => {
  try {
    const data = await samedayClient.getCounties();
    res.json({ items: data });
  } catch (e) {
    console.error("Sameday counties", e);
    res.json({ items: [] });
  }
});

router.get("/shipping/sameday/localities", authRequired, async (req, res) => {
  try {
    const county = String(req.query.county || "");
    const data = await samedayClient.getLocalities(county);
    res.json({ items: data });
  } catch (e) {
    console.error("Sameday localities", e);
    res.json({ items: [] });
  }
});

router.get("/shipping/sameday/postal-code", authRequired, async (req, res) => {
  // poți folosi API-ul real sau să extragi din localities
  res.json({ postalCode: "000000" });
});

router.get("/shipping/sameday/lockers", authRequired, async (_req, res) => {
  try {
    const data = await samedayClient.getLockers();
    res.json({ items: data });
  } catch (e) {
    console.error("Sameday lockers", e);
    res.json({ items: [] });
  }
});

export default router;
