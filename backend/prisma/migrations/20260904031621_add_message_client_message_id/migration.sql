/*
  Warnings:

  - A unique constraint covering the columns `[threadId,clientMessageId]` on the table `Message` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "clientMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_threadId_clientMessageId_key" ON "Message"("threadId", "clientMessageId");
