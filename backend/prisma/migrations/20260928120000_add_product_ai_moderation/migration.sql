-- Moderare AI automată produse: coloană aditivă, nullable (fără impact pe date existente)
ALTER TABLE "Product" ADD COLUMN "aiModeration" JSONB;
