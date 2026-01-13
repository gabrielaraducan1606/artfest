// backend/src/services/notifications.js
import { prisma } from "../db.js";

/**
 * Creează o notificare pentru un user (client).
 */
export async function createUserNotification(userId, data) {
  if (!userId) return null;

  return prisma.notification.create({
    data: {
      userId,
      vendorId: null,
      ...data, // type, title, body, link, meta etc.
    },
  });
}

/**
 * Creează o notificare pentru vendor (user-ul din dashboard).
 */
export async function createVendorNotification(vendorId, data) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, userId: true },
  });

  if (!vendor) throw new Error("vendor_not_found");

  return prisma.notification.create({
    data: {
      userId: vendor.userId,
      vendorId: vendor.id,
      ...data,
    },
  });
}

/* ============================================================
   Helpers
============================================================ */

function trimPreview(text, max = 160) {
  const t = String(text || "").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 3).trimEnd() + "..." : t;
}

/* ============================================================
   🔔 NOTIFICĂRI – STORE REVIEW (MAGAZIN)
============================================================ */
export async function notifyVendorOnStoreReviewCreated(reviewId) {
  if (!reviewId) return null;

  const review = await prisma.storeReview.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      vendorId: true,
      rating: true,
      comment: true,
      createdAt: true,
      user: {
        select: { id: true, firstName: true, lastName: true, name: true },
      },
      vendor: {
        select: {
          id: true,
          displayName: true,
          // ✅ luăm slug-ul magazinului din service->profile
          services: {
            where: { status: "ACTIVE" }, // dacă nu ai status, scoate where-ul
            take: 1,
            select: {
              id: true,
              profile: { select: { slug: true } },
            },
          },
        },
      },
    },
  });

  if (!review || !review.vendorId) return null;

  const vendorId = review.vendorId;

  const rating = Number(review.rating || 0);
  const ratingStr = rating ? `${rating}/5` : "recenzie nouă";
  const storeName = review.vendor?.displayName || "magazinul tău";

  const authorName =
    (review.user?.name ||
      [review.user?.firstName, review.user?.lastName].filter(Boolean).join(" "))?.trim() || "";

  const author = authorName ? ` de la ${authorName}` : "";
  const preview = trimPreview(review.comment);

  const title = `Recenzie nouă (${ratingStr})`;
  let body = `Ai primit o recenzie nouă pentru ${storeName}${author}.`;
  if (preview) body += `\n\n„${preview}”`;

  // ✅ slug magazin (din service profile)
  const storeSlug = review.vendor?.services?.[0]?.profile?.slug;

  // fallback simplu, ca să nu rupi dacă nu există slug
  const link = storeSlug
    ? `/magazin/${storeSlug}#review-${review.id}`
    : `/magazin/${vendorId}#review-${review.id}`;

  const exists = await prisma.notification.findFirst({
    where: { vendorId, type: "review", link },
    select: { id: true },
  });
  if (exists) return null;

  return createVendorNotification(vendorId, {
    type: "review",
    title,
    body,
    link,
    meta: {
      kind: "store_review_created",
      reviewId: review.id,
      vendorId,
      storeSlug: storeSlug || null,
    },
  });
}

export async function notifyUserOnStoreReviewReply(reviewId) {
  if (!reviewId) return null;

  const review = await prisma.storeReview.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      userId: true,
      vendorId: true,
      vendor: {
        select: {
          id: true,
          displayName: true,
          services: {
            where: { status: "ACTIVE" }, // dacă nu ai status, scoate where-ul
            take: 1,
            select: {
              id: true,
              profile: { select: { slug: true } },
            },
          },
        },
      },
      reply: { select: { text: true, updatedAt: true, createdAt: true } },
    },
  });

  if (!review?.userId) return null;
  if (!review.reply?.text) return null;

  const vendorName = review.vendor?.displayName || "Magazin";
  const text = String(review.reply.text || "").trim();
  const preview = text.length > 140 ? text.slice(0, 137).trimEnd() + "..." : text;

  const title = `${vendorName} ți-a răspuns la recenzie`;
  const body = preview || "Ai primit un răspuns la recenzia ta.";

  const storeSlug = review.vendor?.services?.[0]?.profile?.slug;

  const link = storeSlug
    ? `/magazin/${storeSlug}#review-${review.id}`
    : `/magazin/${review.vendorId}#review-${review.id}`;

  const exists = await prisma.notification.findFirst({
    where: { userId: review.userId, type: "review", link, title },
    select: { id: true },
  });
  if (exists) return null;

  return createUserNotification(review.userId, {
    type: "review",
    title,
    body,
    link,
    meta: {
      reviewId: review.id,
      vendorId: review.vendorId,
      storeSlug: storeSlug || null,
      kind: "store_review_reply",
    },
  });
}

/* ============================================================
   🔔 NOTIFICĂRI – PRODUCT REVIEW (PRODUS)
============================================================ */

export async function notifyVendorOnProductReviewCreated(reviewId) {
  if (!reviewId) return null;

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      productId: true,
      rating: true,
      comment: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          name: true,
          email: true,
        },
      },
      product: {
        select: {
          id: true,
          title: true,
          service: { select: { vendorId: true } },
        },
      },
    },
  });

  const vendorId = review?.product?.service?.vendorId || null;
  if (!review || !vendorId) return null;

  const rating = Number(review.rating || 0);
  const ratingStr = rating ? `${rating}/5` : "recenzie nouă";
  const productTitle = review.product?.title || "produsul tău";

  const authorName =
    (review.user?.name ||
      [review.user?.firstName, review.user?.lastName]
        .filter(Boolean)
        .join(" "))?.trim() ||
    (review.user?.email ? review.user.email.split("@")[0] : "");

  const author = authorName ? ` de la ${authorName}` : "";
  const preview = trimPreview(review.comment);

  const title = `Recenzie nouă la produs (${ratingStr})`;
  let body = `Ai primit o recenzie nouă pentru „${productTitle}”${author}.`;
  if (preview) body += `\n\n„${preview}”`;

  const link = `/produs/${review.productId}#review-${review.id}`;

  // ✅ IMPORTANT: type "review" (unificat)
  const exists = await prisma.notification.findFirst({
    where: { vendorId, type: "review", link },
    select: { id: true },
  });
  if (exists) return null;

  return createVendorNotification(vendorId, {
    type: "review",
    title,
    body,
    link,
    meta: {
      reviewId: review.id,
      productId: review.productId,
      vendorId,
      kind: "product_review_created",
    },
  });
}

export async function notifyUserOnProductReviewReply(reviewId) {
  if (!reviewId) return null;

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      userId: true,
      productId: true,
      product: {
        select: {
          title: true,
          service: {
            select: {
              vendor: { select: { id: true, displayName: true } },
            },
          },
        },
      },
      reply: {
        select: { text: true, updatedAt: true, createdAt: true },
      },
    },
  });

  if (!review?.userId) return null;
  if (!review.reply?.text) return null;

  const vendorName = review.product?.service?.vendor?.displayName || "Magazin";
  const productTitle = review.product?.title || "produs";
  const text = String(review.reply.text || "").trim();
  const preview = text.length > 140 ? text.slice(0, 137).trimEnd() + "..." : text;

  const title = `${vendorName} ți-a răspuns la recenzia ta`;
  const body =
    preview || `Ai primit un răspuns la recenzia ta pentru „${productTitle}”.`;

  const link = `/produs/${review.productId}#review-${review.id}`;

  // ✅ IMPORTANT: type "review" (unificat)
  const exists = await prisma.notification.findFirst({
    where: { userId: review.userId, type: "review", link, title },
    select: { id: true },
  });
  if (exists) return null;

  return createUserNotification(review.userId, {
    type: "review",
    title,
    body,
    link,
    meta: {
      reviewId: review.id,
      productId: review.productId,
      kind: "product_review_reply",
    },
  });
}

/* ============================================================
   🔔 NOTIFICĂRI – COMENZI / FACTURI / SHIPPING / SUPPORT / MESAJE
============================================================ */

export async function notifyUserOnOrderStatusChange(orderId, vendorUiStatus) {
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, userId: true, total: true, currency: true },
  });

  if (!o || !o.userId) return null;

  const totalNumber = Number(o.total || 0);
  const totalStr = `${totalNumber.toFixed(2)} ${o.currency || "RON"}`;

  let title;
  let body;

  switch (vendorUiStatus) {
    case "new":
      title = `Comanda ta #${o.id} a fost înregistrată`;
      body =
        `Comanda ta în valoare de ${totalStr} a ajuns la furnizor. ` +
        `Vei primi notificări pe parcursul procesării.`;
      break;
    case "preparing":
      title = `Comanda #${o.id} este în pregătire`;
      body = `Furnizorul pregătește produsele pentru expediere.`;
      break;
    case "confirmed":
      title = `Comanda #${o.id} este pregătită pentru livrare`;
      body =
        `Comanda ta în valoare de ${totalStr} e pregătită pentru curier sau ridicare. ` +
        `Verifică detaliile în pagina comenzii.`;
      break;
    case "fulfilled":
      title = `Comanda #${o.id} a fost livrată`;
      body =
        `Comanda ta a fost marcată ca livrată. Sperăm să te bucuri de produse! ` +
        `Ne poți lăsa și un review.`;
      break;
    case "cancelled":
      title = `Comanda #${o.id} a fost anulată de furnizor`;
      body =
        `Comanda ta în valoare de ${totalStr} a fost anulată de furnizor. ` +
        `Dacă ai întrebări, te rugăm să contactezi suportul.`;
      break;
    default:
      title = `Status actualizat pentru comanda #${o.id}`;
      body = `Statusul comenzii tale a fost actualizat de către furnizor.`;
  }

  return createUserNotification(o.userId, {
    type: "order",
    title,
    body,
    link: `/comanda/${o.id}`,
  });
}

export async function notifyUserOnInvoiceIssued(orderId, invoiceId) {
  const [order, invoice] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, total: true, currency: true },
    }),
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, number: true },
    }),
  ]);

  if (!order || !order.userId) return null;

  const totalNumber = Number(order.total || 0);
  const totalStr = `${totalNumber.toFixed(2)} ${order.currency || "RON"}`;

  const invNo = invoice?.number || "factură";

  return createUserNotification(order.userId, {
    type: "invoice",
    title: `Ai o factură nouă pentru comanda #${order.id}`,
    body: `Factura ${invNo} a fost emisă pentru comanda ta în valoare de ${totalStr}.`,
    link: `/comanda/${order.id}`,
  });
}

export async function notifyUserOnShipmentPickupScheduled(orderId, shipmentId) {
  const [order, shipment] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true },
    }),
    prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        awb: true,
        trackingUrl: true,
        courierProvider: true,
        courierService: true,
      },
    }),
  ]);

  if (!order || !order.userId) return null;

  const awb = shipment?.awb || null;
  const courier =
    shipment?.courierProvider || shipment?.courierService || "curier";
  const hasTracking = !!shipment?.trackingUrl;

  let body = `Comanda ta a fost predată către ${courier}.`;
  if (awb) body += ` AWB: ${awb}.`;
  if (hasTracking)
    body += ` Poți urmări livrarea în pagina comenzii sau în linkul de tracking.`;

  return createUserNotification(order.userId, {
    type: "shipping",
    title: `Coletul pentru comanda #${order.id} este în drum spre tine`,
    body,
    link: `/comanda/${order.id}`,
  });
}

export async function notifyUserOnSupportReply(ticketId, options = {}) {
  const { messagePreview = "" } = options;

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, subject: true, requesterId: true, audience: true },
  });

  if (!ticket || !ticket.requesterId) return null;
  if (ticket.audience !== "USER") return null;

  const subject = ticket.subject || "tichet de suport";

  let body = `Ai primit un răspuns nou la tichetul tău "${subject}".`;
  if (messagePreview) {
    const trimmed = messagePreview.trim();
    if (trimmed) {
      const short =
        trimmed.length > 120 ? trimmed.slice(0, 117).trimEnd() + "..." : trimmed;
      body += `\n\n„${short}”`;
    }
  }

  return createUserNotification(ticket.requesterId, {
    type: "support",
    title: `Răspuns nou la tichetul tău`,
    body,
    link: `/account/support/tickets/${ticket.id}`,
  });
}

export async function notifyUserOnSupportStatusChange(ticketId, newStatus) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, subject: true, requesterId: true, audience: true },
  });

  if (!ticket || !ticket.requesterId) return null;
  if (ticket.audience !== "USER") return null;

  const subject = ticket.subject || "tichet de suport";
  const statusUc = String(newStatus || "").toUpperCase();

  let title = `Status actualizat pentru tichetul tău`;
  let body = `Statusul tichetului "${subject}" a fost actualizat.`;

  if (statusUc === "OPEN") {
    title = `Tichetul tău a fost redeschis`;
    body = `Tichetul "${subject}" a fost redeschis de echipa de suport.`;
  } else if (statusUc === "PENDING") {
    title = `Tichetul tău este în curs de soluționare`;
    body = `Tichetul "${subject}" este în lucru la echipa de suport.`;
  } else if (statusUc === "CLOSED") {
    title = `Tichetul tău a fost închis`;
    body = `Tichetul "${subject}" a fost marcat ca rezolvat/închis. Dacă mai ai întrebări, poți deschide un tichet nou.`;
  }

  return createUserNotification(ticket.requesterId, {
    type: "support",
    title,
    body,
    link: `/account/support/tickets/${ticket.id}`,
  });
}

export async function notifyUserOnInboxMessage(thread, messageBody) {
  if (!thread || !thread.userId) return null;

  const trimmed = String(messageBody || "").trim();
  const short =
    trimmed.length > 140 ? trimmed.slice(0, 137).trimEnd() + "..." : trimmed;

  return createUserNotification(thread.userId, {
    type: "message",
    title: `Mesaj nou de la ${thread.vendor?.displayName || "magazin"}`,
    body: short || "Ai primit un mesaj nou în conversația cu magazinul.",
    link: `/cont/mesaje?threadId=${thread.id}`,
  });
}

/* ============================================================
   🔔 NOTIFICĂRI – PRODUCT COMMENTS (COMENTARII)
============================================================ */

/**
 * Vendor: comentariu nou la produs.
 */
export async function notifyVendorOnProductCommentCreated(commentId) {
  if (!commentId) return null;

  const c = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      productId: true,
      parentId: true,
      text: true,
      createdAt: true,
      user: {
        select: { id: true, firstName: true, lastName: true, name: true, email: true },
      },
      product: {
        select: {
          id: true,
          title: true,
          service: { select: { vendorId: true } },
        },
      },
    },
  });

  const vendorId = c?.product?.service?.vendorId || null;
  if (!c || !vendorId) return null;

  const authorName =
    (c.user?.name ||
      [c.user?.firstName, c.user?.lastName].filter(Boolean).join(" "))?.trim() ||
    (c.user?.email ? c.user.email.split("@")[0] : "");

  const author = authorName ? ` de la ${authorName}` : "";
  const preview = trimPreview(c.text);

  const productTitle = c.product?.title || "produsul tău";
  const title = `Comentariu nou la produs`;
  let body = `Ai primit un comentariu nou pentru „${productTitle}”${author}.`;
  if (preview) body += `\n\n„${preview}”`;

  // ancoră pentru comentariu (front-ul tău poate folosi id-ul)
  const link = `/produs/${c.productId}#comment-${c.id}`;

  // dedupe: aceeași notificare pentru același comment
  const exists = await prisma.notification.findFirst({
    where: { vendorId, type: "review", link },
    select: { id: true },
  });
  if (exists) return null;

  return createVendorNotification(vendorId, {
    type: "review",
    title,
    body,
    link,
    meta: {
      kind: "product_comment_created",
      commentId: c.id,
      productId: c.productId,
      vendorId,
      parentId: c.parentId || null,
    },
  });
}

/**
 * User: primește reply la comentariul lui (când se creează un comment cu parentId).
 * IMPORTANT: varianta asta NU cere relation `parent` în Prisma.
 */
export async function notifyUserOnProductCommentReply(commentId) {
  if (!commentId) return null;

  const c = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      productId: true,
      parentId: true,
      text: true,
      createdAt: true,
      userId: true, // autor reply
      user: {
        select: { id: true, firstName: true, lastName: true, name: true, email: true },
      },
      product: {
        select: {
          id: true,
          title: true,
          service: { select: { vendor: { select: { id: true, displayName: true } } } },
        },
      },
    },
  });

  if (!c?.parentId) return null;

  // aflăm user-ul comentariului părinte
  const parent = await prisma.comment.findUnique({
    where: { id: c.parentId },
    select: { id: true, userId: true },
  });

  const parentUserId = parent?.userId || null;
  if (!parentUserId) return null;

  // nu notificăm dacă îți răspunzi singur
  if (parentUserId === c.userId) return null;

  const productTitle = c.product?.title || "produs";
  const replierName =
    (c.user?.name ||
      [c.user?.firstName, c.user?.lastName].filter(Boolean).join(" "))?.trim() ||
    (c.user?.email ? c.user.email.split("@")[0] : "");

  const preview = trimPreview(c.text, 140);

  const title = `Răspuns nou la comentariul tău`;
  let body = `${replierName || "Cineva"} ți-a răspuns la comentariul pentru „${productTitle}”.`;
  if (preview) body += `\n\n„${preview}”`;

  const link = `/produs/${c.productId}#comment-${c.id}`;

  const exists = await prisma.notification.findFirst({
    where: { userId: parentUserId, type: "review", link, title },
    select: { id: true },
  });
  if (exists) return null;

  return createUserNotification(parentUserId, {
    type: "review",
    title,
    body,
    link,
    meta: {
      kind: "product_comment_reply",
      commentId: c.id,
      parentId: c.parentId,
      productId: c.productId,
    },
  });
}

/* ============================================================
   🔔 NOTIFICĂRI – STORE FOLLOWERS (URMĂRITORI)
============================================================ */

/**
 * Vendor: cineva a început să urmărească magazinul (service).
 * Dedupe: same vendorId + type + link + kind/serviceId.
 */
export async function notifyVendorOnStoreFollowCreated(serviceId, followerUserId = null) {
  if (!serviceId) return null;

  const service = await prisma.vendorService.findUnique({
    where: { id: serviceId },
    select: {
      id: true,
      vendorId: true,
      title: true,
      profile: {
        select: {
          displayName: true,
          slug: true,
        },
      },
    },
  });

  if (!service?.vendorId) return null;

  const vendorId = service.vendorId;
  const storeName = service.profile?.displayName || service.title || "magazinul tău";

  // Link: ideal către pagina de followers din dashboard; sau către pagina magazinului public
  // Alege una (eu păstrez dashboard-ul tău):
  const link = "/vendor/visitors";

  // dedupe (opțional, dar recomandat)
  const exists = await prisma.notification.findFirst({
    where: {
      vendorId,
      type: "follow",
      link,
      // dacă ai meta JSON, poți dedup-ui mai strict după serviceId
      // dar Prisma nu permite mereu filter JSON la fel în toate DB-urile,
      // așa că păstrăm un dedupe simplu + title/link.
      title: "Magazinul tău are un nou urmăritor",
    },
    select: { id: true },
  });
  if (exists) return null;

  return createVendorNotification(vendorId, {
    type: "follow",
    title: "Magazinul tău are un nou urmăritor",
    body: `Cineva a început să urmărească ${storeName}.`,
    link,
    meta: {
      kind: "store_follow_created",
      serviceId: service.id,
      storeSlug: service.profile?.slug || null,
      followerUserId: followerUserId || null,
    },
  });
}
