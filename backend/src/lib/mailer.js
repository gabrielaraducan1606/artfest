// mailer.js
import nodemailer from "nodemailer";
import { verificationEmailTemplate, resetPasswordEmailTemplate } from "./emailTemplates.js";

export function makeTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // TLS implicit pe 465
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

/**
 * helper comun: atașează logo + setează cid în template
 */
function withLogo(templateFn, { link, brandName }) {
  // folosim același CID peste tot
  const logoCid = "artfest-logo";
  const { html, text, subject } = templateFn({ link, brandName, logoCid });
  return { html, text, subject, logoCid };
}

export async function sendVerificationEmail({ to, link }) {
  const transporter = makeTransport();
  const { html, text, subject, logoCid } = withLogo(verificationEmailTemplate, {
    link,
    brandName: "Artfest",
  });

  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    attachments: [
      {
        // poți pune și path local: path: join(process.cwd(), "public/email/logo-artfest-240.png")
        filename: "logo-artfest-240.png",
        path: "https://artfest.ro/assets/LogoArtfest.png", // asigură-te că e PNG și răspunde 200 + image/png
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

export async function sendPasswordResetEmail({ to, link }) {
  const transporter = makeTransport();
  const { html, text, subject, logoCid } = withLogo(resetPasswordEmailTemplate, {
    link,
    brandName: "Artfest",
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
