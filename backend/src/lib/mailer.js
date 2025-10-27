import nodemailer from "nodemailer";
import { verificationEmailTemplate, resetPasswordEmailTemplate } from "./emailTemplates.js";

export function makeTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function sendVerificationEmail({ to, link }) {
  const { html, text, subject } = verificationEmailTemplate({ link, brandName: "Artfest" });
  const transporter = makeTransport();
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      "Precedence": "bulk",
    },
  });
}

export async function sendPasswordResetEmail({ to, link }) {
  const { html, text, subject } = resetPasswordEmailTemplate({ link, brandName: "Artfest" });
  const transporter = makeTransport();
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "All",
      "Precedence": "bulk",
    },
  });
}
