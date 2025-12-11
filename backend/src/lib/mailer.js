import nodemailer from "nodemailer";
import {
  verificationEmailTemplate,
  resetPasswordEmailTemplate,
  passwordStaleReminderEmailTemplate,
  suspiciousLoginWarningEmailTemplate,
  vendorFollowUpReminderEmailTemplate,

  // 👇 ADĂUGAT — template guest
  guestSupportConfirmationTemplate,
  guestSupportReplyTemplate,

  // 👇 ADĂUGAT — template schimbare email
  emailChangeVerificationTemplate,

  // 👇 ADĂUGAT — template factură emisă
  invoiceIssuedEmailTemplate,
} from "./emailTemplates.js";

const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(
  /\/+$/,
  ""
);

const BRAND_NAME = process.env.BRAND_NAME || "Artfest";

export function makeTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function withLogo(templateFn, props = {}) {
  const logoCid = "artfest-logo";
  const { html, text, subject } = templateFn({
    brandName: BRAND_NAME,
    logoCid,
    ...props,
  });
  return { html, text, subject, logoCid };
}

/* ============================================================
   === GUEST SUPPORT EMAILS — ADĂUGAT ===
   ============================================================ */

export async function sendGuestSupportConfirmationEmail({
  to,
  name,
  subject,
  message,
}) {
  const transporter = makeTransport();

  const { html, text, subject: emailSubject, logoCid } = withLogo(
    guestSupportConfirmationTemplate,
    { name, subject, message }
  );

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: emailSubject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
  });
}

export async function sendGuestSupportReplyEmail({
  to,
  name,
  subject,
  reply,
}) {
  const transporter = makeTransport();

  const { html, text, subject: emailSubject, logoCid } = withLogo(
    guestSupportReplyTemplate,
    { name, subject, reply }
  );

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: emailSubject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
  });
}

/**
 * ✉️ Trimite email de verificare cont (signup)
 */
export async function sendVerificationEmail({ to, link }) {
  const transporter = makeTransport();
  const { html, text, subject, logoCid } = withLogo(verificationEmailTemplate, {
    link,
  });

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

/**
 * ✉️ Trimite email de resetare parolă
 */
export async function sendPasswordResetEmail({ to, link }) {
  const transporter = makeTransport();
  const { html, text, subject, logoCid } = withLogo(
    resetPasswordEmailTemplate,
    { link }
  );

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

/**
 * ✉️ Trimite email de confirmare schimbare email
 */
export async function sendEmailChangeVerificationEmail({ to, link }) {
  const transporter = makeTransport();
  const { html, text, subject, logoCid } = withLogo(
    emailChangeVerificationTemplate,
    { link }
  );

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

/**
 * helper mic pentru formatat sume
 */
function formatMoney(value, currency = "RON") {
  const v = Number(value || 0);
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

/**
 * Transformă HTML în text simplu (fallback text pentru emailuri marketing)
 */
function stripHtml(html = "") {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * ✉️ Emailuri de marketing (campanii, newsletter)
 */
export async function sendMarketingEmail({ to, subject, html, preheader }) {
  if (!to || !subject || !html) return;

  const transporter = makeTransport();
  const logoCid = "artfest-logo";

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
      <img src="cid:${logoCid}" alt="${BRAND_NAME} logo" width="120" height="120"
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

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html: finalHtml,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

/**
 * ✉️ Email avertizare cont inactiv
 */
export async function sendInactiveAccountWarningEmail({ to, deleteAt }) {
  if (!to || !deleteAt) return;

  const transporter = makeTransport();
  const logoCid = "artfest-logo";

  const dateStr = deleteAt.toLocaleDateString("ro-RO", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const subject = `Contul tău va fi șters pentru inactivitate`;

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="cid:${logoCid}" alt="${BRAND_NAME} logo" width="120" height="120"
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
      Pentru a păstra contul activ, autentifică-te în platformă înainte de această dată. Conectarea
      va reseta timerul de inactivitate.
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

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

/**
 * ✉️ Email de confirmare comandă (commerce)
 */
export async function sendOrderConfirmationEmail({
  to,
  order,
  items,
  storeAddresses,
}) {
  if (!to || !order) return;

  const transporter = makeTransport();

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

  // 👇 nou: adrese retur magazine (dacă avem)
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

  const logoCid = "artfest-logo";

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="cid:${logoCid}" alt="${BRAND_NAME} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>

    <h2 style="color:#111827;margin:0 0 8px;">Mulțumim pentru comandă, ${customerName}!</h2>
    <p style="color:#374151;margin:0 0 12px;">
      Comanda ta pe <strong>${BRAND_NAME}</strong> a fost înregistrată cu succes.
    </p>
    <p style="color:#374151;margin:0 0 16px;">
      <strong>Număr comandă:</strong> ${order.id}<br>
      <strong>Metodă de plată:</strong> ${
        order.paymentMethod === "COD"
          ? "Plată la livrare (ramburs)"
          : "Card online"
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
      order.paymentMethod === "COD"
        ? "Plată la livrare (ramburs)"
        : "Card online"
    }`,
    "",
    "Produse:",
    ...(items || []).map(
      (it) =>
        `- ${it.title} x${it.qty} = ${formatMoney(
          it.price * it.qty,
          currency
        )}`
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

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: `Confirmare comandă #${order.id} - ${BRAND_NAME}`,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

/**
 * ✉️ Email „comanda a fost anulată de vendor”
 */
export async function sendOrderCancelledEmail({
  to,
  orderId,
  shortId,
  vendorName,
  cancelReason,
  cancelReasonNote,
  shippingAddress,
}) {
  if (!to || !orderId) return;

  const transporter = makeTransport();
  const logoCid = "artfest-logo";

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
      <img src="cid:${logoCid}" alt="${BRAND_NAME} logo" width="120" height="120"
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

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

/**
 * ✉️ Email „comanda a fost anulată de CLIENT”
 */
export async function sendOrderCancelledByUserEmail({ to, order }) {
  if (!to || !order) return;

  const transporter = makeTransport();
  const logoCid = "artfest-logo";

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
      <img src="cid:${logoCid}" alt="${BRAND_NAME} logo" width="120" height="120"
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

    <p style="color:#6b7280;margin:0 0 16px;line-height:1.5;font-size:14px;">
      Artizanii au fost anunțați despre anulare. Dacă ai anulat din greșeală sau dorești să refaci comanda,
      poți comanda din nou din istoricul tău sau direct din paginile de produs.
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

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

/* =========================================================
 *  🔐 NOI: mailuri de securitate (parolă veche + login suspect)
 * =======================================================*/

export async function sendPasswordStaleReminderEmail({
  to,
  passwordAgeDays,
  maxPasswordAgeDays,
}) {
  if (!to) return;

  const transporter = makeTransport();
  const { html, text, subject, logoCid } = withLogo(
    passwordStaleReminderEmailTemplate,
    {
      passwordAgeDays,
      maxPasswordAgeDays,
      link: APP_URL || undefined,
    }
  );

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

export async function sendSuspiciousLoginWarningEmail({ to }) {
  if (!to) return;

  const transporter = makeTransport();
  const { html, text, subject, logoCid } = withLogo(
    suspiciousLoginWarningEmailTemplate,
    {
      link: APP_URL || undefined,
    }
  );

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

/* =========================================================
 *  🔔 NOU: mail follow-up vendor
 * =======================================================*/

export async function sendVendorFollowUpReminderEmail({
  to,
  contactName,
  followUpAt,
  threadLink,
}) {
  if (!to) return;

  const transporter = makeTransport();

  const fullLink =
    threadLink && APP_URL
      ? `${APP_URL.replace(/\/+$/, "")}${threadLink}`
      : undefined;

  const { html, text, subject, logoCid } = withLogo(
    vendorFollowUpReminderEmailTemplate,
    {
      contactName,
      followUpAt,
      link: fullLink,
    }
  );

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}

/* =========================================================
 *  ✉️ NOU: email „factura a fost emisă”
 * =======================================================*/

export async function sendInvoiceIssuedEmail({
  to,
  orderId,
  invoiceNumber,
  totalGross,
  currency = "RON",
  invoiceFrontendPath, // ex: /comanda/123 sau /cont/facturi?order=...
}) {
  if (!to || !orderId) return;

  const transporter = makeTransport();

  const totalLabel = formatMoney(totalGross || 0, currency);

  const baseUrl = APP_URL ? APP_URL.replace(/\/+$/, "") : null;
  const link =
    baseUrl && invoiceFrontendPath
      ? `${baseUrl}${invoiceFrontendPath}`
      : baseUrl
      ? `${baseUrl}/comenzile-mele?order=${encodeURIComponent(orderId)}`
      : undefined;

  const { html, text, subject, logoCid } = withLogo(
    invoiceIssuedEmailTemplate,
    {
      orderId,
      invoiceNumber,
      totalLabel,
      link,
    }
  );

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}
/* =========================================================
 *  ✉️ NOU: email „comanda a fost predată curierului”
 * =======================================================*/

export async function sendShipmentPickupEmail({
  to,
  orderId,
  awb,
  trackingUrl,
  etaLabel,   // ex: "azi" / "mâine"
  slotLabel,  // ex: "14-18"
}) {
  if (!to) return;

  const transporter = makeTransport();
  const logoCid = "artfest-logo";

  const baseUrl = APP_URL ? APP_URL.replace(/\/+$/, "") : null;
  const orderLink = baseUrl
    ? `${baseUrl}/comenzile-mele?order=${encodeURIComponent(orderId)}`
    : null;

  const subject = `Comanda ta a fost predată curierului - ${BRAND_NAME}`;

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="cid:${logoCid}" alt="${BRAND_NAME} logo" width="120" height="120"
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

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png",
        cid: logoCid,
        contentType: "image/png",
      },
    ],
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      Precedence: "bulk",
    },
  });
}
