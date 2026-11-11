// routes/geo.js
import { Router } from "express";

const router = Router();

// 41 județe + Municipiul București (ISO 3166-2:RO) - sursă unică în constants/roCounties.js
import { RO_COUNTIES as COUNTIES } from "../constants/roCounties.js";

const ALL_RO = { code: "RO-ALL", name: "Toată țara" };

router.get("/geo/ro/counties", (_req, res) => {
  const items = [...COUNTIES].sort((a, b) => a.name.localeCompare(b.name, "ro"));
  res.json({ all: ALL_RO, items });
});

export default router;
