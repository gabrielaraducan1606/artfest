import { Router } from "express";

import assistantProductsRouter from "./assistant/assistantProductsRoutes.js";
import assistantSupportRouter from "./assistant/assistantSupportRoutes.js";
import assistantQuotesRouter from "./assistant/assistantQuotesRoutes.js";
import assistantChatRouter from "./assistant/assistantChatRoutes.js";

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

/*
 * Ruta AI conversațională generală.
 *
 * În assistantChatRoutes.js avem:
 * POST /chat
 *
 * Pentru că acest router este deja montat în server la:
 * /api/assistant
 *
 * ruta finală devine:
 * POST /api/assistant/chat
 */
router.use(
  "/",
  assistantChatRouter
);

export default router;