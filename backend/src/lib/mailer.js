// backend/src/lib/mailer.js
import nodemailer from "nodemailer";
import { prisma } from "../db.js";
import { Resend } from "resend";

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
  userSupportReplyTemplate,
} from "./emailTemplates.js";

import { signUnsubToken } from "./unsubscribe.js";

const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");
const BRAND_NAME = process.env.BRAND_NAME || "Artfest";

// IMPORTANT pentru one-click unsubscribe (List-Unsubscribe):
// Trebuie să fie un URL public HTTPS către backend (unde ai /unsubscribe).
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || process.env.API_URL || "").replace(/\/+$/, "");
const UNSUBSCRIBE_BASE_URL = (PUBLIC_API_URL || APP_URL || "").replace(/\/+$/, "");

/**
 * Provider selection:
 * - MAIL_PROVIDER=smtp | resend | auto
 *   - auto: dacă există RESEND_API_KEY => resend, altfel smtp
 */
const MAIL_PROVIDER = (process.env.MAIL_PROVIDER || "auto").toLowerCase();

function resolveProvider() {
  if (MAIL_PROVIDER === "smtp" || MAIL_PROVIDER === "resend") return MAIL_PROVIDER;
  return process.env.RESEND_API_KEY ? "resend" : "smtp";
}

/**
 * Logo pentru email (URL, fără CID/attachments).
 * Prioritate:
 * 1) EMAIL_LOGO_URL
 * 2) R2_PUBLIC_BASE_URL + EMAIL_LOGO_KEY
 * 3) fallback
 */
const EMAIL_LOGO_URL =
  process.env.EMAIL_LOGO_URL ||
  (process.env.R2_PUBLIC_BASE_URL && process.env.EMAIL_LOGO_KEY
    ? `${process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${String(process.env.EMAIL_LOGO_KEY).replace(
        /^\/+/,
        ""
      )}`
    : "https://media.artfest.ro/branding/LogoArtfest.png");

/**
 * Configurare senders (Zoho SMTP) - compatibil cu variabilele tale:
 * SMTP_USER_NOREPLY / SMTP_PASS_NOREPLY etc.
 */
function sanitizeEmailValue(v) {
  // în .env ai avut un punct la final: contact@artfest.ro.
  // îl curățăm ca să nu ajungă în reply-to/from
  const s = (v || "").trim();
  return s.endsWith(".") ? s.slice(0, -1) : s;
}
const CONTACT_EMAIL =
  sanitizeEmailValue(process.env.EMAIL_REPLY_TO_CONTACT) ||
  sanitizeEmailValue(process.env.SMTP_USER_CONTACT) ||
  undefined;

const SUPPORT_EMAIL =
  sanitizeEmailValue(process.env.EMAIL_REPLY_TO_SUPPORT) ||
  sanitizeEmailValue(process.env.SMTP_USER_SUPPORT) ||
  undefined;

const SENDERS = {
  noreply: {
    user: sanitizeEmailValue(process.env.SMTP_USER_NOREPLY),
    pass: process.env.SMTP_PASS_NOREPLY,
    from: process.env.EMAIL_FROM_NOREPLY || `Artfest <${sanitizeEmailValue(process.env.SMTP_USER_NOREPLY) || ""}>`,
    replyTo: sanitizeEmailValue(process.env.EMAIL_REPLY_TO_CONTACT) || undefined,
  },

  contact: {
    user: sanitizeEmailValue(process.env.SMTP_USER_CONTACT),
    pass: process.env.SMTP_PASS_CONTACT,
    from: process.env.EMAIL_FROM_CONTACT || `Artfest <${sanitizeEmailValue(process.env.SMTP_USER_CONTACT) || ""}>`,
    replyTo:
      sanitizeEmailValue(process.env.EMAIL_REPLY_TO_CONTACT) ||
      sanitizeEmailValue(process.env.SMTP_USER_CONTACT) ||
      undefined,
  },

  // ✅ NOU: support@ (pentru Guest Support)
  support: {
    user: sanitizeEmailValue(process.env.SMTP_USER_SUPPORT),
    pass: process.env.SMTP_PASS_SUPPORT,
    from:
      process.env.EMAIL_FROM_SUPPORT ||
      `Artfest Support <${sanitizeEmailValue(process.env.SMTP_USER_SUPPORT) || ""}>`,
    replyTo:
      sanitizeEmailValue(process.env.EMAIL_REPLY_TO_SUPPORT) ||
      sanitizeEmailValue(process.env.SMTP_USER_SUPPORT) ||
      undefined,
  },

  admin: {
    user: sanitizeEmailValue(process.env.SMTP_USER_ADMIN),
    pass: process.env.SMTP_PASS_ADMIN,
    from: process.env.EMAIL_FROM_ADMIN || `Artfest <${sanitizeEmailValue(process.env.SMTP_USER_ADMIN) || ""}>`,
    replyTo: sanitizeEmailValue(process.env.EMAIL_REPLY_TO_CONTACT) || undefined,
  },
};

// cache transportere SMTP
const transportCache = new Map();

export function makeTransport(senderKey = "noreply") {
  const port = Number(process.env.SMTP_PORT || 587);
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error("Missing SMTP_HOST");

  const sender = SENDERS[senderKey];
  if (!sender) throw new Error(`Unknown senderKey: ${senderKey}`);
  if (!sender.user) throw new Error(`Missing SMTP_USER for sender "${senderKey}"`);
  if (!sender.pass) throw new Error(`Missing SMTP_PASS for sender "${senderKey}"`);

  const cacheKey = `${senderKey}:${sender.user}:${host}:${port}`;
  if (transportCache.has(cacheKey)) return transportCache.get(cacheKey);

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // Zoho 587 => STARTTLS (secure:false)
    auth: { user: sender.user, pass: sender.pass },
  });

  transportCache.set(cacheKey, transporter);
  return transporter;
}

function senderEnvelope(senderKey = "noreply", opts = {}) {
  const sender = SENDERS[senderKey];
  const replyTo = opts?.replyTo ? sanitizeEmailValue(opts.replyTo) : sender?.replyTo;

  return {
    from: sender?.from,
    ...(replyTo ? { replyTo } : {}),
  };
}

/* ============================================================
   TEMPLATE HELPERS (logo URL-only)
============================================================ */
async function withLogo(templateFn, props = {}) {
  // Nu mai trimitem logoCid, nu mai atașăm nimic.
  return templateFn({
    brandName: BRAND_NAME,
    logoUrl: EMAIL_LOGO_URL,
    ...props,
  });
}

const AUTO_HEADERS = {
  "Auto-Submitted": "auto-generated",
  "X-Auto-Response-Suppress": "All",
  Precedence: "bulk",
};

/* ============================================================
   UNSUBSCRIBE (one-click)
============================================================ */
function buildUnsubscribeLink({ email, category = "marketing" }) {
  if (!UNSUBSCRIBE_BASE_URL) return null;

  const token = signUnsubToken({
    email: String(email || "").trim().toLowerCase(),
    category,
    ts: Date.now(),
  });

  return `${UNSUBSCRIBE_BASE_URL}/unsubscribe?token=${encodeURIComponent(token)}`;
}

function buildListUnsubscribeHeaders({ email, category = "marketing" }) {
  const url = buildUnsubscribeLink({ email, category });
  if (!url) return {};

  return {
    "List-Unsubscribe": `<${url}>`,
    // RFC 8058 one-click
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/* ============================================================
   HELPERS
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
  return String(html)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ============================================================
   EMAIL LOGGING (Prisma EmailLog)
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
  } catch {
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
      data: { status: "FAILED", error: msg },
    });
  } catch {
    return null;
  }
}

/* ============================================================
   RESEND
============================================================ */
function getResendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Missing RESEND_API_KEY");
  return new Resend(key);
}

function normalizeToArray(to) {
  if (!to) return [];
  if (Array.isArray(to)) return to.filter(Boolean);
  return [String(to)];
}

async function sendViaResend({ mailOptions }) {
  const resend = getResendClient();

  const to = normalizeToArray(mailOptions.to);
  if (!to.length) throw new Error("Missing 'to'");
  if (!mailOptions.from) throw new Error("Missing 'from'");

  const payload = {
  from: mailOptions.from,
  to,
  subject: mailOptions.subject,
  ...(mailOptions.replyTo ? { reply_to: mailOptions.replyTo } : {}),
  ...(mailOptions.html ? { html: mailOptions.html } : {}),
  ...(mailOptions.text ? { text: mailOptions.text } : {}),
  ...(mailOptions.headers ? { headers: mailOptions.headers } : {}),
  ...(mailOptions.attachments
    ? { attachments: mailOptions.attachments }
    : {}),
};

  const out = await resend.emails.send(payload);

  if (out?.error) throw new Error(out.error?.message || "Resend error");

  return {
    provider: "resend",
    messageId: out?.data?.id || out?.id || null,
    raw: out,
  };
}

/* ============================================================
   SEND (logged) - provider switch (smtp / resend)
============================================================ */
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
  const provider = resolveProvider();

  const sender = SENDERS[senderKey] || {};
  const fromEmail = sender.user || null; // pentru log
  const replyTo = mailOptions?.replyTo || sender.replyTo || null;

  const log = await createEmailLogQueued({
    userId,
    toEmail: to,
    toName,
    senderKey,
    fromEmail,
    replyTo,
    template,
    subject,
    provider,
    orderId,
    ticketId,
  });

  try {
    if (provider === "resend") {
      const res = await sendViaResend({
        mailOptions: {
          ...mailOptions,
          headers: headers || mailOptions.headers,
        },
      });

      if (log?.id) {
        await markEmailLogSent(log.id, { provider: "resend", messageId: res?.messageId });
      }

      return res;
    }

    // SMTP
    const transporter = makeTransport(senderKey);

    const res = await transporter.sendMail({
      ...mailOptions,
      headers: headers || mailOptions.headers,
    });

    if (log?.id) {
      await markEmailLogSent(log.id, { provider: "smtp", messageId: res?.messageId });
    }

    return res;
  } catch (err) {
    if (log?.id) await markEmailLogFailed(log.id, err);
    throw err;
  }
}

/* ============================================================
   GUEST SUPPORT EMAILS (sender: support@) ✅
============================================================ */
export async function sendGuestSupportConfirmationEmail({
  to,
  name,
  subject,
  message,
  userId = null,
  ticketId = null,
}) {
  const { html, text, subject: emailSubject } = await withLogo(guestSupportConfirmationTemplate, {
    name,
    subject,
    message,
  });

  return sendMailLogged({
    senderKey: "noreply", // ✅ confirmarea pleacă de la noreply
    to,
    subject: emailSubject,
    template: "guest_support_confirmation",
    userId,
    ticketId,
    toName: name || null,
    mailOptions: {
      ...senderEnvelope("noreply", { replyTo: SUPPORT_EMAIL }), // ✅ reply către suport
      to,
      subject: emailSubject,
      html,
      text,
      headers: AUTO_HEADERS,
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
  const { html, text, subject: emailSubject } = await withLogo(guestSupportReplyTemplate, {
    name,
    subject,
    reply,
  });

  return sendMailLogged({
    senderKey: "support",
    to,
    subject: emailSubject,
    template: "guest_support_reply",
    userId,
    ticketId,
    toName: name || null,
    mailOptions: {
      ...senderEnvelope("support"),
      to,
      subject: emailSubject,
      html,
      text,
    },
  });
}

/* ============================================================
   AUTH / SECURITY EMAILS (sender: no-reply@)
============================================================ */
export async function sendVerificationEmail({ to, code, ttlMin = 10, userId = null }) {
  const { html, text, subject } = await withLogo(verificationEmailTemplate, { code, ttlMin });

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "verify_email_code",
    userId,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      headers: AUTO_HEADERS,
    },
  });
}

export async function sendPasswordResetEmail({ to, link, userId = null }) {
  const { html, text, subject } = await withLogo(resetPasswordEmailTemplate, { link });

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
      headers: AUTO_HEADERS,
    },
  });
}

export async function sendEmailChangeVerificationEmail({ to, link, userId = null }) {
  const { html, text, subject } = await withLogo(emailChangeVerificationTemplate, { link });

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
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   MARKETING (sender: no-reply@)  + one-click unsubscribe headers
============================================================ */
export async function sendMarketingEmail({ to, subject, html, preheader, userId = null }) {
  if (!to || !subject || !html) return;

  const unsubUrl = buildUnsubscribeLink({ email: to, category: "marketing" });
  const listUnsubHeaders = buildListUnsubscribeHeaders({ email: to, category: "marketing" });

  const finalHtml = `
<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
  ${
    preheader
      ? `<span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${preheader}</span>`
      : ""
  }
  <div style="text-align:center;margin-bottom:20px;">
    <img src="${EMAIL_LOGO_URL}" alt="${BRAND_NAME} logo" width="120" height="120"
      style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
  </div>
  <div style="background:#ffffff;border-radius:12px;padding:18px 16px;border:1px solid #e5e7eb;">
    ${html}
  </div>
</div>`.trim();

  const text = [
    stripHtml(html),
    "",
    `Primești acest email pentru că ți-ai dat acordul să primești comunicări de marketing de la ${BRAND_NAME}.`,
    unsubUrl ? `Dezabonare: ${unsubUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

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
      headers: {
        ...AUTO_HEADERS,
        ...listUnsubHeaders,
      },
    },
  });
}

/* ============================================================
   INACTIVE ACCOUNT (sender: no-reply@)
============================================================ */
export async function sendInactiveAccountWarningEmail({ to, deleteAt, userId = null }) {
  if (!to || !deleteAt) return;

  const dateStr = deleteAt.toLocaleDateString("ro-RO", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const subject = "Contul tău va fi șters pentru inactivitate";

  const html = `
<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="${EMAIL_LOGO_URL}" alt="${BRAND_NAME} logo" width="120" height="120"
      style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
  </div>
  <h2 style="color:#111827;margin:0 0 12px;">Contul tău este inactiv</h2>
  <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
    Contul tău pe <strong>${BRAND_NAME}</strong> nu a mai fost folosit de mult timp.
  </p>
  <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
    Din motive de securitate și protecția datelor, contul va fi <strong>șters definitiv</strong> dacă nu te conectezi până la data de <strong>${dateStr}</strong>.
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
</div>`.trim();

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
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   ORDERS (sender: no-reply@)
============================================================ */
export async function sendOrderConfirmationEmail({
  to,
  order,
  items,
  storeAddresses,
  userId = null,

  /*
   * Pentru guest putem trimite
   * direct linkul securizat către
   * pagina comenzii.
   */
  actionUrl = null,

  /*
   * Guest / user normal.
   */
  isGuest = false,

  /*
   * Pentru flow-ul de plată guest.
   */
  paymentMethod = null,
  paymentPending = false,
}) {
  if (!to || !order) {
    return;
  }

  const currency =
    order.currency ||
    "RON";

  const total =
    formatMoney(
      order.total,
      currency
    );

  const subtotal =
    formatMoney(
      order.subtotal,
      currency
    );

  const shippingTotal =
    formatMoney(
      order.shippingTotal,
      currency
    );

  const address =
    order.shippingAddress ||
    {};

  const customerName =
    address.name ||
    `${address.lastName || ""} ${address.firstName || ""}`.trim() ||
    order.customerName ||
    "client";

  /*
   * Numărul public al comenzii.
   */
  const displayNo =
    order.orderNumber ||
    order.id;

  /*
   * USER:
   * /comenzile-mele?order=...
   *
   * GUEST:
   * actionUrl primit din ruta care
   * creează comanda:
   *
   * /comanda-guest/:id?token=...
   */
  const orderLink =
    actionUrl ||
    (
      APP_URL
        ? `${APP_URL}/comenzile-mele?order=${encodeURIComponent(
            order.id
          )}`
        : null
    );

const normalizedPaymentMethod =
  String(
    paymentMethod ||
      order?.paymentMethod ||
      ""
  )
    .trim()
    .toUpperCase();

const isGuestCardPending =
  isGuest === true &&
  normalizedPaymentMethod === "CARD" &&
  paymentPending === true &&
  Boolean(orderLink);

const orderButtonLabel =
  isGuestCardPending
    ? "Vezi comanda / Finalizează plata"
    : isGuest
      ? "Vezi comanda"
      : "Vezi comanda în contul tău";

  const itemsRows =
    (
      items ||
      []
    )
      .map(
        (it) => `
<tr>
  <td
    style="
      padding:8px;
      border-bottom:1px solid #e5e7eb;
      color:#374151;
    "
  >
    ${it.title || "Produs"}
  </td>

  <td
    style="
      padding:8px;
      border-bottom:1px solid #e5e7eb;
      text-align:center;
      color:#374151;
    "
  >
    x${Number(it.qty || 1)}
  </td>

  <td
    style="
      padding:8px;
      border-bottom:1px solid #e5e7eb;
      text-align:right;
      color:#374151;
    "
  >
    ${formatMoney(
      Number(it.price || 0) *
        Number(it.qty || 1),
      currency
    )}
  </td>
</tr>
`
      )
      .join("") ||
    `
<tr>
  <td
    colspan="3"
    style="
      padding:12px;
      text-align:center;
      color:#6b7280;
    "
  >
    Produsele comenzii nu sunt disponibile.
  </td>
</tr>
`;

  /* =========================================================
     Adrese retur magazine
  ========================================================= */

  const safeStoreAddresses =
    Array.isArray(
      storeAddresses
    )
      ? storeAddresses
      : [];

  const storeAddressesHtml =
    safeStoreAddresses.length
      ? `
        <h3
          style="
            color:#111827;
            margin:20px 0 8px;
            font-size:16px;
          "
        >
          Adrese magazine
        </h3>

        ${safeStoreAddresses
          .map(
            (store) => `
          <div
            style="
              background:#f9fafb;
              border:1px solid #e5e7eb;
              border-radius:10px;
              padding:12px;
              margin-bottom:8px;
              color:#374151;
              line-height:1.5;
            "
          >
            ${
              store?.name
                ? `<strong>${store.name}</strong><br>`
                : ""
            }

            ${
              store?.address ||
              ""
            }

            ${
              store?.city
                ? `<br>${store.city}`
                : ""
            }

            ${
              store?.county
                ? `, ${store.county}`
                : ""
            }
          </div>
        `
          )
          .join("")}
      `
      : "";

  const storeAddressesTextLines =
    safeStoreAddresses
      .map(
        (store) => {
          return [
            store?.name ||
              "",
            [
              store?.address,
              store?.city,
              store?.county,
            ]
              .filter(Boolean)
              .join(", "),
          ]
            .filter(Boolean)
            .join(" - ");
        }
      )
      .filter(Boolean);

  /* =========================================================
     Subject
  ========================================================= */

  const emailSubject =
    `Confirmare comandă #${displayNo} - ${BRAND_NAME}`;

  /* =========================================================
     HTML
  ========================================================= */

  const html = `
<div
  style="
    font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;
    max-width:640px;
    margin:auto;
    padding:20px;
    background:#f9fafb;
    border-radius:12px;
  "
>
  <div
    style="
      text-align:center;
      margin-bottom:20px;
    "
  >
    <img
      src="${EMAIL_LOGO_URL}"
      alt="${BRAND_NAME} logo"
      width="120"
      style="
        display:block;
        margin:0 auto;
        border:0;
        outline:none;
        text-decoration:none;
        max-width:120px;
        height:auto;
      "
    >
  </div>

  <div
    style="
      background:#ffffff;
      border-radius:14px;
      padding:22px;
      border:1px solid #e5e7eb;
    "
  >
    <h2
      style="
        color:#111827;
        margin:0 0 12px;
      "
    >
      Mulțumim pentru comandă!
    </h2>

    <p
      style="
        color:#374151;
        margin:0 0 10px;
        line-height:1.6;
      "
    >
      Bună,
      <strong>${customerName}</strong>!
    </p>

    <p
      style="
        color:#374151;
        margin:0 0 16px;
        line-height:1.6;
      "
    >
      Comanda ta pe
      <strong>${BRAND_NAME}</strong>
      a fost înregistrată și trimisă către
      ${
        isGuest
          ? "artizan."
          : "magazin."
      }
    </p>

    <div
      style="
        background:#f8f6f4;
        border-radius:10px;
        padding:14px;
        margin-bottom:18px;
      "
    >
      <p
        style="
          margin:0 0 6px;
          color:#374151;
        "
      >
        <strong>Număr comandă:</strong>
        #${displayNo}
      </p>

      <p
        style="
          margin:0;
          color:#374151;
        "
      >
        <strong>Metodă de plată:</strong>
        ${
          order.paymentMethod ===
          "COD"
            ? "Plată la livrare (ramburs)"
            : "Card online"
        }
      </p>
    </div>

    ${
      isGuest
        ? `
          <div
            style="
              background:#fffaf0;
              border:1px solid #f0dba5;
              border-radius:10px;
              padding:14px;
              margin-bottom:18px;
              color:#5f4b30;
              line-height:1.6;
            "
          >
            <strong>
              Ai plasat comanda fără cont.
            </strong>

            <br>

            Poți urmări comanda folosind linkul securizat din acest email.
            Nu este nevoie să îți creezi cont Artfest.
          </div>
        `
        : ""
    }

    <h3
      style="
        color:#111827;
        margin:20px 0 8px;
        font-size:16px;
      "
    >
      Produse
    </h3>

    <table
      width="100%"
      cellspacing="0"
      cellpadding="0"
      style="
        width:100%;
        border-collapse:collapse;
        margin-bottom:18px;
      "
    >
      <thead>
        <tr>
          <th
            style="
              padding:8px;
              text-align:left;
              border-bottom:1px solid #d1d5db;
              color:#6b7280;
              font-size:12px;
            "
          >
            Produs
          </th>

          <th
            style="
              padding:8px;
              text-align:center;
              border-bottom:1px solid #d1d5db;
              color:#6b7280;
              font-size:12px;
            "
          >
            Cant.
          </th>

          <th
            style="
              padding:8px;
              text-align:right;
              border-bottom:1px solid #d1d5db;
              color:#6b7280;
              font-size:12px;
            "
          >
            Total
          </th>
        </tr>
      </thead>

      <tbody>
        ${itemsRows}
      </tbody>

      <tfoot>
        <tr>
          <td
            colspan="2"
            style="
              padding:8px;
              text-align:right;
              color:#6b7280;
            "
          >
            Subtotal
          </td>

          <td
            style="
              padding:8px;
              text-align:right;
              color:#374151;
            "
          >
            ${subtotal}
          </td>
        </tr>

        <tr>
          <td
            colspan="2"
            style="
              padding:8px;
              text-align:right;
              color:#6b7280;
            "
          >
            Transport
          </td>

          <td
            style="
              padding:8px;
              text-align:right;
              color:#374151;
            "
          >
            ${shippingTotal}
          </td>
        </tr>

        <tr>
          <td
            colspan="2"
            style="
              padding:10px 8px;
              text-align:right;
              border-top:1px solid #e5e7eb;
              color:#111827;
            "
          >
            <strong>Total</strong>
          </td>

          <td
            style="
              padding:10px 8px;
              text-align:right;
              border-top:1px solid #e5e7eb;
              color:#111827;
            "
          >
            <strong>${total}</strong>
          </td>
        </tr>
      </tfoot>
    </table>

    <h3
      style="
        color:#111827;
        margin:20px 0 8px;
        font-size:16px;
      "
    >
      Adresă livrare
    </h3>

    <p
      style="
        color:#374151;
        margin:0 0 16px;
        line-height:1.5;
      "
    >
      ${customerName}<br>

      ${
        address.street ||
        ""
      }<br>

      ${`${address.postalCode || ""} ${address.city || ""}`.trim()}<br>

      ${
        address.county ||
        ""
      }

      ${
        address.phone
          ? `<br>Tel: ${address.phone}`
          : ""
      }
    </p>

    ${storeAddressesHtml}
${
  isGuestCardPending
    ? `
      <div
        style="
          margin:20px 0;
          padding:16px;
          border-radius:12px;
          background:#fff8eb;
          border:1px solid #ead6ad;
        "
      >
        <div
          style="
            color:#4d3c32;
            font-weight:700;
            margin-bottom:6px;
          "
        >
          Plata comenzii
        </div>

        <div
          style="
            color:#5f5149;
            font-size:14px;
            line-height:1.6;
          "
        >
          Ai ales plata cu cardul.

          Dacă nu ai finalizat plata, comanda ta este păstrată.
          Poți reveni oricând în pagina comenzii și poți apăsa
          <strong>„Achită acum”</strong>.
        </div>
      </div>
    `
    : ""
}
    ${
      orderLink
        ? `
          <p
            style="
              text-align:center;
              margin:24px 0 12px;
            "
          >
            <a
              href="${orderLink}"
              style="
                background:#6f4e43;
                color:#ffffff;
                padding:13px 22px;
                border-radius:10px;
                text-decoration:none;
                font-weight:700;
                display:inline-block;
              "
            >
              ${orderButtonLabel}
            </a>
          </p>

          <p
            style="
              color:#6b7280;
              font-size:12px;
              margin:0 0 8px;
              text-align:center;
              word-break:break-all;
            "
          >
            Dacă butonul nu funcționează,
            accesează:
            <a
              href="${orderLink}"
              style="
                color:#6f4e43;
              "
            >
              ${orderLink}
            </a>
          </p>
        `
        : ""
    }

    ${
      isGuest
        ? `
          <p
            style="
              color:#6b7280;
              font-size:12px;
              margin:16px 0 0;
              line-height:1.5;
              text-align:center;
            "
          >
            Păstrează acest email. Linkul de mai sus îți oferă acces securizat
            la detaliile comenzii.
          </p>
        `
        : ""
    }
  </div>

  <p
    style="
      font-size:12px;
      color:#9ca3af;
      text-align:center;
      margin:20px 0 0;
    "
  >
    Acest email a fost generat automat de ${BRAND_NAME}.
  </p>
</div>
`.trim();

  /* =========================================================
     Text fallback
  ========================================================= */

  const textLines = [
    `Mulțumim pentru comandă, ${customerName}!`,
    "",
    `Comanda ta pe ${BRAND_NAME} a fost înregistrată.`,
    `Număr comandă: ${displayNo}`,

    `Metodă de plată: ${
      order.paymentMethod ===
      "COD"
        ? "Plată la livrare (ramburs)"
        : "Card online"
    }`,

    "",

    isGuest
      ? "Ai plasat comanda fără cont. Poți urmări comanda folosind linkul securizat primit în acest email."
      : "",

    "Produse:",

    ...(
      items ||
      []
    ).map(
      (it) =>
        `- ${
          it.title ||
          "Produs"
        } x${Number(
          it.qty || 1
        )} = ${formatMoney(
          Number(
            it.price ||
            0
          ) *
            Number(
              it.qty ||
              1
            ),
          currency
        )}`
    ),

    "",

    `Subtotal: ${subtotal}`,
    `Transport: ${shippingTotal}`,
    `Total: ${total}`,

    "",

    "Adresă livrare:",

    customerName,

    address.street ||
      "",

    `${address.postalCode || ""} ${address.city || ""}`.trim(),

    address.county ||
      "",

    address.phone
      ? `Tel: ${address.phone}`
      : "",

    "",

    storeAddressesTextLines.length
      ? "Adrese magazine:"
      : "",

    ...storeAddressesTextLines,

    "",

    orderLink
      ? `${
          isGuest
            ? "Vezi comanda"
            : "Poți vedea comanda aici"
        }: ${orderLink}`
      : "",

    isGuest
      ? "Păstrează acest email pentru a putea reveni la comandă."
      : "",
  ].filter(
    Boolean
  );

  const text =
    textLines.join(
      "\n"
    );

  /* =========================================================
     Send
  ========================================================= */

  return sendMailLogged({
    senderKey:
      "noreply",

    to,

    subject:
      emailSubject,

    template:
      "order_confirmation",

    userId,

    orderId:
      order.id,

    toName:
      customerName,

    mailOptions: {
      ...senderEnvelope(
        "noreply"
      ),

      to,

      subject:
        emailSubject,

      html,

      text,

      headers:
        AUTO_HEADERS,
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

  const prettyId = shortId || orderId;
  const storeName = vendorName || BRAND_NAME || "magazinul nostru";

  let reasonText = "";
  switch (cancelReason) {
    case "client_no_answer":
      reasonText = "nu am reușit să vă contactăm telefonic pentru confirmarea comenzii.";
      break;
    case "client_request":
      reasonText = "ați solicitat anularea comenzii.";
      break;
    case "stock_issue":
      reasonText = "produsele comandate nu mai sunt disponibile momentan (stoc epuizat).";
      break;
    case "address_issue":
      reasonText = "adresa de livrare este incompletă sau curierul nu poate livra la această adresă.";
      break;
    case "payment_issue":
      reasonText = "au fost probleme la procesarea plății.";
      break;
    case "other":
      reasonText = cancelReasonNote?.trim() ? cancelReasonNote.trim() : "a intervenit o situație neprevăzută.";
      break;
    default:
      reasonText = "a intervenit o situație care nu ne permite să onorăm comanda.";
  }

  const address = shippingAddress || {};
  const customerName = address.name || `${address.lastName || ""} ${address.firstName || ""}`.trim() || "client";

  const orderLink = APP_URL ? `${APP_URL}/comenzile-mele?order=${encodeURIComponent(orderId)}` : null;

  const subject = `Comanda ta #${prettyId} a fost anulată - ${BRAND_NAME}`;

  const html = `
<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="${EMAIL_LOGO_URL}" alt="${BRAND_NAME} logo" width="120" height="120"
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
      ? `<p style="text-align:center;margin:24px 0 12px;">
           <a href="${orderLink}" style="background:#ef4444;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
             Vezi detaliile comenzii
           </a>
         </p>
         <p style="color:#6b7280;font-size:13px;margin:0 0 8px;text-align:center;">
           Sau accesează linkul: <a href="${orderLink}" style="color:#ef4444;">${orderLink}</a>
         </p>`
      : ""
  }

  <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
    Acest email a fost generat automat de ${BRAND_NAME}. Te rugăm să nu răspunzi la acest mesaj.
  </p>
</div>`.trim();

  const text = [
    `Bună, ${customerName},`,
    "",
    `Comanda ta #${prettyId} la ${storeName} a fost anulată.`,
    `Motiv: ${reasonText}`,
    "",
    orderLink ? `Poți vedea detaliile comenzii aici: ${orderLink}` : "",
  ]
    .filter(Boolean)
    .join("\n");

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
      headers: AUTO_HEADERS,
    },
  });
}

/**
 * ✉️ Email „comanda a fost anulată de CLIENT” (sender: no-reply@)
 */
export async function sendOrderCancelledByUserEmail({ to, order, userId = null }) {
  if (!to || !order) return;

  const prettyId = order.shortId || order.id;
  const address = order.shippingAddress || {};

  const customerName = address.name || `${address.lastName || ""} ${address.firstName || ""}`.trim() || "client";

  const currency = order.currency || "RON";
  const subtotal = formatMoney(order.subtotal || 0, currency);
  const shippingTotal = formatMoney(order.shippingTotal || 0, currency);
  const total = formatMoney(order.total || 0, currency);

  const orderLink = APP_URL ? `${APP_URL}/comenzile-mele?order=${encodeURIComponent(order.id)}` : null;

  const subject = `Ai anulat comanda #${prettyId} - ${BRAND_NAME}`;

  const html = `
<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="${EMAIL_LOGO_URL}" alt="${BRAND_NAME} logo" width="120" height="120"
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
      ? `<p style="text-align:center;margin:24px 0 12px;">
           <a href="${orderLink}" style="background:#4b5563;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
             Vezi istoricul comenzilor
           </a>
         </p>
         <p style="color:#6b7280;font-size:13px;margin:0 0 8px;text-align:center;">
           Sau accesează linkul: <a href="${orderLink}" style="color:#4b5563;">${orderLink}</a>
         </p>`
      : ""
  }

  <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
    Acest email a fost generat automat de ${BRAND_NAME}. Te rugăm să nu răspunzi la acest mesaj.
  </p>
</div>`.trim();

  const text = [
    `Bună, ${customerName},`,
    "",
    `Ai anulat comanda #${prettyId} pe ${BRAND_NAME}.`,
    `Subtotal: ${subtotal}`,
    `Transport: ${shippingTotal}`,
    `Total: ${total}`,
    "",
    orderLink ? `Poți vedea istoricul comenzilor aici: ${orderLink}` : "",
  ]
    .filter(Boolean)
    .join("\n");

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
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   SECURITY (sender: no-reply@)
============================================================ */
export async function sendPasswordStaleReminderEmail({ to, passwordAgeDays, maxPasswordAgeDays, userId = null }) {
  if (!to) return;

  const { html, text, subject } = await withLogo(passwordStaleReminderEmailTemplate, {
    passwordAgeDays,
    maxPasswordAgeDays,
    link: APP_URL || undefined,
  });

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
      headers: AUTO_HEADERS,
    },
  });
}

export async function sendSuspiciousLoginWarningEmail({ to, userId = null }) {
  if (!to) return;

  const { html, text, subject } = await withLogo(suspiciousLoginWarningEmailTemplate, {
    link: APP_URL || undefined,
  });

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
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   VENDOR FOLLOW-UP (sender: no-reply@)
============================================================ */
export async function sendVendorFollowUpReminderEmail({ to, contactName, followUpAt, threadLink, userId = null }) {
  if (!to) return;

  const fullLink = threadLink && APP_URL ? `${APP_URL.replace(/\/+$/, "")}${threadLink}` : undefined;

  const { html, text, subject } = await withLogo(vendorFollowUpReminderEmailTemplate, {
    contactName,
    followUpAt,
    link: fullLink,
  });

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
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   INVOICE (sender: admin@)
============================================================ */
export async function sendInvoiceIssuedEmail({
  to,
  orderId = null,
  invoiceNumber,
  totalGross,
  currency = "RON",
  invoiceFrontendPath,
  userId = null,
}) {
  if (!to) return;

  let order = null;

  if (orderId) {
    order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true },
    });
  }

  const totalLabel = formatMoney(totalGross || 0, currency);

  const baseUrl = APP_URL ? APP_URL.replace(/\/+$/, "") : null;

  const link =
    baseUrl && invoiceFrontendPath
      ? `${baseUrl}${invoiceFrontendPath}`
      : baseUrl && orderId
        ? `${baseUrl}/comenzile-mele?order=${encodeURIComponent(orderId)}`
        : baseUrl || undefined;

  const { html, text, subject } = await withLogo(invoiceIssuedEmailTemplate, {
    orderId,
    orderNumber: order?.orderNumber || null,
    invoiceNumber,
    totalLabel,
    link,
  });

  return sendMailLogged({
    senderKey: "admin",
    to,
    subject,
    template: "invoice_issued",
    userId,
    orderId: orderId || null,
    mailOptions: {
      ...senderEnvelope("admin"),
      to,
      subject,
      html,
      text,
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   SHIPMENT PICKUP (sender: no-reply@)
============================================================ */
export async function sendShipmentPickupEmail({ to, orderId, awb, trackingUrl, etaLabel, slotLabel, userId = null }) {
  if (!to) return;
const order = await prisma.order.findUnique({
  where: { id: orderId },
  select: { id: true, orderNumber: true },
});
const displayNo = order?.orderNumber || orderId;

  const baseUrl = APP_URL ? APP_URL.replace(/\/+$/, "") : null;
  const orderLink = baseUrl ? `${baseUrl}/comenzile-mele?order=${encodeURIComponent(orderId)}` : null;

  const subject = `Comanda ta a fost predată curierului - ${BRAND_NAME}`;

  const html = `
<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="${EMAIL_LOGO_URL}" alt="${BRAND_NAME} logo" width="120" height="120"
      style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
  </div>

  <h2 style="color:#111827;margin:0 0 8px;">Comanda ta este în drum spre tine 🚚</h2>
  <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
    Comanda ta pe <strong>${BRAND_NAME}</strong> a fost predată curierului.
  </p>

  <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
    <strong>Număr comandă:</strong> ${displayNo}<br>
    <strong>AWB:</strong> ${awb || "-"}<br>
    <strong>Livrare estimată:</strong> ${etaLabel || "-"} în intervalul ${slotLabel || "-"}
  </p>

  ${
    trackingUrl
      ? `<p style="text-align:center;margin:18px 0;">
           <a href="${trackingUrl}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
             Urmărește coletul
           </a>
         </p>
         <p style="color:#6b7280;font-size:13px;margin:0 0 8px;text-align:center;">
           Sau accesează linkul: <a href="${trackingUrl}" style="color:#4f46e5;">${trackingUrl}</a>
         </p>`
      : ""
  }

  ${
    orderLink
      ? `<p style="color:#6b7280;font-size:13px;margin:16px 0 0;text-align:center;">
           Poți vedea detaliile comenzii aici: <a href="${orderLink}" style="color:#4b5563;">${orderLink}</a>
         </p>`
      : ""
  }

  <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
    Acest email a fost generat automat de ${BRAND_NAME}. Te rugăm să nu răspunzi la acest mesaj.
  </p>
</div>`.trim();

  const text = [
    `Comanda ta pe ${BRAND_NAME} a fost predată curierului.`,
     `Număr comandă: ${displayNo}`,
    awb ? `AWB: ${awb}` : "",
    etaLabel || slotLabel ? `Livrare estimată: ${etaLabel || ""} în intervalul ${(slotLabel || "").trim()}`.trim() : "",
    trackingUrl ? `Poți urmări coletul aici: ${trackingUrl}` : "",
    orderLink ? `Detalii comandă: ${orderLink}` : "",
  ]
    .filter(Boolean)
    .join("\n");

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
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   VENDOR DEACTIVATE CONFIRM (sender: admin@)
============================================================ */
export async function sendVendorDeactivateConfirmEmail({ to, link, userId = null }) {
  if (!to || !link) return;

  const { html, text, subject } = await withLogo(vendorDeactivateConfirmTemplate, { link });

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
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   WAITLIST: Marketplace (sender: noreply) + List-Unsubscribe
============================================================ */
export async function sendMarketplaceWaitlistEmail({
  to,
  subject,
  html,
  preheader,
  senderKey = "noreply",
  userId = null,
}) {
  if (!to || !subject || !html) return;

  // folosim mecanismul existent de one-click unsubscribe
  // IMPORTANT: category distinct ca să nu se amestece cu marketing
  const unsubUrl = buildUnsubscribeLink({ email: to, category: "marketplace_waitlist" });
  const listUnsubHeaders = buildListUnsubscribeHeaders({ email: to, category: "marketplace_waitlist" });

  const finalHtml = `
<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
  ${
    preheader
      ? `<span style="display:none !important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${String(
          preheader
        )}</span>`
      : ""
  }

  <div style="text-align:center;margin-bottom:20px;">
    <img src="${EMAIL_LOGO_URL}" alt="${BRAND_NAME} logo" width="120" height="120"
      style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
  </div>

  <div style="background:#ffffff;border-radius:12px;padding:18px 16px;border:1px solid #e5e7eb;">
    ${String(html)}
  </div>

  <p style="font-size:11px;color:#9ca3af;text-align:center;margin:16px 0 0;line-height:1.35;">
    Primești acest email pentru că te-ai înscris pe lista de așteptare Marketplace ${BRAND_NAME}.<br/>
    ${
      unsubUrl
        ? `Dacă nu mai vrei notificări, te poți <a href="${unsubUrl}" style="color:#6b7280;">dezabona aici</a>.`
        : ""
    }
  </p>
</div>`.trim();

  const text = [
    stripHtml(html),
    "",
    `Primești acest email pentru că te-ai înscris pe lista de așteptare Marketplace ${BRAND_NAME}.`,
    unsubUrl ? `Dezabonare: ${unsubUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return sendMailLogged({
    senderKey,
    to,
    subject,
    template: "marketplace_waitlist",
    userId,
    mailOptions: {
      ...senderEnvelope(senderKey),
      to,
      subject,
      html: finalHtml,
      text,
      headers: {
        ...AUTO_HEADERS,
        ...listUnsubHeaders,
      },
    },
  });
}
export async function sendUserSupportReplyEmail({
  to,
  name,
  subject,
  reply,
  ticketId,
}) {
  if (!to) return;

  const ticketLink =
    APP_URL && ticketId
      ? `${APP_URL.replace(/\/+$/, "")}/support/tickets/${encodeURIComponent(ticketId)}`
      : null;

  const { html, text, subject: emailSubject } = await withLogo(userSupportReplyTemplate, {
    name,
    subject,
    reply,
    link: ticketLink,
  });

  return sendMailLogged({
    senderKey: "support", // sau "noreply" dacă vrei, dar reply-to să fie support
    to,
    subject: emailSubject,
    template: "user_support_reply",
    ticketId,
    toName: name || null,
    mailOptions: {
      ...senderEnvelope("support"),
      to,
      subject: emailSubject,
      html,
      text,
      headers: AUTO_HEADERS,
    },
  });
}
export async function sendVendorNewOrderEmail({
  to,
  vendorName,
  order,
  items,
  customerName,
  total,
  currency = "RON",
}) {
  if (!to || !order) return;

  const displayNo = order.orderNumber || order.id;
  const orderLink = APP_URL
    ? `${APP_URL}/vendor/orders?order=${encodeURIComponent(order.id)}`
    : null;

  const subject = `Ai primit o comandă nouă #${displayNo} - ${BRAND_NAME}`;

  const rows = (items || [])
    .map(
      (it) => `
<tr>
  <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${it.title}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">x${it.qty}</td>
  <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">
    ${formatMoney(Number(it.price || 0) * Number(it.qty || 0), currency)}
  </td>
</tr>`
    )
    .join("");

  const html = `
<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="${EMAIL_LOGO_URL}" alt="${BRAND_NAME} logo" width="120" style="display:block;margin:0 auto;">
  </div>

  <h2>Ai primit o comandă nouă</h2>
  <p>Bună, <strong>${vendorName || "vendor"}</strong>,</p>
  <p>Ai primit comanda <strong>#${displayNo}</strong> de la <strong>${customerName || "Client"}</strong>.</p>

  <p><strong>Total vendor:</strong> ${formatMoney(total || 0, currency)}</p>

  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th align="left" style="padding:8px;">Produs</th>
        <th align="center" style="padding:8px;">Cantitate</th>
        <th align="right" style="padding:8px;">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  ${
    orderLink
      ? `<p style="text-align:center;margin:24px 0;">
          <a href="${orderLink}" style="background:#111827;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;">
            Vezi comanda
          </a>
        </p>`
      : ""
  }

  <p style="font-size:12px;color:#9ca3af;text-align:center;margin-top:28px;">
    Email generat automat de ${BRAND_NAME}.
  </p>
</div>`.trim();

  const text = [
    `Ai primit o comandă nouă #${displayNo}`,
    `Client: ${customerName || "Client"}`,
    `Total vendor: ${formatMoney(total || 0, currency)}`,
    "",
    "Produse:",
    ...(items || []).map(
      (it) => `- ${it.title} x${it.qty} = ${formatMoney(Number(it.price || 0) * Number(it.qty || 0), currency)}`
    ),
    "",
    orderLink ? `Vezi comanda: ${orderLink}` : "",
  ].filter(Boolean).join("\n");

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "vendor_new_order",
    orderId: order.id,
    toName: vendorName || null,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      headers: AUTO_HEADERS,
    },
  });
}

/* ============================================================
   QUOTE REQUESTS - CERERE NOUĂ DE OFERTĂ (VENDOR)
============================================================ */

export async function sendVendorNewQuoteRequestEmail({
  to,
  vendorName,
  customerName,
  quoteId,
  source,
  targetTitle,
  quantity,
  message = null,
}) {
  if (!to || !quoteId) {
    return;
  }

  const safeVendorName =
    escapeEmailHtml(
      vendorName ||
      "Vânzător"
    );

  const safeCustomerName =
    escapeEmailHtml(
      customerName ||
      "Un client"
    );

  const safeTargetTitle =
    escapeEmailHtml(
      targetTitle ||
      (
        source === "PRODUCT"
          ? "produs"
          : "magazin"
      )
    );

  const safeMessage =
    message
      ? escapeEmailHtml(
          String(message)
        )
      : null;

  const normalizedQuantity =
    Number.isFinite(
      Number(quantity)
    )
      ? Math.max(
          1,
          Math.round(
            Number(quantity)
          )
        )
      : 1;

  const quoteLink =
    APP_URL
      ? `${APP_URL}/?assistant=vendor-quote&quoteId=${encodeURIComponent(
          quoteId
        )}`
      : null;

  const isProduct =
    source === "PRODUCT";

  const subject =
    isProduct
      ? `Ai primit o cerere de ofertă pentru ${targetTitle || "un produs"} - ${BRAND_NAME}`
      : `Ai primit o cerere nouă de ofertă - ${BRAND_NAME}`;

  const html = `
<div
  style="
    font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;
    max-width:640px;
    margin:auto;
    padding:20px;
    background:#f9fafb;
    border-radius:12px;
  "
>
  <div
    style="
      text-align:center;
      margin-bottom:20px;
    "
  >
    <img
      src="${EMAIL_LOGO_URL}"
      alt="${BRAND_NAME} logo"
      width="120"
      style="
        display:block;
        margin:0 auto;
        border:0;
        outline:none;
        text-decoration:none;
        max-width:120px;
        height:auto;
      "
    >
  </div>

  <div
    style="
      background:#ffffff;
      border:1px solid #e5e7eb;
      border-radius:14px;
      padding:22px;
    "
  >
    <h2
      style="
        color:#111827;
        margin:0 0 12px;
        font-size:22px;
      "
    >
      Ai primit o cerere nouă de ofertă
    </h2>

    <p
      style="
        color:#374151;
        margin:0 0 12px;
        line-height:1.6;
      "
    >
      Bună, <strong>${safeVendorName}</strong>!
    </p>

    <p
      style="
        color:#374151;
        margin:0 0 18px;
        line-height:1.6;
      "
    >
      <strong>${safeCustomerName}</strong>
      ${
        isProduct
          ? `este interesat de produsul <strong>„${safeTargetTitle}”</strong> și îți solicită o ofertă.`
          : `ți-a trimis o cerere de ofertă pentru magazinul tău.`
      }
    </p>

    <div
      style="
        background:#f8f6f4;
        border-radius:12px;
        padding:16px;
        margin:0 0 18px;
      "
    >
      ${
        isProduct
          ? `
            <p
              style="
                margin:0 0 8px;
                color:#374151;
                line-height:1.5;
              "
            >
              <strong>Produs:</strong>
              ${safeTargetTitle}
            </p>
          `
          : ""
      }

      <p
        style="
          margin:0${
            safeMessage
              ? " 0 8px"
              : ""
          };
          color:#374151;
          line-height:1.5;
        "
      >
        <strong>Cantitate:</strong>
        ${normalizedQuantity}
      </p>

      ${
        safeMessage
          ? `
            <div
              style="
                margin-top:14px;
                padding-top:14px;
                border-top:1px solid #e5e7eb;
              "
            >
              <p
                style="
                  margin:0 0 6px;
                  color:#374151;
                  font-weight:600;
                "
              >
                Mesajul clientului:
              </p>

              <p
                style="
                  margin:0;
                  color:#4b5563;
                  line-height:1.6;
                  white-space:pre-wrap;
                "
              >${safeMessage}</p>
            </div>
          `
          : ""
      }
    </div>

    <p
      style="
        color:#374151;
        margin:0 0 18px;
        line-height:1.6;
      "
    >
      Intră în Artfest pentru a vedea toate detaliile cererii,
      a discuta cu clientul și a trimite oferta.
    </p>

    ${
      quoteLink
        ? `
          <p
            style="
              text-align:center;
              margin:24px 0 8px;
            "
          >
            <a
              href="${quoteLink}"
              style="
                display:inline-block;
                background:#111827;
                color:#ffffff;
                padding:12px 20px;
                border-radius:8px;
                text-decoration:none;
                font-weight:600;
              "
            >
              Vezi cererea de ofertă
            </a>
          </p>
        `
        : ""
    }
  </div>

  <p
    style="
      font-size:12px;
      color:#9ca3af;
      text-align:center;
      margin:20px 0 0;
    "
  >
    Acest email a fost generat automat de ${BRAND_NAME}.
  </p>
</div>
`.trim();

  const text = [
    "Ai primit o cerere nouă de ofertă",
    "",
    `Bună, ${vendorName || "Vânzător"}!`,
    "",
    isProduct
      ? `${customerName || "Un client"} este interesat de produsul „${targetTitle || "Produs"}” și îți solicită o ofertă.`
      : `${customerName || "Un client"} ți-a trimis o cerere de ofertă pentru magazinul tău.`,
    "",
    isProduct
      ? `Produs: ${targetTitle || "Produs"}`
      : "",
    `Cantitate: ${normalizedQuantity}`,
    message
      ? `Mesajul clientului: ${String(message)}`
      : "",
    "",
    "Intră în Artfest pentru a vedea toate detaliile cererii, a discuta cu clientul și a trimite oferta.",
    quoteLink
      ? `Vezi cererea de ofertă: ${quoteLink}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return sendMailLogged({
    senderKey:
      "noreply",

    to,

    subject,

    template:
      "vendor_new_quote_request",

    toName:
      vendorName ||
      null,

    mailOptions: {
      ...senderEnvelope(
        "noreply"
      ),

      to,

      subject,

      html,

      text,

      headers:
        AUTO_HEADERS,
    },
  });
}

export async function sendVendorCommissionInvoiceEmail({
  to,
  vendorName,
  invoiceNumber,
  totalGross,
  currency = "RON",
  attachments = [],
}) {
  if (!to) return;

  const totalLabel = formatMoney(totalGross || 0, currency);
  const subject = `Factura comision Artfest ${invoiceNumber}`;

 const html = `
<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
  <div style="text-align:center;margin-bottom:20px;">
    <img src="${EMAIL_LOGO_URL}" alt="${BRAND_NAME} logo" width="120" height="120"
      style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
  </div>

  <h2 style="color:#111827;margin:0 0 8px;">A fost emisă factura de comision</h2>

  <p style="color:#374151;margin:0 0 12px;">
    Bună${vendorName ? `, ${vendorName}` : ""},
  </p>

  <p style="color:#374151;margin:0 0 12px;">
    Atașat găsești factura pentru comisionul Artfest aferent perioadei de facturare.
  </p>

  <p style="color:#374151;margin:0 0 12px;">
    Pentru achitare, intră în dashboard-ul tău de vendor, în pagina
    <strong>Facturare și comisioane</strong>, apoi deschide tabul
    <strong>Facturi emise de platformă</strong>.
  </p>

  ${
    APP_URL
      ? `<p style="text-align:center;margin:22px 0;">
           <a href="${APP_URL}/vendor/invoices"
              style="background:#111827;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
             Vezi facturile în dashboard
           </a>
         </p>`
      : ""
  }

  <p style="color:#374151;margin:0 0 16px;">
    <strong>Număr factură:</strong> ${invoiceNumber}<br>
    <strong>Total factură:</strong> ${totalLabel}
  </p>

  <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
    Acest email a fost generat automat de ${BRAND_NAME}.
  </p>
</div>`.trim();

  const text = [
  `Bună${vendorName ? `, ${vendorName}` : ""},`,
  "",
  "Atașat găsești factura pentru comisionul Artfest aferent perioadei de facturare.",
  "",
  "Pentru achitare, intră în dashboard-ul tău de vendor > Facturare și comisioane > Facturi emise de platformă.",
  APP_URL ? `Link: ${APP_URL}/vendor/invoices` : "",
  "",
  `Număr factură: ${invoiceNumber}`,
  `Total factură: ${totalLabel}`,
].join("\n");

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject,
    template: "vendor_commission_invoice",
    toName: vendorName || null,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject,
      html,
      text,
      headers: AUTO_HEADERS,
      attachments,
    },
  });
}

/* ============================================================
   HOMEPAGE FEATURE – VENDOR SELECTAT
============================================================ */

function escapeEmailHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatHomepageFeatureDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString(
    "ro-RO",
    {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }
  );
}

export async function sendHomepageFeatureSelectedEmail({
  to,
  userId = null,
  vendorName,
  featureId,
  featureType,
  productTitle = null,
  storeName = null,
  startsAt,
  endsAt,
  platformDiscountPercent = 0,
}) {
  if (!to || !featureId) {
    return null;
  }

  const isProductOfDay =
    featureType ===
    "PRODUCT_OF_DAY";

  const promotionLabel =
    isProductOfDay
      ? "Produsul zilei"
      : "Artizanul săptămânii";

  const selectedName =
    isProductOfDay
      ? productTitle ||
        "produsul tău"
      : storeName ||
        vendorName ||
        "magazinul tău";

  const startLabel =
    formatHomepageFeatureDate(
      startsAt
    );

  const endLabel =
    formatHomepageFeatureDate(
      endsAt
    );

  const discountPercent =
    Math.max(
      0,
      Number(
        platformDiscountPercent ||
          0
      )
    );

  const promotionLink =
    APP_URL
      ? `${APP_URL}/vendor/promovari?featureId=${encodeURIComponent(
          featureId
        )}`
      : null;

  const subject =
    isProductOfDay
      ? `Produsul tău a fost ales Produsul zilei pe ${BRAND_NAME}`
      : `Ai fost ales Artizanul săptămânii pe ${BRAND_NAME}`;

  const safeVendorName =
    escapeEmailHtml(
      vendorName ||
        "creator"
    );

  const safeSelectedName =
    escapeEmailHtml(
      selectedName
    );

  const safePromotionLabel =
    escapeEmailHtml(
      promotionLabel
    );

  const html = `
<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
  <div style="text-align:center;margin-bottom:20px;">
    <img
      src="${EMAIL_LOGO_URL}"
      alt="${BRAND_NAME}"
      width="120"
      height="120"
      style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;"
    >
  </div>

  <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:22px;">
    <h2 style="color:#111827;margin:0 0 14px;">
      Felicitări, ${safeVendorName}! 🎉
    </h2>

    <p style="color:#374151;margin:0 0 14px;line-height:1.6;">
      ${
        isProductOfDay
          ? `Produsul <strong>${safeSelectedName}</strong> a fost selectat pentru promovarea <strong>${safePromotionLabel}</strong>.`
          : `<strong>${safeSelectedName}</strong> a fost selectat pentru promovarea <strong>${safePromotionLabel}</strong>.`
      }
    </p>

    ${
      startLabel
        ? `
          <p style="color:#374151;margin:0 0 10px;line-height:1.6;">
            <strong>Perioada promovării:</strong>
            ${escapeEmailHtml(
              startLabel
            )}${
              endLabel
                ? ` – ${escapeEmailHtml(
                    endLabel
                  )}`
                : ""
            }
          </p>
        `
        : ""
    }

    <p style="color:#374151;margin:0 0 16px;line-height:1.6;">
      Artfest oferă o reducere de
      <strong>${discountPercent}%</strong>.
      Poți intra în pagina promovării pentru a vedea detaliile și pentru a decide dacă dorești să adaugi și o reducere proprie.
    </p>

    ${
      promotionLink
        ? `
          <p style="text-align:center;margin:24px 0 8px;">
            <a
              href="${promotionLink}"
              style="display:inline-block;background:#7c3aed;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;"
            >
              Vezi promovarea
            </a>
          </p>

          <p style="font-size:12px;color:#6b7280;text-align:center;margin:10px 0 0;word-break:break-all;">
            ${promotionLink}
          </p>
        `
        : ""
    }
  </div>

  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:20px 0 0;">
    Acest email a fost generat automat de ${BRAND_NAME}.
  </p>
</div>
`.trim();

  const text = [
    `Felicitări, ${
      vendorName ||
      "creator"
    }!`,
    "",
    isProductOfDay
      ? `Produsul „${selectedName}” a fost ales Produsul zilei pe ${BRAND_NAME}.`
      : `${selectedName} a fost ales Artizanul săptămânii pe ${BRAND_NAME}.`,
    "",
    startLabel
      ? `Perioada: ${startLabel}${
          endLabel
            ? ` - ${endLabel}`
            : ""
        }`
      : "",
    `Reducerea oferită de Artfest: ${discountPercent}%`,
    "",
    "Intră în pagina promovării pentru a vedea detaliile și pentru a decide dacă adaugi o reducere proprie.",
    promotionLink
      ? `Vezi promovarea: ${promotionLink}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return sendMailLogged({
    senderKey:
      "noreply",

    to,

    subject,

    template:
      "homepage_feature_selected",

    userId,

    toName:
      vendorName ||
      null,

    mailOptions: {
      ...senderEnvelope(
        "noreply"
      ),

      to,
      subject,
      html,
      text,

      headers:
        AUTO_HEADERS,
    },
  });
}

export async function sendDepositRequestedEmail({
  to,
  userId = null,
  orderId,
  orderNumber,
  customerName,
  vendorName,
  depositPercent,
  depositAmount,
  remainingCodAmount,
  expiresAt,
  currency = "RON",
  actionUrl = null,
}) {
  if (
    !to ||
    !orderId
  ) {
    return;
  }

  const displayNo =
    orderNumber ||
    orderId;

  const depositLabel =
    formatMoney(
      depositAmount,
      currency
    );

  const remainingLabel =
    remainingCodAmount != null
      ? formatMoney(
          remainingCodAmount,
          currency
        )
      : null;

  const expiresLabel =
    expiresAt
      ? new Intl.DateTimeFormat(
          "ro-RO",
          {
            dateStyle: "medium",
            timeStyle: "short",
          }
        ).format(
          new Date(
            expiresAt
          )
        )
      : null;

const orderLink =
  actionUrl ||
  (
    APP_URL
      ? `${APP_URL}/comanda/${encodeURIComponent(
          orderId
        )}#avans`
      : null
  );

  const subject =
    `Avans solicitat pentru comanda #${displayNo} - ${BRAND_NAME}`;

  const html = `
<div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
  <div style="text-align:center;margin-bottom:20px;">
    <img
      src="${EMAIL_LOGO_URL}"
      alt="${BRAND_NAME} logo"
      width="120"
      style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;"
    >
  </div>

  <div style="background:#ffffff;border-radius:14px;padding:22px;border:1px solid #e5e7eb;">
    <h2 style="color:#111827;margin:0 0 12px;">
      Ai un avans de achitat
    </h2>

    <p style="color:#374151;margin:0 0 12px;line-height:1.6;">
      Bună, <strong>${customerName || "client"}</strong>,
    </p>

    <p style="color:#374151;margin:0 0 16px;line-height:1.6;">
      ${
        vendorName
          ? `Artizanul <strong>${vendorName}</strong>`
          : "Artizanul"
      } a solicitat un avans pentru comanda
      <strong>#${displayNo}</strong>.
    </p>

    <div
      style="
        background:#fff8e8;
        border:1px solid #f3d48a;
        border-radius:12px;
        padding:16px;
        margin:16px 0;
      "
    >
      <div style="margin-bottom:8px;color:#374151;">
        <strong>Avans solicitat:</strong>
        ${depositLabel}
        ${
          depositPercent != null
            ? ` (${depositPercent}%)`
            : ""
        }
      </div>

      ${
        remainingLabel
          ? `
            <div style="margin-bottom:8px;color:#374151;">
              <strong>Rest de achitat la livrare:</strong>
              ${remainingLabel}
            </div>
          `
          : ""
      }

      ${
        expiresLabel
          ? `
            <div style="color:#374151;">
              <strong>Poți achita avansul până la:</strong>
              ${expiresLabel}
            </div>
          `
          : ""
      }
    </div>

    <p style="color:#374151;margin:0 0 16px;line-height:1.6;">
      Pentru a continua, deschide comanda și achită avansul online.
    </p>

    ${
      orderLink
        ? `
          <p style="text-align:center;margin:24px 0 12px;">
            <a
              href="${orderLink}"
              style="
                background:#6f4e43;
                color:#ffffff;
                padding:13px 22px;
                border-radius:10px;
                text-decoration:none;
                font-weight:700;
                display:inline-block;
              "
            >
              Vezi și achită avansul
            </a>
          </p>

          <p style="color:#6b7280;font-size:12px;text-align:center;margin:0;">
            Dacă butonul nu funcționează, accesează:
            <a href="${orderLink}">
              ${orderLink}
            </a>
          </p>
        `
        : ""
    }
  </div>

  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:20px 0 0;">
    Acest email a fost generat automat de ${BRAND_NAME}.
  </p>
</div>
`.trim();

  const text = [
    `Bună, ${customerName || "client"},`,
    "",
    `${vendorName || "Artizanul"} a solicitat un avans pentru comanda #${displayNo}.`,
    `Avans solicitat: ${depositLabel}${
      depositPercent != null
        ? ` (${depositPercent}%)`
        : ""
    }`,
    remainingLabel
      ? `Rest de achitat la livrare: ${remainingLabel}`
      : "",
    expiresLabel
      ? `Avansul poate fi achitat până la: ${expiresLabel}`
      : "",
    "",
    orderLink
      ? `Vezi și achită avansul: ${orderLink}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return sendMailLogged({
    senderKey:
      "noreply",

    to,

    subject,

    template:
      "deposit_requested",

    userId,

    orderId,

    toName:
      customerName ||
      null,

    mailOptions: {
      ...senderEnvelope(
        "noreply"
      ),

      to,

      subject,
      html,
      text,

      headers:
        AUTO_HEADERS,
    },
  });
}

export async function sendVendorDepositPaidEmail({
  to,
  userId = null,
  vendorName,
  orderId,
  orderNumber,
  depositAmount,
  remainingCodAmount = null,
  stripeFeeNet = null,
  transferredAmount = null,
  currency = "RON",
}) {
  if (
    !to ||
    !orderId
  ) {
    return;
  }

  const displayNo =
    orderNumber ||
    orderId;

  const depositLabel =
    formatMoney(
      depositAmount,
      currency
    );

  const remainingLabel =
    remainingCodAmount != null
      ? formatMoney(
          remainingCodAmount,
          currency
        )
      : null;

  const stripeFeeLabel =
    stripeFeeNet != null
      ? formatMoney(
          stripeFeeNet,
          currency
        )
      : null;

  const transferredLabel =
    transferredAmount != null
      ? formatMoney(
          transferredAmount,
          currency
        )
      : null;

  const orderLink =
    APP_URL
      ? `${APP_URL}/vendor/orders?order=${encodeURIComponent(
          orderId
        )}`
      : null;

  const subject =
    `Avans achitat pentru comanda #${displayNo} - ${BRAND_NAME}`;

  const html = `
<div
  style="
    font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;
    max-width:640px;
    margin:auto;
    padding:20px;
    background:#f9fafb;
    border-radius:12px;
  "
>
  <div
    style="
      text-align:center;
      margin-bottom:20px;
    "
  >
    <img
      src="${EMAIL_LOGO_URL}"
      alt="${BRAND_NAME} logo"
      width="120"
      style="
        display:block;
        margin:0 auto;
        border:0;
        outline:none;
        text-decoration:none;
        max-width:120px;
        height:auto;
      "
    >
  </div>

  <div
    style="
      background:#ffffff;
      border-radius:14px;
      padding:22px;
      border:1px solid #e5e7eb;
    "
  >
    <h2
      style="
        color:#111827;
        margin:0 0 12px;
      "
    >
      Avansul a fost achitat ✓
    </h2>

    <p
      style="
        color:#374151;
        margin:0 0 12px;
        line-height:1.6;
      "
    >
      Bună,
      <strong>${vendorName || "Artizan"}</strong>,
    </p>

    <p
      style="
        color:#374151;
        margin:0 0 16px;
        line-height:1.6;
      "
    >
      Clientul a achitat avansul pentru comanda
      <strong>#${displayNo}</strong>.
      Poți începe pregătirea comenzii.
    </p>

    <div
      style="
        background:#ecfdf3;
        border:1px solid #a7f3d0;
        border-radius:12px;
        padding:16px;
        margin:16px 0;
      "
    >
      <div
        style="
          margin-bottom:8px;
          color:#166534;
        "
      >
        <strong>
          Avans achitat:
        </strong>

        ${depositLabel}
      </div>

      ${
        remainingLabel
          ? `
            <div
              style="
                margin-bottom:8px;
                color:#374151;
              "
            >
              <strong>
                Rest de încasat la livrare:
              </strong>

              ${remainingLabel}
            </div>
          `
          : ""
      }

      ${
        transferredLabel
          ? `
            <div
              style="
                margin-bottom:8px;
                color:#374151;
              "
            >
              <strong>
                Transfer către contul tău Stripe:
              </strong>

              ${transferredLabel}
            </div>
          `
          : ""
      }

      ${
        stripeFeeLabel
          ? `
            <div
              style="
                color:#6b7280;
                font-size:13px;
              "
            >
              Taxă procesare Stripe:
              ${stripeFeeLabel}
            </div>
          `
          : ""
      }
    </div>

    <p
      style="
        color:#374151;
        margin:0 0 16px;
        line-height:1.6;
      "
    >
      Suma achitată de client a fost procesată,
      iar partea aferentă ție a fost transferată
      către contul tău Stripe Connect.
    </p>

    ${
      orderLink
        ? `
          <p
            style="
              text-align:center;
              margin:24px 0 12px;
            "
          >
            <a
              href="${orderLink}"
              style="
                background:#6f4e43;
                color:#ffffff;
                padding:13px 22px;
                border-radius:10px;
                text-decoration:none;
                font-weight:700;
                display:inline-block;
              "
            >
              Vezi comanda
            </a>
          </p>
        `
        : ""
    }
  </div>

  <p
    style="
      font-size:12px;
      color:#9ca3af;
      text-align:center;
      margin:20px 0 0;
    "
  >
    Acest email a fost generat automat de ${BRAND_NAME}.
  </p>
</div>
`.trim();

  const text = [
    `Bună, ${vendorName || "Artizan"},`,
    "",
    `Avansul pentru comanda #${displayNo} a fost achitat.`,
    `Avans achitat: ${depositLabel}`,
    remainingLabel
      ? `Rest de încasat la livrare: ${remainingLabel}`
      : "",
    transferredLabel
      ? `Transfer către contul tău Stripe: ${transferredLabel}`
      : "",
    stripeFeeLabel
      ? `Taxă Stripe: ${stripeFeeLabel}`
      : "",
    "",
    "Poți începe pregătirea comenzii.",
    orderLink
      ? `Vezi comanda: ${orderLink}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return sendMailLogged({
    senderKey:
      "noreply",

    to,

    subject,

    template:
      "vendor_deposit_paid",

    userId,

    orderId,

    toName:
      vendorName ||
      null,

    mailOptions: {
      ...senderEnvelope(
        "noreply"
      ),

      to,

      subject,

      html,

      text,

      headers:
        AUTO_HEADERS,
    },
  });
}