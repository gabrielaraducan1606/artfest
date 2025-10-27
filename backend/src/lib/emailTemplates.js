// backend/emailTemplates.js

/**
 * ✅ Template pentru emailul de verificare cont
 * @param {object} opts
 * @param {string} opts.link - link-ul de activare
 * @param {string} [opts.brandName="Artfest"]
 */
export function verificationEmailTemplate({ link, brandName = "Artfest" }) {
  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="https://artfest.ro/logo.png" alt="${brandName}" style="max-width:120px;">
    </div>
    <h2 style="color:#111827;">Bine ai venit pe ${brandName}!</h2>
    <p style="color:#374151;">Pentru a-ți activa contul, apasă pe butonul de mai jos:</p>
    <p style="text-align:center;margin:30px 0;">
      <a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Activează contul
      </a>
    </p>
    <p style="color:#6b7280;font-size:14px;">Dacă butonul nu funcționează, poți copia acest link în browser:</p>
    <p style="color:#4f46e5;word-break:break-all;font-size:13px;">
      <a href="${link}" style="color:#4f46e5;">${link}</a>
    </p>
    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;">
      Acest email a fost trimis automat de ${brandName}. Dacă nu ai cerut crearea unui cont, ignoră acest mesaj.
    </p>
  </div>
  `;

  const text = `
Bine ai venit pe ${brandName}!

Pentru a-ți activa contul, apasă pe linkul de mai jos:

${link}

Dacă nu ai cerut crearea unui cont, ignoră acest mesaj.
`;

  return { html, text, subject: `Activează-ți contul pe ${brandName}` };
}

/**
 * 📨 Template pentru resetare parolă
 * @param {object} opts
 * @param {string} opts.link
 * @param {string} [opts.brandName="Artfest"]
 */
export function resetPasswordEmailTemplate({ link, brandName = "Artfest" }) {
  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="https://artfest.ro/logo.png" alt="${brandName}" style="max-width:120px;">
    </div>
    <h2 style="color:#111827;">Resetează-ți parola</h2>
    <p style="color:#374151;">Ai cerut resetarea parolei pentru contul tău ${brandName}. Apasă pe butonul de mai jos:</p>
    <p style="text-align:center;margin:30px 0;">
      <a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Resetează parola
      </a>
    </p>
    <p style="color:#6b7280;font-size:14px;">Dacă butonul nu funcționează, poți copia acest link în browser:</p>
    <p style="color:#4f46e5;word-break:break-all;font-size:13px;">
      <a href="${link}" style="color:#4f46e5;">${link}</a>
    </p>
    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;">
      Dacă nu ai cerut resetarea parolei, ignoră acest mesaj.
    </p>
  </div>
  `;

  const text = `
Ai cerut resetarea parolei pentru contul tău ${brandName}.

Pentru a continua, accesează linkul de mai jos:

${link}

Dacă nu ai cerut acest lucru, ignoră acest mesaj.
`;

  return { html, text, subject: `Resetează-ți parola pe ${brandName}` };
}
