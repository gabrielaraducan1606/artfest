// backend/src/services/messageEmailNotifications.js
import { prisma as defaultPrisma } from "../db.js";
import {
  MESSAGE_EMAIL_PUBLIC_BASE_URL,
  sendNewMessageEmail,
} from "../lib/mailer.js";

/*
 * Email la mesaj nou într-o conversație USER <-> VENDOR (MessageThread
 * de tip CUSTOMER, inclusiv conversațiile cererilor de ofertă).
 *
 * Se apelează DOAR din endpoint-urile prin care un om scrie un mesaj
 * (inbox user / inbox vendor / vendor-cumpărător / mesaje în cerere de
 * ofertă). Mesajele automate (comandă anulată, retur, „Ai primit o ofertă
 * nouă”, mesajul inițial al cererii de ofertă) NU trec pe aici - acele
 * evenimente au deja emailurile lor.
 *
 * Anti-spam: cel mult un email per „lot” de mesaje necitite.
 *   - MessageThread.vendorMessageEmailAt / userMessageEmailAt = momentul
 *     ultimului email trimis destinatarului;
 *   - alt email pleacă doar dacă destinatarul a citit conversația după
 *     acel email (vendorLastReadAt / userLastReadAt >= ...);
 *   - rezervarea se face atomic (updateMany condiționat pe valoarea
 *     citită), deci două mesaje simultane nu trimit două emailuri;
 *   - cooldown: conversația citită în ultimele 5 minute (destinatarul e
 *     activ în chat) -> fără email, doar notificarea in-app din rută.
 *
 * Eșec la trimitere: EmailLog FAILED (sendMailLogged) + rezervarea se
 * anulează, deci retryFailedMessageEmails (sau următorul mesaj) poate
 * trimite. Retry fără duplicate: template-ul conține id-ul mesajului
 * („message_new_vendor:<threadId>:<messageId>”) și nu se retrimite dacă
 * există deja un EmailLog SENT/QUEUED pentru el.
 */

export const MESSAGE_EMAIL_TEMPLATE = {
  VENDOR: "message_new_vendor",
  USER: "message_new_user",
};

// destinatarul a citit conversația în ultimele 5 minute = e activ în chat
// -> doar notificare in-app, fără email (chat live de 10 mesaje != 10 emailuri)
export const MESSAGE_EMAIL_READ_COOLDOWN_MS = 5 * 60 * 1000;

export const MESSAGE_EMAIL_RETRY_MAX_ATTEMPTS = 3;
export const MESSAGE_EMAIL_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

const PREVIEW_MAX_LENGTH = 180;
const ATTACHMENT_PREVIEW = "Ai primit un mesaj nou cu un atașament.";

export function messageEmailTemplate(recipientRole, threadId, messageId) {
  return `${MESSAGE_EMAIL_TEMPLATE[recipientRole]}:${threadId}:${messageId}`;
}

export function parseMessageEmailTemplate(template) {
  const m = /^(message_new_vendor|message_new_user):([^:]+):([^:]+)$/.exec(
    String(template || "")
  );
  if (!m) return null;
  return {
    recipientRole: m[1] === MESSAGE_EMAIL_TEMPLATE.VENDOR ? "VENDOR" : "USER",
    threadId: m[2],
    messageId: m[3],
  };
}

/* ============================================================
   Preview: text simplu, scurt, fără date de contact
============================================================ */

function redactPhones(text) {
  return text.replace(/\+?\d[\d\s().-]{6,}\d/g, (match) =>
    match.replace(/\D/g, "").length >= 9 ? "[telefon ascuns]" : match
  );
}

export function buildMessagePreview(body, { hasAttachments = false } = {}) {
  let text = String(body ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email ascuns]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link ascuns]");

  text = redactPhones(text).replace(/\s+/g, " ").trim();

  // mesajele de tip atașament au body generic „📎 Atașament”
  if (!text || (hasAttachments && /^📎/u.test(text))) {
    return hasAttachments ? ATTACHMENT_PREVIEW : "";
  }

  if (text.length <= PREVIEW_MAX_LENGTH) return text;

  const cut = text.slice(0, PREVIEW_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > PREVIEW_MAX_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/* ============================================================
   Destinatar, link, regula anti-spam (pure)
============================================================ */

function personName(u) {
  if (!u) return "";
  const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return full || String(u.name || "").trim();
}

function storeName(thread) {
  return (
    thread?.service?.profile?.displayName ||
    thread?.service?.title ||
    thread?.vendor?.displayName ||
    ""
  );
}

function isReachableUser(u) {
  return Boolean(u && u.email && u.status === "ACTIVE" && !u.locked);
}

export function buildMessageEmailLink({ recipientRole, thread, recipientUser }) {
  const base = MESSAGE_EMAIL_PUBLIC_BASE_URL.replace(/\/+$/, "");
  const quoteId = thread?.quoteRequest?.id;
  const threadId = encodeURIComponent(thread.id);

  if (quoteId) {
    const q = encodeURIComponent(quoteId);
    return recipientRole === "VENDOR"
      ? `${base}/?assistant=vendor-quote&quoteId=${q}`
      : `${base}/?assistant=quote&quoteId=${q}`;
  }

  if (recipientRole === "VENDOR") return `${base}/mesaje?threadId=${threadId}`;

  // un vendor care a scris ca și cumpărător vede conversația în /mesaje
  // (tab vendor), nu în /cont/mesaje (acolo RequireUser îl redirecționează)
  return recipientUser?.role === "VENDOR"
    ? `${base}/mesaje?vendorThreadId=${threadId}`
    : `${base}/cont/mesaje?threadId=${threadId}`;
}

/**
 * Decide cui (și dacă) se trimite emailul pentru un mesaj.
 * Întoarce { skip: "<motiv>" } sau planul complet.
 */
export function planMessageEmail({ thread, message }) {
  if (!thread || !message) return { skip: "not_found" };
  if (thread.type !== "CUSTOMER") return { skip: "not_customer_thread" };
  if (message.deletedByUserAt || message.deletedByVendorAt) {
    return { skip: "message_deleted" };
  }

  const vendorUser = thread.vendor?.user || null;

  if (message.authorType === "USER" || message.authorType === "VISITOR") {
    // client -> vendor
    const senderUserId = message.authorUserId || thread.userId || null;
    if (!thread.vendor || thread.vendor.isActive === false) {
      return { skip: "vendor_inactive" };
    }
    if (thread.deletedByVendorAt) return { skip: "thread_deleted_by_recipient" };
    if (senderUserId && vendorUser && senderUserId === vendorUser.id) {
      return { skip: "self" };
    }
    if (vendorUser && (vendorUser.status !== "ACTIVE" || vendorUser.locked)) {
      return { skip: "recipient_unavailable" };
    }

    const to = vendorUser?.email || thread.vendor.email || null;
    if (!to) return { skip: "no_recipient_email" };

    const senderName =
      personName(message.authorUser) ||
      personName(thread.user) ||
      String(thread.contactName || message.authorName || "").trim() ||
      "un client";

    return {
      recipientRole: "VENDOR",
      to,
      toName: thread.vendor.displayName || null,
      userId: vendorUser?.id || null,
      recipientFirstName: vendorUser?.firstName || null,
      senderName,
      lastReadAt: thread.vendorLastReadAt || null,
      claimField: "vendorMessageEmailAt",
      claimedAt: thread.vendorMessageEmailAt || null,
      link: buildMessageEmailLink({ recipientRole: "VENDOR", thread }),
    };
  }

  if (message.authorType === "VENDOR") {
    // vendor -> client (doar clienți cu cont; guest-ii nu au inbox)
    const recipient = thread.user || null;
    if (!thread.userId || !recipient) return { skip: "guest_recipient" };
    if (thread.deletedByUserAt) return { skip: "thread_deleted_by_recipient" };
    if (vendorUser && recipient.id === vendorUser.id) return { skip: "self" };
    if (!isReachableUser(recipient)) return { skip: "recipient_unavailable" };

    return {
      recipientRole: "USER",
      to: recipient.email,
      toName: personName(recipient) || null,
      userId: recipient.id,
      recipientFirstName: recipient.firstName || recipient.name || null,
      senderName: storeName(thread) || "Un magazin",
      lastReadAt: thread.userLastReadAt || null,
      claimField: "userMessageEmailAt",
      claimedAt: thread.userMessageEmailAt || null,
      link: buildMessageEmailLink({ recipientRole: "USER", thread, recipientUser: recipient }),
    };
  }

  return { skip: "unknown_author" };
}

/**
 * Regula anti-spam: email permis dacă nu s-a trimis niciunul încă sau
 * dacă destinatarul a citit conversația după ultimul email.
 */
export function canSendAnotherMessageEmail({ claimedAt, lastReadAt }) {
  if (!claimedAt) return true;
  if (!lastReadAt) return false;
  return new Date(lastReadAt).getTime() >= new Date(claimedAt).getTime();
}

/**
 * Cooldown: conversația citită foarte recent (< 5 minute) -> fără email.
 * Mesajele trimise în acest interval nu mai primesc email ulterior;
 * primul mesaj nou după cele 5 minute poate genera email.
 */
export function isWithinReadCooldown({ lastReadAt, now }) {
  if (!lastReadAt) return false;
  const elapsed = new Date(now).getTime() - new Date(lastReadAt).getTime();
  return elapsed >= 0 && elapsed < MESSAGE_EMAIL_READ_COOLDOWN_MS;
}

/* ============================================================
   Trimitere
============================================================ */

const threadSelect = {
  id: true,
  type: true,
  userId: true,
  vendorId: true,
  contactName: true,
  vendorLastReadAt: true,
  userLastReadAt: true,
  vendorMessageEmailAt: true,
  userMessageEmailAt: true,
  deletedByUserAt: true,
  deletedByVendorAt: true,
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      name: true,
      role: true,
      status: true,
      locked: true,
    },
  },
  vendor: {
    select: {
      id: true,
      displayName: true,
      email: true,
      isActive: true,
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          name: true,
          status: true,
          locked: true,
        },
      },
    },
  },
  service: {
    select: { title: true, profile: { select: { displayName: true } } },
  },
  quoteRequest: { select: { id: true } },
};

/**
 * Trimite (cel mult) un email pentru mesajul dat. Sigur de apelat de mai
 * multe ori pentru același mesaj (retry): nu trimite duplicate.
 *
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function notifyNewMessageByEmail(
  { messageId },
  { db = defaultPrisma, send = sendNewMessageEmail, now = () => new Date() } = {}
) {
  if (!messageId) return { sent: false, reason: "not_found" };

  const message = await db.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      threadId: true,
      authorType: true,
      authorUserId: true,
      authorName: true,
      body: true,
      createdAt: true,
      deletedByUserAt: true,
      deletedByVendorAt: true,
      authorUser: { select: { id: true, firstName: true, lastName: true, name: true } },
      attachments: { select: { id: true } },
    },
  });
  if (!message) return { sent: false, reason: "not_found" };

  const thread = await db.messageThread.findUnique({
    where: { id: message.threadId },
    select: threadSelect,
  });

  const plan = planMessageEmail({ thread, message });
  if (plan.skip) return { sent: false, reason: plan.skip };

  const template = messageEmailTemplate(plan.recipientRole, thread.id, message.id);

  const alreadyLogged = await db.emailLog.findFirst({
    where: { template, status: { in: ["SENT", "QUEUED"] } },
    select: { id: true },
  });
  if (alreadyLogged) return { sent: false, reason: "already_sent" };

  if (
    plan.lastReadAt &&
    new Date(message.createdAt).getTime() <= new Date(plan.lastReadAt).getTime()
  ) {
    return { sent: false, reason: "already_read" };
  }

  if (!canSendAnotherMessageEmail(plan)) {
    return { sent: false, reason: "awaiting_read" };
  }

  const claimAt = now();

  if (isWithinReadCooldown({ lastReadAt: plan.lastReadAt, now: claimAt })) {
    return { sent: false, reason: "recently_read" };
  }

  // rezervare atomică: câștigă un singur request (compare-and-set)
  const claim = await db.messageThread.updateMany({
    where: { id: thread.id, [plan.claimField]: plan.claimedAt },
    data: { [plan.claimField]: claimAt },
  });
  if (claim.count !== 1) return { sent: false, reason: "claim_lost" };

  try {
    await send({
      to: plan.to,
      toName: plan.toName,
      userId: plan.userId,
      template,
      recipientRole: plan.recipientRole,
      recipientFirstName: plan.recipientFirstName,
      senderName: plan.senderName,
      preview: buildMessagePreview(message.body, {
        hasAttachments: (message.attachments || []).length > 0,
      }),
      link: plan.link,
    });
  } catch (err) {
    // eliberează rezervarea -> retry / următorul mesaj poate trimite
    await db.messageThread
      .updateMany({
        where: { id: thread.id, [plan.claimField]: claimAt },
        data: { [plan.claimField]: plan.claimedAt },
      })
      .catch(() => {});
    console.error(
      "[message-email] send failed:",
      template,
      err?.message || err
    );
    return { sent: false, reason: "send_failed" };
  }

  return { sent: true };
}

/**
 * Fire-and-forget din rute: nu blochează răspunsul și nu aruncă.
 */
export function queueNewMessageEmail(messageId) {
  if (!messageId) return;
  notifyNewMessageByEmail({ messageId }).catch((err) =>
    console.error("[message-email] failed:", err?.message || err)
  );
}

/**
 * Reia emailurile FAILED din ultimele 24h (max 3 încercări per mesaj).
 * Fiecare reluare trece prin aceleași verificări (SENT existent, mesaj
 * citit între timp, alt email deja trimis) -> fără duplicate.
 */
export async function retryFailedMessageEmails({
  db = defaultPrisma,
  send = sendNewMessageEmail,
  now = () => new Date(),
} = {}) {
  const since = new Date(now().getTime() - MESSAGE_EMAIL_RETRY_WINDOW_MS);

  const failed = await db.emailLog.findMany({
    where: {
      status: "FAILED",
      createdAt: { gte: since },
      OR: [
        { template: { startsWith: `${MESSAGE_EMAIL_TEMPLATE.VENDOR}:` } },
        { template: { startsWith: `${MESSAGE_EMAIL_TEMPLATE.USER}:` } },
      ],
    },
    select: { template: true },
  });

  const attempts = new Map();
  for (const row of failed) {
    attempts.set(row.template, (attempts.get(row.template) || 0) + 1);
  }

  const summary = { checked: 0, sent: 0, skipped: 0, gaveUp: 0 };

  for (const [template, count] of attempts) {
    const parsed = parseMessageEmailTemplate(template);
    if (!parsed) continue;
    summary.checked += 1;

    if (count >= MESSAGE_EMAIL_RETRY_MAX_ATTEMPTS) {
      summary.gaveUp += 1;
      continue;
    }

    const result = await notifyNewMessageByEmail(
      { messageId: parsed.messageId },
      { db, send, now }
    );
    if (result.sent) summary.sent += 1;
    else summary.skipped += 1;
  }

  return summary;
}
