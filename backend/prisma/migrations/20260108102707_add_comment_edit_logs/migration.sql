-- CreateTable
CREATE TABLE "CommentEditLog" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "editorId" TEXT,
    "oldText" TEXT,
    "newText" TEXT,
    "reason" TEXT DEFAULT 'USER_EDIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentEditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommentEditLog_commentId_createdAt_idx" ON "CommentEditLog"("commentId", "createdAt");

-- CreateIndex
CREATE INDEX "CommentEditLog_editorId_createdAt_idx" ON "CommentEditLog"("editorId", "createdAt");

-- AddForeignKey
ALTER TABLE "CommentEditLog" ADD CONSTRAINT "CommentEditLog_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentEditLog" ADD CONSTRAINT "CommentEditLog_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
