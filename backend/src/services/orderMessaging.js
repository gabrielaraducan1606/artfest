// backend/src/services/orderMessaging.js
import { prisma } from "../db.js";
import { sendOrderCancelledEmail } from "../lib/mailer.js";

/**
 * Creează / recuperează thread user ↔ vendor (opțional legat de o comandă)
 */
async function ensureUserVendorThread({ userId, vendorId, orderId, shippingAddress }) {
  if (!userId || !vendorId) {
    throw new Error("Missing userId or vendorId pentru ensureUserVendorThread");
  }

  // 1) vedem dacă avem deja thread
  let thread = await prisma.messageThread.findFirst({
    where: {
      userId,
      vendorId,
    },
  });

  // 2) dacă nu există, îl creăm
  if (!thread) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });

    const contactName =
      shippingAddress?.name ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      null;

    const contactEmail =
      shippingAddress?.email || user?.email || null;

    const contactPhone =
      shippingAddress?.phone || user?.phone || null;

    thread = await prisma.messageThread.create({
      data: {
        userId,
        vendorId,
        orderId: orderId || null,
        contactName,
        contactEmail,
        contactPhone,
        archivedByUser: false,
        archived: false,
      },
    });
  } else if (!thread.orderId && orderId) {
    // legăm thread-ul de comandă, dacă nu era legat
    thread = await prisma.messageThread.update({
      where: { id: thread.id },
      data: { orderId },
    });
  }

  return thread;
}

/**
 * Template pentru mesajul automat de ANULARE comandă (de către vendor → client)
 */
function buildCancelledMessageBody({
  orderId,
  shortId,
  vendorName,
  cancelReason,
  cancelReasonNote,
}) {
  const prettyId = shortId || orderId;
  const storeName = vendorName || "magazinul nostru";

  let reasonText = "";

  switch (cancelReason) {
    case "client_no_answer":
      reasonText =
        "nu am reușit să vă contactăm telefonic pentru confirmarea comenzii.";
      break;
    case "client_request":
      reasonText = "ne-ați solicitat anularea comenzii.";
      break;
    case "stock_issue":
      reasonText =
        "produsele comandate nu mai sunt disponibile momentan (stoc epuizat).";
      break;
    case "address_issue":
      reasonText =
        "adresa de livrare este incompletă sau curierul nu poate livra la această adresă.";
      break;
    case "payment_issue":
      reasonText = "au fost probleme la procesarea plății.";
      break;
    case "other":
      reasonText = cancelReasonNote?.trim()
        ? cancelReasonNote.trim()
        : "a intervenit o situație neprevăzută.";
      break;
    default:
      reasonText =
        "a intervenit o situație care nu ne permite să onorăm comanda.";
  }

  return (
    `Bună ziua!\n\n` +
    `Comanda dvs. #${prettyId} a fost anulată de către ${storeName}.\n` +
    `Motiv: ${reasonText}\n\n` +
    `Dacă doriți mai multe detalii sau să plasați o nouă comandă, ne puteți răspunde direct la acest mesaj.`
  );
}

/**
 * Trimite mesaj AUTOMAT când o comandă este anulată de vendor.
 * Se cheamă din PATCH /api/vendor/orders/:id/status când status === "cancelled"
 */
export async function sendOrderCancelledMessage({
  orderId,
  shipmentId,
  shortShipmentId, // ex: s.id.slice(-6)
  userId,
  vendorId,
  shippingAddress,
  cancelReason,
  cancelReasonNote,
}) {
  if (!userId || !vendorId || !orderId) return;

  const [vendor, user] = await Promise.all([
    prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { displayName: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    }),
  ]);

  const thread = await ensureUserVendorThread({
    userId,
    vendorId,
    orderId,
    shippingAddress,
  });

  const body = buildCancelledMessageBody({
    orderId,
    shortId: shortShipmentId,
    vendorName: vendor?.displayName,
    cancelReason,
    cancelReasonNote,
  });

  const msg = await prisma.message.create({
    data: {
      threadId: thread.id,
      body,
      authorType: "VENDOR",
      authorName: vendor?.displayName || "Vânzător",
    },
  });

  await prisma.messageThread.update({
    where: { id: thread.id },
    data: {
      lastMsg: msg.body,
      lastAt: msg.createdAt,
      vendorLastReadAt: new Date(),
      archivedByUser: false, // readucem conversația în inbox-ul userului
    },
  });

  // dacă ai în model Order un câmp messageThreadId, îl poți lega aici:
  try {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        messageThreadId: thread.id,
      },
    });
  } catch (e) {
    // dacă nu există coloana în DB, ignori liniștit
  }

  // ✉️ Email automat către client (best-effort)
  try {
    const to =
      shippingAddress?.email ||
      user?.email ||
      null;

    if (to) {
      await sendOrderCancelledEmail({
        to,
        orderId,
        shortId: shortShipmentId,
        vendorName: vendor?.displayName,
        cancelReason,
        cancelReasonNote,
        shippingAddress,
      });
    }
  } catch (e) {
    console.error("sendOrderCancelledEmail failed:", e);
    // nu aruncăm mai departe, nu vrem să stricăm flow-ul de anulare
  }
}

/* ----------------------------------------------------
   NOTIFICĂRI când comanda este anulată de CLIENT
   - trimitem mesaje către toți vendorii implicați
----------------------------------------------------- */
export async function sendOrderCancelledByUserNotifications({
  orderId,
  userId,
}) {
  if (!orderId || !userId) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      shipments: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  if (!order) return;

  const shippingAddress = order.shippingAddress || null;
  const prettyId = order.shortId || order.id;
  const customerName =
    shippingAddress?.name ||
    [order.user?.firstName, order.user?.lastName].filter(Boolean).join(" ") ||
    "Client";

  // vendorId distincte din shipments
  const vendorIds = Array.from(
    new Set(
      order.shipments
        .map((s) => s.vendorId)
        .filter(Boolean)
    )
  );

  if (!vendorIds.length) return;

  const bodyTemplate = (vendorDisplayName) =>
    [
      `Bună ziua!`,
      ``,
      `Clientul ${customerName} a anulat comanda #${prettyId} din contul său.`,
      `Magazin: ${vendorDisplayName || "vânzător"}.`,
      ``,
      `Dacă aveți deja produse în lucru pentru această comandă, vă rugăm să-l contactați pe client pentru clarificări sau să folosiți acest thread pentru a comunica.`,
    ].join("\n");

  for (const vendorId of vendorIds) {
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { displayName: true },
    });

    const thread = await ensureUserVendorThread({
      userId,
      vendorId,
      orderId: order.id,
      shippingAddress,
    });

    const body = bodyTemplate(vendor?.displayName);

    const msg = await prisma.message.create({
      data: {
        threadId: thread.id,
        body,
        authorType: "USER",
        authorName: customerName,
      },
    });

    await prisma.messageThread.update({
      where: { id: thread.id },
      data: {
        lastMsg: msg.body,
        lastAt: msg.createdAt,
        vendorLastReadAt: null, // vendorul are mesaj NEcitit
        archived: false,
      },
    });
  }
}
