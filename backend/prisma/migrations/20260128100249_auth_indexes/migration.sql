-- DropIndex
DROP INDEX "public"."EmailVerificationToken_purpose_idx";

-- DropIndex
DROP INDEX "public"."EmailVerificationToken_userId_usedAt_createdAt_idx";

-- DropIndex
DROP INDEX "public"."LoginAttempt_email_createdAt_idx";

-- DropIndex
DROP INDEX "public"."LoginAttempt_success_createdAt_idx";

-- CreateIndex
CREATE INDEX "evt_user_purpose_used_created_idx" ON "EmailVerificationToken"("userId", "purpose", "usedAt", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempt_email_success_created_idx" ON "LoginAttempt"("email", "success", "createdAt");

-- RenameIndex
ALTER INDEX "EmailVerificationToken_userId_expiresAt_idx" RENAME TO "evt_user_expires_idx";
