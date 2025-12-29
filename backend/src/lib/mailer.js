// backend/src/lib/mailer.js
import nodemailer from "nodemailer";
import { prisma } from "../db.js";
import {
  verificationEmailTemplate,
  resetPasswordEmailTemplate,
  passwordStaleReminderEmailTemplate,
  suspiciousLoginWarningEmailTemplate,
  vendorFollowUpReminderEmailTemplate,
  guestSupportConfirmationTemplate,
  guestSupportReplyTemplate,
  emailChangeVerificationTemplate,
  invoiceIssuedEmailTemplate,
  vendorDeactivateConfirmTemplate,
} from "./emailTemplates.js";

const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(
  /\/+$/,
  ""
);

const BRAND_NAME = process.env.BRAND_NAME || "Artfest";

/**
 * Logo pentru email (R2 / CDN).
 * Prioritate:
 * 1) EMAIL_LOGO_URL (URL complet)
 * 2) R2_PUBLIC_BASE_URL + EMAIL_LOGO_KEY
 * 3) fallback vechi (artfest.ro)
 */
const EMAIL_LOGO_URL =
  process.env.EMAIL_LOGO_URL ||
  (process.env.R2_PUBLIC_BASE_URL && process.env.EMAIL_LOGO_KEY
    ? `${process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${String(
        process.env.EMAIL_LOGO_KEY
      ).replace(/^\/+/, "")}`
    : "https://media.artfest.ro/branding/LogoArtfest.png");

/**
 * Configurare senders:
 * - noreply: pentru signup/reset/security/orders etc.
 * - contact: pentru suport (guest support)
 * - admin: pentru facturi/billing si confirmari administrative
 */
const SENDERS = {
  noreply: {
    user: process.env.SMTP_USER_NOREPLY,
    pass: process.env.SMTP_PASS_NOREPLY,
    from:
      process.env.EMAIL_FROM_NOREPLY ||
      `Artfest <${process.env.SMTP_USER_NOREPLY || ""}>`,
    replyTo: process.env.EMAIL_REPLY_TO_CONTACT || undefined,
  },
  contact: {
    user: process.env.SMTP_USER_CONTACT,
    pass: process.env.SMTP_PASS_CONTACT,
    from:
      process.env.EMAIL_FROM_CONTACT ||
      `Artfest <${process.env.SMTP_USER_CONTACT || ""}>`,
    replyTo:
      process.env.EMAIL_REPLY_TO_CONTACT ||
      process.env.SMTP_USER_CONTACT ||
      undefined,
  },
  admin: {
    user: process.env.SMTP_USER_ADMIN,
    pass: process.env.SMTP_PASS_ADMIN,
    from:
      process.env.EMAIL_FROM_ADMIN ||
      `Artfest <${process.env.SMTP_USER_ADMIN || ""}>`,
    replyTo: process.env.EMAIL_REPLY_TO_CONTACT || undefined,
  },
};

// cache transportere ca sa nu recreezi conexiunea mereu
const transportCache = new Map();

export function makeTransport(senderKey = "noreply") {
  const port = Number(process.env.SMTP_PORT || 587);
  const host = process.env.SMTP_HOST;

  if (!host) throw new Error("Missing SMTP_HOST");
  const sender = SENDERS[senderKey];
  if (!sender) throw new Error(`Unknown senderKey: ${senderKey}`);

  if (!sender.user)
    throw new Error(`Missing SMTP_USER for sender "${senderKey}"`);
  if (!sender.pass)
    throw new Error(`Missing SMTP_PASS for sender "${senderKey}"`);

  const cacheKey = `${senderKey}:${sender.user}:${host}:${port}`;
  if (transportCache.has(cacheKey)) return transportCache.get(cacheKey);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user: sender.user, pass: sender.pass },
  });

  transportCache.set(cacheKey, transporter);
  return transporter;
}

function senderEnvelope(senderKey = "noreply") {
  const sender = SENDERS[senderKey];
  return {
    from: sender?.from,
    replyTo: sender?.replyTo,
  };
}

/* ============================================================
   === LOGO INLINE (CID) - ROBUST (fetch -> buffer + cache)
   ============================================================ */

const LOGO_CID = "logo-artfest";

// cache în memorie (o singură descărcare)
let cachedLogo = null;

async function getLogoAttachment() {
  if (cachedLogo) return cachedLogo;

  const res = await fetch(EMAIL_LOGO_URL);
  if (!res.ok) throw new Error(`Logo fetch failed: ${res.status}`);

  const contentType = res.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await res.arrayBuffer());

  if (!buffer?.length) throw new Error("Logo buffer is empty");

  cachedLogo = {
    filename: "logo.png",
    content: buffer.toString("base64"),
    encoding: "base64",
    cid: LOGO_CID,
    contentType,
    contentDisposition: "inline",
  };

  return cachedLogo;
}

async function withLogo(templateFn, props = {}) {
  const { html, text, subject } = templateFn({
    brandName: BRAND_NAME,
    logoCid: LOGO_CID,
    logoUrl: EMAIL_LOGO_URL,
    ...props,
  });

  const logoAttachment = await getLogoAttachment();
  return { html, text, subject, logoAttachment };
}

const AUTO_HEADERS = {
  "Auto-Submitted": "auto-generated",
  "X-Auto-Response-Suppress": "All",
  Precedence: "bulk",
};

/* ============================================================
   === HELPERS
   ============================================================ */

function formatMoney(value, currency = "RON") {
  const v = Number(value || 0);
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function stripHtml(html = "") {
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/* ============================================================
   === EMAIL LOGGING (Prisma EmailLog)
   ============================================================ */

function safeStr(v, max = 1000) {
  const s = v == null ? "" : String(v);
  return s.length > max ? s.slice(0, max) : s;
}

async function createEmailLogQueued({
  userId = null,
  toEmail,
  toName = null,
  senderKey,
  fromEmail = null,
  replyTo = null,
  template = null,
  subject,
  provider = "smtp",
  orderId = null,
  ticketId = null,
}) {
  // dacă tabelul nu există încă (înainte de migrate), să nu-ți crape aplicația
  try {
    return await prisma.emailLog.create({
      data: {
        userId,
        toEmail,
        toName,
        senderKey,
        fromEmail,
        replyTo,
        template,
        subject,
        provider,
        status: "QUEUED",
        orderId,
        ticketId,
      },
      select: { id: true },
    });
  } catch (e) {
    // optional: console.warn("email log create failed:", e?.message);
    return null;
  }
}

async function markEmailLogSent(id, meta = {}) {
  try {
    return await prisma.emailLog.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        messageId: meta.messageId ? safeStr(meta.messageId, 255) : null,
        provider: meta.provider ? safeStr(meta.provider, 64) : null,
        error: null,
      },
    });
  } catch {
    return null;
  }
}

async function markEmailLogFailed(id, err) {
  try {
    const msg = safeStr(err?.message || err || "unknown_error", 1000);
    return await prisma.emailLog.update({
      where: { id },
      data: {
        status: "FAILED",
        error: msg,
      },
    });
  } catch {
    return null;
  }
}

async function sendMailLogged({
  senderKey,
  to,
  subject,
  template = null,
  userId = null,
  orderId = null,
  ticketId = null,
  toName = null,
  headers = null,
  mailOptions,
}) {
  const sender = SENDERS[senderKey] || {};
  const fromEmail = sender.user || null;
  const replyTo = sender.replyTo || null;

  const log = await createEmailLogQueued({
    userId,
    toEmail: to,
    toName,
    senderKey,
    fromEmail,
    replyTo,
    template,
    subject,
    provider: "smtp",
    orderId,
    ticketId,
  });

  try {
    const transporter = makeTransport(senderKey);
    const res = await transporter.sendMail({
      ...mailOptions,
      headers: headers || mailOptions.headers,
    });

    if (log?.id) {
      await markEmailLogSent(log.id, {
        provider: "smtp",
        messageId: res?.messageId,
      });
    }

    return res;
  } catch (err) {
    if (log?.id) await markEmailLogFailed(log.id, err);
    throw err;
  }
}

/* ============================================================
   === GUEST SUPPORT EMAILS (sender: contact@)
   ============================================================ */

export async function sendGuestSupportConfirmationEmail({
  to,
  name,
  subject,
  message,
  userId = null,
  ticketId = null,
}) {
  const { html, text, subject: emailSubject, logoAttachment } =
    await withLogo(guestSupportConfirmationTemplate, { name, subject, message });

  return sendMailLogged({
    senderKey: "contact",
    to,
    subject: emailSubject,
    template: "guest_support_confirmation",
    userId,
    ticketId,
    toName: name || null,
    mailOptions: {
      ...senderEnvelope("contact"),
      to,
      subject: emailSubject,
      html,
      text,
      attachments: [logoAttachment],
    },
  });
}

export async function sendGuestSupportReplyEmail({
  to,
  name,
  subject,
  reply,
  userId = null,
  ticketId = null,
}) {
  const { html, text, subject: emailSubject, logoAttachment } = await withLogo(
    guestSupportReplyTemplate,
    { name, subject, reply }
  );

  return sendMailLogged({
    senderKey: "contact",
    to,
    subject: emailSubject,
    template: "guest_support_reply",
    userId,
    ticketId,
    toName: name || null,
    mailOptions: {
      ...senderEnvelope("contact"),
      to,
      subject: emailSubject,
      html,
      text,
      attachments: [logoAttachment],
    },
  });
}

/* ============================================================
   === AUTH / SECURITY EMAILS (sender: no-reply@)
   ============================================================ */

export async function sendVerificationEmail({ to, link, userId = null }) {
  const { html, text, subject, logoAttachment } = await withLogo(
    verificationEmailTemplate,
    { link }
  );

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "verify_email",
    userId,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

export async function sendPasswordResetEmail({ to, link, userId = null }) {
  const { html, text, subject, logoAttachment } = await withLogo(
    resetPasswordEmailTemplate,
    { link }
  );

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "reset_password",
    userId,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

export async function sendEmailChangeVerificationEmail({
  to,
  link,
  userId = null,
}) {
  const { html, text, subject, logoAttachment } = await withLogo(
    emailChangeVerificationTemplate,
    { link }
  );

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "email_change_verify",
    userId,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   === MARKETING (sender: no-reply@)
   ============================================================ */

export async function sendMarketingEmail({
  to,
  subject,
  html,
  preheader,
  userId = null,
}) {
  if (!to || !subject || !html) return;

  const logoAttachment = await getLogoAttachment();

  const finalHtml = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    ${
      preheader
        ? `<span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">
        ${preheader}
      </span>`
        : ""
    }

    <div style="text-align:center;margin-bottom:20px;">
      <img src="cid:${LOGO_CID}" alt="${BRAND_NAME} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>

    <div style="background:#ffffff;border-radius:12px;padding:18px 16px;border:1px solid #e5e7eb;">
      ${html}
    </div>

    <p style="font-size:11px;color:#9ca3af;text-align:center;margin:16px 0 0;">
      Primești acest email pentru că ți-ai dat acordul să primești comunicări de marketing de la ${BRAND_NAME}.
      Dacă nu mai vrei să primești astfel de mesaje, folosește linkul de dezabonare din email.
    </p>
  </div>
  `;

  const text = stripHtml(html);

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "marketing",
    userId,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html: finalHtml,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   === INACTIVE ACCOUNT (sender: no-reply@)
   ============================================================ */

export async function sendInactiveAccountWarningEmail({
  to,
  deleteAt,
  userId = null,
}) {
  if (!to || !deleteAt) return;

  const logoAttachment = await getLogoAttachment();

  const dateStr = deleteAt.toLocaleDateString("ro-RO", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const subject = `Contul tău va fi șters pentru inactivitate`;

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="cid:${LOGO_CID}" alt="${BRAND_NAME} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>

    <h2 style="color:#111827;margin:0 0 12px;">Contul tău este inactiv</h2>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Contul tău pe <strong>${BRAND_NAME}</strong> nu a mai fost folosit de mult timp.
    </p>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Din motive de securitate și protecția datelor, contul va fi <strong>șters definitiv</strong>
      dacă nu te conectezi până la data de <strong>${dateStr}</strong>.
    </p>
    <p style="color:#374151;margin:0 0 16px;line-height:1.5;">
      Pentru a păstra contul activ, autentifică-te în platformă înainte de această dată.
    </p>

    ${
      APP_URL
        ? `<p style="text-align:center;margin:24px 0 0;">
        <a href="${APP_URL}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Mergi la ${BRAND_NAME}
        </a>
      </p>`
        : ""
    }

    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email a fost generat automat de ${BRAND_NAME}. Te rugăm să nu răspunzi la acest mesaj.
    </p>
  </div>
  `;

  const text = [
    `Contul tău pe ${BRAND_NAME} este inactiv.`,
    `Va fi șters definitiv dacă nu te conectezi până la data de ${dateStr}.`,
    APP_URL ? `Poți accesa platforma la: ${APP_URL}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "inactive_account_warning",
    userId,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   === ORDERS (sender: no-reply@)
   ============================================================ */

export async function sendOrderConfirmationEmail({
  to,
  order,
  items,
  storeAddresses,
  userId = null,
}) {
  if (!to || !order) return;

  const logoAttachment = await getLogoAttachment();

  const currency = order.currency || "RON";
  const total = formatMoney(order.total, currency);
  const subtotal = formatMoney(order.subtotal, currency);
  const shippingTotal = formatMoney(order.shippingTotal, currency);

  const address = order.shippingAddress || {};
  const customerName =
    address.name ||
    `${address.lastName || ""} ${address.firstName || ""}`.trim() ||
    "client";

  const orderLink = APP_URL
    ? `${APP_URL}/comenzile-mele?order=${encodeURIComponent(order.id)}`
    : null;

  const itemsRows =
    (items || [])
      .map(
        (it) => `
      <tr>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;">
          ${it.title}
        </td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">
          x${it.qty}
        </td>
        <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">
          ${formatMoney(it.price * it.qty, currency)}
        </td>
      </tr>
    `
      )
      .join("") ||
    `
      <tr>
        <td colspan="3" style="padding:8px;text-align:center;color:#6b7280;">
          Detaliile produselor nu sunt disponibile.
        </td>
      </tr>
    `;

  const storeAddressesMap =
    storeAddresses || (order.meta && order.meta.storeAddresses) || null;

  let storeAddressesHtml = "";
  let storeAddressesTextLines = [];

  if (storeAddressesMap && typeof storeAddressesMap === "object") {
    const entries = Object.values(storeAddressesMap);
    if (entries.length) {
      storeAddressesHtml = `
      <h3 style="color:#111827;margin:20px 0 8px;font-size:16px;">Adrese retur magazine</h3>
      <div style="color:#374151;margin:0 0 16px;line-height:1.5;">
        ${entries
          .map((a) => {
            const line1 = a.street || "";
            const line2 = [a.postalCode, a.city].filter(Boolean).join(" ");
            const line3 = [a.county, a.country].filter(Boolean).join(", ");
            return `
              <p style="margin:0 0 8px;">
                <strong>${a.name || "Magazin"}</strong><br>
                ${line1}${line1 && (line2 || line3) ? "<br>" : ""}
                ${line2 || ""}${line2 && line3 ? "<br>" : ""}
                ${line3 || ""}
              </p>
            `;
          })
          .join("")}
      </div>
      `;

      storeAddressesTextLines = entries.flatMap((a) => {
        const lines = [];
        lines.push(`- ${a.name || "Magazin"}`);
        if (a.street) lines.push(`  ${a.street}`);
        const cityLine = [a.postalCode, a.city].filter(Boolean).join(" ");
        if (cityLine) lines.push(`  ${cityLine}`);
        const regionLine = [a.county, a.country].filter(Boolean).join(", ");
        if (regionLine) lines.push(`  ${regionLine}`);
        return lines;
      });
    }
  }

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="cid:${LOGO_CID}" alt="${BRAND_NAME} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>

    <h2 style="color:#111827;margin:0 0 8px;">Mulțumim pentru comandă, ${customerName}!</h2>
    <p style="color:#374151;margin:0 0 12px;">
      Comanda ta pe <strong>${BRAND_NAME}</strong> a fost înregistrată cu succes.
    </p>
    <p style="color:#374151;margin:0 0 16px;">
      <strong>Număr comandă:</strong> ${order.id}<br>
      <strong>Metodă de plată:</strong> ${
        order.paymentMethod === "COD" ? "Plată la livrare (ramburs)" : "Card online"
      }
    </p>

    <h3 style="color:#111827;margin:16px 0 8px;font-size:16px;">Produse comandate</h3>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#ffffff;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th align="left" style="padding:8px 8px;font-size:14px;color:#374151;">Produs</th>
          <th align="center" style="padding:8px 8px;font-size:14px;color:#374151;">Cantitate</th>
          <th align="right" style="padding:8px 8px;font-size:14px;color:#374151;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="padding:8px 8px;text-align:right;color:#4b5563;">Subtotal</td>
          <td style="padding:8px 8px;text-align:right;"><strong>${subtotal}</strong></td>
        </tr>
        <tr>
          <td colspan="2" style="padding:4px 8px;text-align:right;color:#4b5563;">Transport</td>
          <td style="padding:4px 8px;text-align:right;"><strong>${shippingTotal}</strong></td>
        </tr>
        <tr>
          <td colspan="2" style="padding:8px 8px;text-align:right;color:#111827;">Total</td>
          <td style="padding:8px 8px;text-align:right;font-size:16px;"><strong>${total}</strong></td>
        </tr>
      </tfoot>
    </table>

    <h3 style="color:#111827;margin:20px 0 8px;font-size:16px;">Adresă livrare</h3>
    <p style="color:#374151;margin:0 0 16px;line-height:1.5;">
      ${customerName}<br>
      ${address.street || ""}<br>
      ${address.postalCode || ""} ${address.city || ""}<br>
      ${address.county || ""}<br>
      Tel: ${address.phone || ""}
    </p>

    ${storeAddressesHtml}

    ${
      orderLink
        ? `
      <p style="text-align:center;margin:24px 0 12px;">
        <a href="${orderLink}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Vezi comanda în contul tău
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;margin:0 0 8px;text-align:center;">
        Sau accesează linkul: <a href="${orderLink}" style="color:#4f46e5;">${orderLink}</a>
      </p>
    `
        : ""
    }

    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email a fost generat automat de ${BRAND_NAME}. Te rugăm să nu răspunzi la acest mesaj.
    </p>
  </div>
  `;

  const textLines = [
    `Mulțumim pentru comandă, ${customerName}!`,
    "",
    `Comanda ta pe ${BRAND_NAME} a fost înregistrată.`,
    `Număr comandă: ${order.id}`,
    `Metodă de plată: ${
      order.paymentMethod === "COD" ? "Plată la livrare (ramburs)" : "Card online"
    }`,
    "",
    "Produse:",
    ...(items || []).map(
      (it) =>
        `- ${it.title} x${it.qty} = ${formatMoney(it.price * it.qty, currency)}`
    ),
    "",
    `Subtotal: ${subtotal}`,
    `Transport: ${shippingTotal}`,
    `Total: ${total}`,
    "",
    "Adresă livrare:",
    `${customerName}`,
    address.street || "",
    `${address.postalCode || ""} ${address.city || ""}`.trim(),
    address.county || "",
    address.phone ? `Tel: ${address.phone}` : "",
    "",
    storeAddressesTextLines.length ? "Adrese retur magazine:" : "",
    ...storeAddressesTextLines,
    "",
    orderLink ? `Poți vedea comanda aici: ${orderLink}` : "",
  ].filter(Boolean);

  const text = textLines.join("\n");
  const subject = `Confirmare comandă #${order.id} - ${BRAND_NAME}`;

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "order_confirmation",
    userId,
    orderId: order.id,
    toName: customerName,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

/**
 * ✉️ Email „comanda a fost anulată de vendor” (sender: no-reply@)
 */
export async function sendOrderCancelledEmail({
  to,
  orderId,
  shortId,
  vendorName,
  cancelReason,
  cancelReasonNote,
  shippingAddress,
  userId = null,
}) {
  if (!to || !orderId) return;

  const logoAttachment = await getLogoAttachment();

  const prettyId = shortId || orderId;
  const storeName = vendorName || BRAND_NAME || "magazinul nostru";

  let reasonText = "";

  switch (cancelReason) {
    case "client_no_answer":
      reasonText =
        "nu am reușit să vă contactăm telefonic pentru confirmarea comenzii.";
      break;
    case "client_request":
      reasonText = "ați solicitat anularea comenzii.";
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

  const address = shippingAddress || {};
  const customerName =
    address.name ||
    `${address.lastName || ""} ${address.firstName || ""}`.trim() ||
    "client";

  const orderLink = APP_URL
    ? `${APP_URL}/comenzile-mele?order=${encodeURIComponent(orderId)}`
    : null;

  const subject = `Comanda ta #${prettyId} a fost anulată - ${BRAND_NAME}`;

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="cid:${LOGO_CID}" alt="${BRAND_NAME} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>

    <h2 style="color:#111827;margin:0 0 8px;">Comanda ta a fost anulată</h2>
    <p style="color:#374151;margin:0 0 8px;">
      Bună, <strong>${customerName}</strong>,
    </p>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Comanda ta cu numărul <strong>#${prettyId}</strong> la <strong>${storeName}</strong> a fost anulată.
    </p>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      <strong>Motiv:</strong> ${reasonText}
    </p>
    <p style="color:#6b7280;margin:0 0 16px;line-height:1.5;font-size:14px;">
      Dacă ai întrebări sau dorești să refaci comanda, ne poți contacta din contul tău sau prin intermediul acestui email.
    </p>

    ${
      orderLink
        ? `
      <p style="text-align:center;margin:24px 0 12px;">
        <a href="${orderLink}" style="background:#ef4444;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Vezi detaliile comenzii
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;margin:0 0 8px;text-align:center;">
        Sau accesează linkul: <a href="${orderLink}" style="color:#ef4444;">${orderLink}</a>
      </p>
    `
        : ""
    }

    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email a fost generat automat de ${BRAND_NAME}. Te rugăm să nu răspunzi la acest mesaj.
    </p>
  </div>
  `;

  const textLines = [
    `Bună, ${customerName},`,
    "",
    `Comanda ta #${prettyId} la ${storeName} a fost anulată.`,
    `Motiv: ${reasonText}`,
    "",
    orderLink ? `Poți vedea detaliile comenzii aici: ${orderLink}` : "",
  ].filter(Boolean);

  const text = textLines.join("\n");

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "order_cancelled_vendor",
    userId,
    orderId,
    toName: customerName,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

/**
 * ✉️ Email „comanda a fost anulată de CLIENT” (sender: no-reply@)
 */
export async function sendOrderCancelledByUserEmail({
  to,
  order,
  userId = null,
}) {
  if (!to || !order) return;

  const logoAttachment = await getLogoAttachment();

  const prettyId = order.shortId || order.id;
  const address = order.shippingAddress || {};
  const customerName =
    address.name ||
    `${address.lastName || ""} ${address.firstName || ""}`.trim() ||
    "client";

  const currency = order.currency || "RON";
  const subtotal = formatMoney(order.subtotal || 0, currency);
  const shippingTotal = formatMoney(order.shippingTotal || 0, currency);
  const total = formatMoney(order.total || 0, currency);

  const orderLink = APP_URL
    ? `${APP_URL}/comenzile-mele?order=${encodeURIComponent(order.id)}`
    : null;

  const subject = `Ai anulat comanda #${prettyId} - ${BRAND_NAME}`;

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="cid:${LOGO_CID}" alt="${BRAND_NAME} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>

    <h2 style="color:#111827;margin:0 0 8px;">Ai anulat o comandă</h2>
    <p style="color:#374151;margin:0 0 8px;">
      Bună, <strong>${customerName}</strong>,
    </p>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Comanda ta cu numărul <strong>#${prettyId}</strong> pe <strong>${BRAND_NAME}</strong> a fost anulată din contul tău.
    </p>

    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      <strong>Rezumat:</strong><br>
      Subtotal: ${subtotal}<br>
      Transport: ${shippingTotal}<br>
      Total: ${total}
    </p>

    ${
      orderLink
        ? `
      <p style="text-align:center;margin:24px 0 12px;">
        <a href="${orderLink}" style="background:#4b5563;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Vezi istoricul comenzilor
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;margin:0 0 8px;text-align:center;">
        Sau accesează linkul: <a href="${orderLink}" style="color:#4b5563;">${orderLink}</a>
      </p>
    `
        : ""
    }

    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email a fost generat automat de ${BRAND_NAME}. Te rugăm să nu răspunzi la acest mesaj.
    </p>
  </div>
  `;

  const textLines = [
    `Bună, ${customerName},`,
    "",
    `Ai anulat comanda #${prettyId} pe ${BRAND_NAME}.`,
    `Subtotal: ${subtotal}`,
    `Transport: ${shippingTotal}`,
    `Total: ${total}`,
    "",
    orderLink ? `Poți vedea istoricul comenzilor aici: ${orderLink}` : "",
  ].filter(Boolean);

  const text = textLines.join("\n");

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "order_cancelled_user",
    userId,
    orderId: order.id,
    toName: customerName,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   === SECURITY (sender: no-reply@)
   ============================================================ */

export async function sendPasswordStaleReminderEmail({
  to,
  passwordAgeDays,
  maxPasswordAgeDays,
  userId = null,
}) {
  if (!to) return;

  const { html, text, subject, logoAttachment } = await withLogo(
    passwordStaleReminderEmailTemplate,
    {
      passwordAgeDays,
      maxPasswordAgeDays,
      link: APP_URL || undefined,
    }
  );

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "password_stale_reminder",
    userId,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

export async function sendSuspiciousLoginWarningEmail({ to, userId = null }) {
  if (!to) return;

  const { html, text, subject, logoAttachment } = await withLogo(
    suspiciousLoginWarningEmailTemplate,
    { link: APP_URL || undefined }
  );

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "suspicious_login_warning",
    userId,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   === VENDOR FOLLOW-UP (sender: no-reply@)
   ============================================================ */

export async function sendVendorFollowUpReminderEmail({
  to,
  contactName,
  followUpAt,
  threadLink,
  userId = null,
}) {
  if (!to) return;

  const fullLink =
    threadLink && APP_URL
      ? `${APP_URL.replace(/\/+$/, "")}${threadLink}`
      : undefined;

  const { html, text, subject, logoAttachment } = await withLogo(
    vendorFollowUpReminderEmailTemplate,
    {
      contactName,
      followUpAt,
      link: fullLink,
    }
  );

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "vendor_followup_reminder",
    userId,
    toName: contactName || null,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   === INVOICE (sender: admin@)
   ============================================================ */

export async function sendInvoiceIssuedEmail({
  to,
  orderId,
  invoiceNumber,
  totalGross,
  currency = "RON",
  invoiceFrontendPath,
  userId = null,
}) {
  if (!to || !orderId) return;

  const totalLabel = formatMoney(totalGross || 0, currency);

  const baseUrl = APP_URL ? APP_URL.replace(/\/+$/, "") : null;
  const link =
    baseUrl && invoiceFrontendPath
      ? `${baseUrl}${invoiceFrontendPath}`
      : baseUrl
      ? `${baseUrl}/comenzile-mele?order=${encodeURIComponent(orderId)}`
      : undefined;

  const { html, text, subject, logoAttachment } = await withLogo(
    invoiceIssuedEmailTemplate,
    {
      orderId,
      invoiceNumber,
      totalLabel,
      link,
    }
  );

  return sendMailLogged({
    senderKey: "admin",
    to,
    subject,
    template: "invoice_issued",
    userId,
    orderId,
    mailOptions: {
      ...senderEnvelope("admin"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   === SHIPMENT PICKUP (sender: no-reply@)
   ============================================================ */

export async function sendShipmentPickupEmail({
  to,
  orderId,
  awb,
  trackingUrl,
  etaLabel,
  slotLabel,
  userId = null,
}) {
  if (!to) return;

  const logoAttachment = await getLogoAttachment();

  const baseUrl = APP_URL ? APP_URL.replace(/\/+$/, "") : null;
  const orderLink = baseUrl
    ? `${baseUrl}/comenzile-mele?order=${encodeURIComponent(orderId)}`
    : null;

  const subject = `Comanda ta a fost predată curierului - ${BRAND_NAME}`;

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="cid:${LOGO_CID}" alt="${BRAND_NAME} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>

    <h2 style="color:#111827;margin:0 0 8px;">Comanda ta este în drum spre tine 🚚</h2>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Comanda ta pe <strong>${BRAND_NAME}</strong> a fost predată curierului.
    </p>

    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      <strong>Număr comandă:</strong> ${orderId}<br>
      <strong>AWB:</strong> ${awb || "-"}<br>
      <strong>Livrare estimată:</strong> ${etaLabel || "-"} în intervalul ${
        slotLabel || "-"
      }
    </p>

    ${
      trackingUrl
        ? `
    <p style="text-align:center;margin:18px 0;">
      <a href="${trackingUrl}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Urmărește coletul
      </a>
    </p>
    <p style="color:#6b7280;font-size:13px;margin:0 0 8px;text-align:center;">
      Sau accesează linkul: <a href="${trackingUrl}" style="color:#4f46e5;">${trackingUrl}</a>
    </p>
    `
        : ""
    }

    ${
      orderLink
        ? `
    <p style="color:#6b7280;font-size:13px;margin:16px 0 0;text-align:center;">
      Poți vedea detaliile comenzii aici: <a href="${orderLink}" style="color:#4b5563;">${orderLink}</a>
    </p>
    `
        : ""
    }

    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email a fost generat automat de ${BRAND_NAME}. Te rugăm să nu răspunzi la acest mesaj.
    </p>
  </div>
  `;

  const textLines = [
    `Comanda ta pe ${BRAND_NAME} a fost predată curierului.`,
    `Număr comandă: ${orderId}`,
    awb ? `AWB: ${awb}` : "",
    etaLabel || slotLabel
      ? `Livrare estimată: ${etaLabel || ""} în intervalul ${slotLabel || ""}`.trim()
      : "",
    trackingUrl ? `Poți urmări coletul aici: ${trackingUrl}` : "",
    orderLink ? `Detalii comandă: ${orderLink}` : "",
  ].filter(Boolean);

  const text = textLines.join("\n");

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "shipment_pickup",
    userId,
    orderId,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   === VENDOR DEACTIVATE CONFIRM (sender: admin@)
   ============================================================ */

export async function sendVendorDeactivateConfirmEmail({
  to,
  link,
  userId = null,
}) {
  if (!to || !link) return;

  const { html, text, subject, logoAttachment } = await withLogo(
    vendorDeactivateConfirmTemplate,
    { link }
  );

  return sendMailLogged({
    senderKey: "admin",
    to,
    subject,
    template: "vendor_deactivate_confirm",
    userId,
    mailOptions: {
      ...senderEnvelope("admin"),
      to,
      subject,
      html,
      text,
      attachments: [logoAttachment],
      headers: AUTO_HEADERS,
    },
  });
}
