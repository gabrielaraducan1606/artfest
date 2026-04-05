-- CreateIndex
CREATE INDEX "fav_user_created_desc_pid_desc" ON "Favorite"("userId", "createdAt" DESC, "productId" DESC);
