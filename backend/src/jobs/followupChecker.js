// backend/src/jobs/followUpNotificationJob.js
import { prisma } from "../db.js";
import { createVendorNotification } from "../services/notifications.js";
import { sendVendorFollowUpReminderEmail } from "../lib/mailer.js";

export async function runFollowUpNotificationJob() {
  const now = new Date();

  // Căutăm thread-urile unde followUpAt a ajuns + nu sunt arhivate
  // și NU au deja notificare "followup" generată de job (dedupe corect).
  const threads = await prisma.messageThread.findMany({
    where: {
      followUpAt: { lte: now },
      archived: false,

      // ✅ Dedupe doar pentru notificările generate de job (nu blochează "follow-up setat" etc.)
      notifications: {
        none: {
          type: "followup",
          meta: {
            path: ["generatedByJob"],
            equals: true,
          },
        },
      },
    },
    select: {
      id: true,
      vendorId: true,
      contactName: true,
      contactPhone: true,
      followUpAt: true,
      vendor: {
        select: {
          email: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  if (!threads.length) return;

  for (const thread of threads) {
    const followDate = thread.followUpAt;

    const readableDate = followDate
      ? followDate.toLocaleString("ro-RO", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    // ✅ Ruta corectă către vendor UI (din frontend-ul tău)
    const threadLink = `/vendor/messages?threadId=${thread.id}`;

    // 1) Notificare în dashboard vendor
    await createVendorNotification(thread.vendorId, {
      type: "followup",
      title: `Follow-up pentru ${thread.contactName || "client"}`,
      body: readableDate
        ? `Astăzi (${readableDate}) trebuie să revii la acest client.`
        : "Astăzi trebuie să revii la acest client.",
      link: threadLink,
      meta: {
        generatedByJob: true,
        contactPhone: thread.contactPhone || null,
        followUpAt: followDate ? followDate.toISOString() : null,
      },
      // dacă vrei să "pară" că a fost creată fix la followUpAt:
      // createdAt: followDate,
    });

    // 2) Email către vendor
    const vendorEmail =
      thread.vendor?.email || thread.vendor?.user?.email || null;

    if (vendorEmail) {
      await sendVendorFollowUpReminderEmail({
        to: vendorEmail,
        contactName: thread.contactName || "client",
        followUpAt: followDate ? followDate.toISOString() : null,
        threadLink,
      });
    }
  }

  console.log(
    `[followUpNotificationJob] created ${threads.length} followup notifications + emails`
  );
}
