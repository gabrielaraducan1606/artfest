-- CreateTable 
CREATE TABLE "CookieConsent" ( 
    "id" TEXT NOT NULL, 
    "userId" TEXT, 
    "anonymousId" VARCHAR(100), 
    "necessary" BOOLEAN NOT NULL DEFAULT true, 
    "analytics" BOOLEAN NOT NULL DEFAULT false, 
    "marketing" BOOLEAN NOT NULL DEFAULT false, 
    "consentVersion" VARCHAR(32) NOT NULL DEFAULT '1.0', 
    "action" VARCHAR(32) NOT NULL, 
    "source" VARCHAR(64), 
    "ipHash" VARCHAR(64), 
    "userAgent" VARCHAR(500), 
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, 
 
    CONSTRAINT "CookieConsent_pkey" PRIMARY KEY ("id") 
); 
 
-- CreateIndex 
CREATE INDEX "CookieConsent_userId_createdAt_idx" ON "CookieConsent"("userId", "createdAt"); 
 
-- CreateIndex 
CREATE INDEX "CookieConsent_anonymousId_createdAt_idx" ON "CookieConsent"("anonymousId", "createdAt"); 
 
-- CreateIndex 
CREATE INDEX "CookieConsent_createdAt_idx" ON "CookieConsent"("createdAt"); 
 
-- AddForeignKey 
ALTER TABLE "CookieConsent" ADD CONSTRAINT "CookieConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; 