-- Email la mesaj nou (anti-spam: un singur email până când destinatarul
-- citește conversația). Strict aditiv: două coloane nullable, fără backfill.
-- AlterTable
ALTER TABLE "MessageThread" ADD COLUMN     "userMessageEmailAt" TIMESTAMP(3),
ADD COLUMN     "vendorMessageEmailAt" TIMESTAMP(3);
