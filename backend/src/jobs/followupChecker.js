// backend/src/jobs/followUpNotificationJob.js
import { prisma } from "../db.js";
import { createVendorNotification } from "../services/notifications.js";
import { sendVendorFollowUpReminderEmail } from "../lib/mailer.js";

export async function runFollowUpNotificationJob() {
  const now = new Date();

  // ✅ Luăm doar thread-urile care sunt due + ne-arhivate + încă nenotificate
  const threads = await prisma.messageThread.findMany({
    where: {
      followUpAt: { not: null, lte: now },
      archived: false,
      followUpNotifiedAt: null, // ✅ cheia anti-spam
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

  if (!threads.length) {
    console.log("[followUpNotificationJob] created 0 followup notifications + emails");
    return;
  }

  let created = 0;

  for (const thread of threads) {
    const followDate = thread.followUpAt;

    // ✅ claim atomic: dacă între timp altă rulare a job-ului l-a procesat,
    // updateMany va avea count=0 și nu mai facem nimic
    const claimed = await prisma.messageThread.updateMany({
      where: { id: thread.id, followUpNotifiedAt: null },
      data: { followUpNotifiedAt: now },
    });

    if (claimed.count === 0) continue;

    const readableDate = followDate
      ? followDate.toLocaleString("ro-RO", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";

    const threadLink = `/vendor/messages?threadId=${thread.id}`;

    // ✅ dedupeKey stabil: o singură notificare per thread follow-up
    // (funcționează doar dacă ai dedupeKey @unique în Notification)
    const dedupeKey = `followup:${thread.id}`;

    // 1) Notificare în dashboard vendor (o singură dată)
    await createVendorNotification(thread.vendorId, {
      dedupeKey,
      type: "followup",
      title: `Follow-up pentru ${thread.contactName || "client"}`,
      body: readableDate
        ? `Astăzi (${readableDate}) trebuie să revii la acest client.`
        : "Astăzi trebuie să revii la acest client.",
      link: threadLink,
      meta: {
        generatedByJob: true,
        threadId: thread.id,
        contactPhone: thread.contactPhone || null,
        followUpAt: followDate ? followDate.toISOString() : null,
      },
    });

    // 2) Email către vendor (o singură dată, protejat de claim)
    const vendorEmail = thread.vendor?.email || thread.vendor?.user?.email || null;

    if (vendorEmail) {
      await sendVendorFollowUpReminderEmail({
        to: vendorEmail,
        contactName: thread.contactName || "client",
        followUpAt: followDate ? followDate.toISOString() : null,
        threadLink,
      });
    }

    created += 1;
  }

  console.log(
    `[followUpNotificationJob] created ${created} followup notifications + emails`
  );
}
