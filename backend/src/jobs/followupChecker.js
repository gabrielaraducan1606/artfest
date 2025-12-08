import { prisma } from "../db.js";
import { createVendorNotification } from "../services/notifications.js";
import { sendVendorFollowUpReminderEmail } from "../lib/mailer.js";

export async function runFollowUpNotificationJob() {
  const now = new Date();

  // căutăm toate thread-urile la care follow-up-ul a ajuns
  // și nu au notificare de tip "followup" deja
  const threads = await prisma.messageThread.findMany({
    where: {
      followUpAt: {
        lte: now, // follow-up due (ora 08:00 a trecut deja)
      },
      archived: false,
      notifications: {
        none: {
          type: "followup",
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
          user: {
            select: { email: true },
          },
        },
      },
    },
  });

  if (!threads.length) {
    return;
  }

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

    // 1️⃣ Notificare în dashboard-ul vendorului
    await createVendorNotification(thread.vendorId, {
      type: "followup", // NotificationType.followup în Prisma
      title: `Follow-up pentru ${thread.contactName || "client"}`,
      body: readableDate
        ? `Astăzi (${readableDate}) trebuie să revii la acest client.`
        : "Astăzi trebuie să revii la acest client.",
      link: `/mesaje?threadId=${thread.id}`, // ajustează la ruta ta reală de mesaje
      threadId: thread.id,
      meta: {
        generatedByJob: true,
        contactPhone: thread.contactPhone || null,
        followUpAt: followDate ? followDate.toISOString() : null,
      },
      // poți lăsa createdAt default (now) sau, dacă vrei, să „pară” exact la ora followUpAt:
      // createdAt: followDate,
    });

    // 2️⃣ Email DOAR către vendor
    const vendorEmail =
      thread.vendor?.email || thread.vendor?.user?.email || null;

    if (vendorEmail) {
      await sendVendorFollowUpReminderEmail({
        to: vendorEmail,
        contactName: thread.contactName || "client",
        followUpAt: followDate ? followDate.toISOString() : null,
        threadLink: `/mesaje?threadId=${thread.id}`,
      });
    }
  }

  console.log(
    `[followUpNotificationJob] create ${threads.length} notificări followup + email-uri`
  );
}
