import express from "express";
import { stripeWebhookHandler } from "../payments/stripe.webhooks.js";
import { stripeRawBody } from "../middleware/rawBodyMiddleware.js";

const router = express.Router();

router.post("/webhook", stripeRawBody, stripeWebhookHandler);

export default router;
