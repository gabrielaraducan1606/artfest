import prisma from "../lib/prisma.js";

export async function createEmailLogQueued(data) {
  return prisma.emailLog.create({
    data: {
      status: "QUEUED",
      ...data,
    },
  });
}

export async function markEmailLogSent(id, meta = {}) {
  return prisma.emailLog.update({
    where: { id },
    data: {
      status: "SENT",
      sentAt: new Date(),
      messageId: meta.messageId || null,
      provider: meta.provider || null,
      error: null,
    },
  });
}

export async function markEmailLogFailed(id, err) {
  const msg = String(err?.message || err || "Unknown error").slice(0, 1000);
  return prisma.emailLog.update({
    where: { id },
    data: {
      status: "FAILED",
      error: msg,
    },
  });
}
