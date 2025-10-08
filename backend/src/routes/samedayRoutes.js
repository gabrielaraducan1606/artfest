// backend/src/routes/samedayRoutes.js
import { Router } from "express";
import { authRequired } from "../api/auth.js";

const router = Router();

// TODO: înlocuiește cu apeluri reale spre Sameday
router.get("/shipping/sameday/counties", authRequired, async (_req, res) => {
  res.json({ items: [
    { code: "B", name: "București" },
    { code: "IF", name: "Ilfov" },
    { code: "CJ", name: "Cluj" },
  ]});
});

router.get("/shipping/sameday/localities", authRequired, async (req, res) => {
  const county = String(req.query.county || "");
  const map = {
    B: [{ name: "Sector 1" }, { name: "Sector 2" }, { name: "Sector 3" }],
    IF: [{ name: "Otopeni" }, { name: "Voluntari" }],
    CJ: [{ name: "Cluj-Napoca" }, { name: "Florești" }],
  };
  res.json({ items: map[county] || [] });
});

router.get("/shipping/sameday/postal-code", authRequired, async (req, res) => {
  const { county, locality } = req.query;
  // mock simplu
  const code = locality === "Cluj-Napoca" ? "400000" :
               locality === "Otopeni" ? "075100" :
               locality?.toString().toLowerCase().includes("sector") ? "01xxxx" : "000000";
  res.json({ postalCode: code });
});

router.get("/shipping/sameday/lockers", authRequired, async (req, res) => {
  // poți folosi county/locality sau lat/lng pentru filtrare
  res.json({ items: [
    { id: "LK1", name: "Easybox Mega Mall", address: "Bd. Pierre de Coubertin 3-5", lat: 44.442, lng: 26.151 },
    { id: "LK2", name: "Easybox Sun Plaza", address: "Calea Văcărești 391", lat: 44.391, lng: 26.114 },
  ]});
});

export default router;
