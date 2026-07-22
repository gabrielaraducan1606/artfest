import { Router } from "express";

import assistantProductsRouter from "./assistant/assistantProductsRoutes.js";
import assistantSupportRouter from "./assistant/assistantSupportRoutes.js";
import assistantQuotesRouter from "./assistant/assistantQuotesRoutes.js";

const router = Router();

router.use(
  "/products",
  assistantProductsRouter
);

router.use(
  "/support",
  assistantSupportRouter
);

router.use(
  "/quotes",
  assistantQuotesRouter
);

export default router;