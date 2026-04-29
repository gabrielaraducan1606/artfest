// backend/src/services/notifications.js
import { prisma } from "../db.js";

/**
 * Creează o notificare pentru un user (client).
 * ✅ Dedupe safe: dacă există unică (dedupeKey), ignoră duplicatele (P2002).
 */
export async function createUserNotification(userId, data) {
  if (!userId) return null;

  try {
    return await prisma.notification.create({
      data: {
        userId,
        vendorId: null,
        ...data, // type, title, body, link, meta, dedupeKey etc.
      },
    });
  } catch (e) {
    // Prisma unique violation
    if (e?.code === "P2002") return null;
    throw e;
  }
}

/**
 * Creează o notificare pentru vendor (user-ul din dashboard).
 * ✅ Dedupe safe: dacă există unică (dedupeKey), ignoră duplicatele (P2002).
 */
export async function createVendorNotification(vendorId, data) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, userId: true },
  });

  if (!vendor) throw new Error("vendor_not_found");

  try {
    return await prisma.notification.create({
      data: {
        userId: vendor.userId,
        vendorId: vendor.id,
        ...data, // include dedupeKey dacă îl dai
      },
    });
  } catch (e) {
    if (e?.code === "P2002") return null;
    throw e;
  }
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
      serviceId: true,
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
        },
      },
      service: {
        select: {
          id: true,
          title: true,
          profile: {
            select: {
              slug: true,
              displayName: true,
            },
          },
        },
      },
    },
  });

  if (!review || !review.vendorId || !review.serviceId) return null;

  const vendorId = review.vendorId;
  const rating = Number(review.rating || 0);
  const ratingStr = rating ? `${rating}/5` : "recenzie nouă";

  const storeName =
    review.service?.profile?.displayName ||
    review.service?.title ||
    review.vendor?.displayName ||
    "magazinul tău";

  const authorName =
    (
      review.user?.name ||
      [review.user?.firstName, review.user?.lastName].filter(Boolean).join(" ")
    )?.trim() || "";

  const author = authorName ? ` de la ${authorName}` : "";
  const preview = trimPreview(review.comment);

  const title = `Recenzie nouă (${ratingStr})`;
  let body = `Ai primit o recenzie nouă pentru ${storeName}${author}.`;
  if (preview) body += `\n\n„${preview}”`;

  const storeSlug = review.service?.profile?.slug || null;

  const link = storeSlug
    ? `/magazin/${storeSlug}#review-${review.id}`
    : `/magazin/${review.serviceId}#review-${review.id}`;

  const dedupeKey = `store_review_created:${vendorId}:${review.id}`;

  return createVendorNotification(vendorId, {
    dedupeKey,
    type: "review",
    title,
    body,
    link,
    meta: {
      kind: "store_review_created",
      reviewId: review.id,
      vendorId,
      serviceId: review.serviceId,
      storeSlug,
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
      serviceId: true,
      vendor: {
        select: {
          id: true,
          displayName: true,
        },
      },
      service: {
        select: {
          id: true,
          title: true,
          profile: {
            select: {
              slug: true,
              displayName: true,
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
  if (!review?.reply?.text) return null;

  const vendorName =
    review.service?.profile?.displayName ||
    review.service?.title ||
    review.vendor?.displayName ||
    "Magazin";

  const text = String(review.reply.text || "").trim();
  const preview =
    text.length > 140 ? text.slice(0, 137).trimEnd() + "..." : text;

  const title = `${vendorName} ți-a răspuns la recenzie`;
  const body = preview || "Ai primit un răspuns la recenzia ta.";

  const storeSlug = review.service?.profile?.slug || null;

  const link = storeSlug
    ? `/magazin/${storeSlug}#review-${review.id}`
    : `/magazin/${review.serviceId}#review-${review.id}`;

  const dedupeKey = `store_review_reply:${review.userId}:${review.id}`;

  return createUserNotification(review.userId, {
    dedupeKey,
    type: "review",
    title,
    body,
    link,
    meta: {
      reviewId: review.id,
      vendorId: review.vendorId,
      serviceId: review.serviceId,
      storeSlug,
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
      [review.user?.firstName, review.user?.lastName].filter(Boolean).join(" "))?.trim() ||
    (review.user?.email ? review.user.email.split("@")[0] : "");

  const author = authorName ? ` de la ${authorName}` : "";
  const preview = trimPreview(review.comment);

  const title = `Recenzie nouă la produs (${ratingStr})`;
  let body = `Ai primit o recenzie nouă pentru „${productTitle}”${author}.`;
  if (preview) body += `\n\n„${preview}”`;

  const link = `/produs/${review.productId}#review-${review.id}`;

  // ✅ dedupe atomic
  const dedupeKey = `product_review_created:${vendorId}:${review.id}`;

  return createVendorNotification(vendorId, {
    dedupeKey,
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
  const body = preview || `Ai primit un răspuns la recenzia ta pentru „${productTitle}”.`;

  const link = `/produs/${review.productId}#review-${review.id}`;

  // ✅ dedupe atomic
  const dedupeKey = `product_review_reply:${review.userId}:${review.id}`;

  return createUserNotification(review.userId, {
    dedupeKey,
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
    select: {
      id: true,
      orderNumber: true, // ✅
      userId: true,
      total: true,
      currency: true,
    },
  });

  if (!o || !o.userId) return null;

  const displayNo = o.orderNumber || o.id; // ✅

  const totalNumber = Number(o.total || 0);
  const totalStr = `${totalNumber.toFixed(2)} ${o.currency || "RON"}`;

  let title;
  let body;

  switch (vendorUiStatus) {
    case "new":
      title = `Comanda ta #${displayNo} a fost înregistrată`; // ✅
      body =
        `Comanda ta în valoare de ${totalStr} a ajuns la furnizor. ` +
        `Vei primi notificări pe parcursul procesării.`;
      break;

    case "preparing":
      title = `Comanda #${displayNo} este în pregătire`; // ✅
      body = `Furnizorul pregătește produsele pentru expediere.`;
      break;

    case "confirmed":
      title = `Comanda #${displayNo} este pregătită pentru livrare`; // ✅
      body =
        `Comanda ta în valoare de ${totalStr} e pregătită pentru curier sau ridicare. ` +
        `Verifică detaliile în pagina comenzii.`;
      break;

    case "fulfilled":
      title = `Comanda #${displayNo} a fost livrată`; // ✅
      body =
        `Comanda ta a fost marcată ca livrată. Sperăm să te bucuri de produse! ` +
        `Ne poți lăsa și un review.`;
      break;

    case "cancelled":
      title = `Comanda #${displayNo} a fost anulată de furnizor`; // ✅
      body =
        `Comanda ta în valoare de ${totalStr} a fost anulată de furnizor. ` +
        `Dacă ai întrebări, te rugăm să contactezi suportul.`;
      break;

    default:
      title = `Status actualizat pentru comanda #${displayNo}`; // ✅
      body = `Statusul comenzii tale a fost actualizat de către furnizor.`;
  }

  return createUserNotification(o.userId, {
    type: "order",
    title,
    body,
    link: `/comanda/${o.id}`, // ✅ rămâne pe id
  });
}

export async function notifyUserOnInvoiceIssued(orderId, invoiceId) {
  const [order, invoice] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true, // ✅
        userId: true,
        total: true,
        currency: true,
      },
    }),
    prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, number: true },
    }),
  ]);

  if (!order || !order.userId) return null;

  const displayNo = order.orderNumber || order.id; // ✅

  const totalNumber = Number(order.total || 0);
  const totalStr = `${totalNumber.toFixed(2)} ${order.currency || "RON"}`;

  const invNo = invoice?.number || "factură";
  const dedupeKey = `invoice_issued:${order.userId}:${invoiceId}`;

  return createUserNotification(order.userId, {
    dedupeKey,
    type: "invoice",
    title: `Ai o factură nouă pentru comanda #${displayNo}`, // ✅
    body: `Factura ${invNo} a fost emisă pentru comanda ta în valoare de ${totalStr}.`,
    link: `/comanda/${order.id}`, // ✅ rămâne pe id
  });
}

export async function notifyUserOnShipmentPickupScheduled(orderId, shipmentId) {
  const [order, shipment] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, userId: true }, // ✅
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

  const displayNo = order.orderNumber || order.id; // ✅

  const awb = shipment?.awb || null;
  const courier =
    shipment?.courierProvider || shipment?.courierService || "curier";
  const hasTracking = !!shipment?.trackingUrl;

  let body = `Comanda ta a fost predată către ${courier}.`;
  if (awb) body += ` AWB: ${awb}.`;
  if (hasTracking)
    body += ` Poți urmări livrarea în pagina comenzii sau în linkul de tracking.`;

  const dedupeKey = `shipment_pickup:${order.userId}:${shipmentId}`;

  return createUserNotification(order.userId, {
    dedupeKey,
    type: "shipping",
    title: `Coletul pentru comanda #${displayNo} este în drum spre tine`, // ✅
    body,
    link: `/comanda/${order.id}`, // ✅ rămâne pe id
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
      const short = trimmed.length > 120 ? trimmed.slice(0, 117).trimEnd() + "..." : trimmed;
      body += `\n\n„${short}”`;
    }
  }

  // de obicei vrei fiecare reply -> fără dedupeKey (sau poți dedupe pe messageId dacă ai)
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

  // aici e ok să trimiți de fiecare dată
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
  const short = trimmed.length > 140 ? trimmed.slice(0, 137).trimEnd() + "..." : trimmed;

  // dacă ai messageId, dedupe pe el; aici n-avem, deci lăsăm fără dedupeKey
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

  const link = `/produs/${c.productId}#comment-${c.id}`;

  // ✅ dedupe atomic: un comment -> o notificare
  const dedupeKey = `product_comment_created:${vendorId}:${c.id}`;

  return createVendorNotification(vendorId, {
    dedupeKey,
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
      userId: true,
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

  const parent = await prisma.comment.findUnique({
    where: { id: c.parentId },
    select: { id: true, userId: true },
  });

  const parentUserId = parent?.userId || null;
  if (!parentUserId) return null;

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

  // ✅ dedupe atomic: un reply -> o notificare
  const dedupeKey = `product_comment_reply:${parentUserId}:${c.id}`;

  return createUserNotification(parentUserId, {
    dedupeKey,
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
 * ✅ dedupe atomic (fără spam) folosind dedupeKey.
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

  const link = "/vendor/visitors";

  // ✅ o singură notificare per service + follower
  const dedupeKey = `follow:${service.id}:${followerUserId || "anon"}`;

  return createVendorNotification(vendorId, {
    dedupeKey,
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

export async function notifyVendorOnAwbAssigned(orderId, shipmentId) {
  if (!orderId || !shipmentId) return null;

  const [order, shipment] = await Promise.all([
    prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
      },
    }),
    prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        vendorId: true,
        awb: true,
        labelUrl: true,
        trackingUrl: true,
      },
    }),
  ]);

  if (!order || !shipment?.vendorId) return null;

  const displayNo = order.orderNumber || order.id;

  const dedupeKey = `vendor_awb_assigned:${shipment.vendorId}:${shipment.id}:${shipment.awb || "noawb"}`;

  return createVendorNotification(shipment.vendorId, {
    dedupeKey,
    type: "shipping",
    title: `AWB disponibil pentru comanda #${displayNo}`,
    body: shipment.awb
      ? `AWB-ul a fost setat: ${shipment.awb}. Poți finaliza comanda după predare.`
      : `AWB-ul a fost setat. Poți finaliza comanda după predare.`,
    link: `/vendor/orders/${order.id}`,
    meta: {
      kind: "awb_assigned",
      orderId: order.id,
      orderNumber: order.orderNumber,
      shipmentId: shipment.id,
      awb: shipment.awb || null,
      labelUrl: shipment.labelUrl || null,
      trackingUrl: shipment.trackingUrl || null,
      vendorId: shipment.vendorId,
    },
  });
}
export async function notifyVendorOnProductModeration(productId, status, message) {
  if (!productId) return null;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      title: true,
      service: {
        select: {
          vendorId: true,
          profile: { select: { slug: true } },
        },
      },
    },
  });

  const vendorId = product?.service?.vendorId;
  if (!product || !vendorId) return null;

  const statusUc = String(status || "").toUpperCase();
  const isRejected = statusUc === "REJECTED";
  const productTitle = product.title || "produsul tău";

 return createVendorNotification(vendorId, {
  dedupeKey: `product_moderation:${statusUc}:${product.id}:${Date.now()}`,
  type: "system",
  title: isRejected ? "Produs respins" : "Produsul necesită modificări",
  body: isRejected
    ? `Produsul „${productTitle}” a fost respins.\n\nMotiv: ${message}`
    : `Produsul „${productTitle}” necesită modificări.\n\nMesaj admin: ${message}`,
  link: "/vendor/store",
  meta: {
    kind: "product_moderation",
    productId: product.id,
    vendorId,
    status: statusUc,
    message,
    storeSlug: product.service?.profile?.slug || null,
  },
});
}

export async function notifyVendorOnProductSoldOut(productId) {
  if (!productId) return null;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      title: true,
      readyQty: true,
      availability: true,
      service: {
        select: {
          vendorId: true,
          profile: {
            select: {
              slug: true,
              displayName: true,
            },
          },
        },
      },
    },
  });

  const vendorId = product?.service?.vendorId;
  if (!product || !vendorId) return null;

  const productTitle = product.title || "produsul tău";
  const storeName = product.service?.profile?.displayName || "magazinul tău";

  return createVendorNotification(vendorId, {
    dedupeKey: `product_sold_out:${product.id}`,
    type: "system",
    title: "Produs epuizat",
    body: `Produsul „${productTitle}” din ${storeName} a ajuns la stoc 0 și a fost marcat ca epuizat.`,
    link: "/vendor/store",
    meta: {
      kind: "product_sold_out",
      productId: product.id,
      vendorId,
      storeSlug: product.service?.profile?.slug || null,
      readyQty: product.readyQty,
      availability: product.availability,
    },
  });
}