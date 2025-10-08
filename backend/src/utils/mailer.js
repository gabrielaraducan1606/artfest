import nodemailer from "nodemailer";

export function makeTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

export async function sendPasswordResetEmail({ to, link }) {
  const transporter = makeTransport();
  const from = process.env.EMAIL_FROM;
  return transporter.sendMail({
    from,
    to,
    subject: "Resetează-ți parola",
    html: `
      <p>Ai cerut resetarea parolei pentru contul tău.</p>
      <p>Apasă pe link pentru a seta o parolă nouă (valabil ${process.env.RESET_TOKEN_TTL_MINUTES || 60} minute):</p>
      <p><a href="${link}">${link}</a></p>
      <p>Dacă nu ai solicitat tu, ignoră acest email.</p>
    `,
  });
}
