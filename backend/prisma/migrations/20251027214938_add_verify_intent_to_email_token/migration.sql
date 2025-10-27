DO $$ BEGIN
  CREATE TYPE "VerifyIntent" AS ENUM ('USER', 'VENDOR');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "EmailVerificationToken"
  ADD COLUMN IF NOT EXISTS "intent" "VerifyIntent" NOT NULL DEFAULT 'USER';

-- (Opțional) dacă vrei să marchezi drept VENDOR token-urile nefolosite
-- pentru userii care AU deja Vendor, poți rula:
-- UPDATE "EmailVerificationToken" t
-- SET "intent" = 'VENDOR'
-- FROM "Vendor" v
-- WHERE v."userId" = t."userId"
--   AND t."usedAt" IS NULL;
