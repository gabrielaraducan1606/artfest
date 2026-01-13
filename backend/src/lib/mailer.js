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
export async function sendOrderConfirmationEmail({ to, order, items, storeAddresses, userId = null }) {
  if (!to || !order) return;

  const currency = order.currency || "RON";
  const total = formatMoney(order.total, currency);
  const subtotal = formatMoney(order.subtotal, currency);
  const shippingTotal = formatMoney(order.shippingTotal, currency);

  const address = order.shippingAddress || {};
  const customerName = address.name || `${address.lastName || ""} ${address.firstName || ""}`.trim() || "client";

  const orderLink = APP_URL ? `${APP_URL}/comenzile-mele?order=${encodeURIComponent(order.id)}` : null;

  const itemsRows =
    (items || [])
      .map(
        (it) => `
<tr>
  <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;">${it.title}</td>
  <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">x${it.qty}</td>
  <td style="padding:4px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatMoney(
    it.price * it.qty,
    currency
  )}</td>
</tr>`
      )
      .join("") ||
    `<tr><td colspan="3" style="padding:8px;text-align:center;color:#6b7280;">Detaliile produselor nu sunt disponibile.</td></tr>`;

  const storeAddressesMap = storeAddresses || (order.meta && order.meta.storeAddresses) || null;

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
</p>`;
    })
    .join("")}
</div>`.trim();

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
    <img src="${EMAIL_LOGO_URL}" alt="${BRAND_NAME} logo" width="120" height="120"
      style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
  </div>

  <h2 style="color:#111827;margin:0 0 8px;">Mulțumim pentru comandă, ${customerName}!</h2>
  <p style="color:#374151;margin:0 0 12px;">Comanda ta pe <strong>${BRAND_NAME}</strong> a fost înregistrată cu succes.</p>
  <p style="color:#374151;margin:0 0 16px;">
    <strong>Număr comandă:</strong> ${order.id}<br>
    <strong>Metodă de plată:</strong> ${order.paymentMethod === "COD" ? "Plată la livrare (ramburs)" : "Card online"}
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
    ${`${address.postalCode || ""} ${address.city || ""}`.trim()}<br>
    ${address.county || ""}<br>
    Tel: ${address.phone || ""}
  </p>

  ${storeAddressesHtml}

  ${
    orderLink
      ? `<p style="text-align:center;margin:24px 0 12px;">
           <a href="${orderLink}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
             Vezi comanda în contul tău
           </a>
         </p>
         <p style="color:#6b7280;font-size:13px;margin:0 0 8px;text-align:center;">
           Sau accesează linkul: <a href="${orderLink}" style="color:#4f46e5;">${orderLink}</a>
         </p>`
      : ""
  }

  <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
    Acest email a fost generat automat de ${BRAND_NAME}. Te rugăm să nu răspunzi la acest mesaj.
  </p>
</div>`.trim();

  const textLines = [
    `Mulțumim pentru comandă, ${customerName}!`,
    "",
    `Comanda ta pe ${BRAND_NAME} a fost înregistrată.`,
    `Număr comandă: ${order.id}`,
    `Metodă de plată: ${order.paymentMethod === "COD" ? "Plată la livrare (ramburs)" : "Card online"}`,
    "",
    "Produse:",
    ...(items || []).map((it) => `- ${it.title} x${it.qty} = ${formatMoney(it.price * it.qty, currency)}`),
    "",
    `Subtotal: ${subtotal}`,
    `Transport: ${shippingTotal}`,
    `Total: ${total}`,
    "",
    "Adresă livrare:",
    customerName,
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
  const emailSubject = `Confirmare comandă #${order.id} - ${BRAND_NAME}`;

  return sendMailLogged({
    senderKey: "noreply",
    to,
    subject: emailSubject,
    template: "order_confirmation",
    userId,
    orderId: order.id,
    toName: customerName,
    mailOptions: {
      ...senderEnvelope("noreply"),
      to,
      subject: emailSubject,
      html,
      text,
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
  const link = baseUrl && invoiceFrontendPath ? `${baseUrl}${invoiceFrontendPath}` : baseUrl ? `${baseUrl}/comenzile-mele?order=${encodeURIComponent(orderId)}` : undefined;

  const { html, text, subject } = await withLogo(invoiceIssuedEmailTemplate, {
    orderId,
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
    orderId,
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
    <strong>Număr comandă:</strong> ${orderId}<br>
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
    `Număr comandă: ${orderId}`,
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
