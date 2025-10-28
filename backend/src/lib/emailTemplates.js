// emailTemplates.js

/**
 * @param {object} opts
 * @param {string} opts.link
 * @param {string} [opts.brandName="Artfest"]
 * @param {string} [opts.logoCid]  // dacă e setat, folosim cid:<logoCid>
 * @param {string} [opts.logoUrl]  // fallback absolut HTTPS
 */
export function verificationEmailTemplate({
  link,
  brandName = "Artfest",
  logoCid,
  logoUrl,
}) {
  const logoSrc =
    logoCid ? `cid:${logoCid}` : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${logoSrc}" alt="${brandName} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>
    <h2 style="color:#111827;margin:0 0 8px;">Bine ai venit pe ${brandName}!</h2>
    <p style="color:#374151;margin:0 0 16px;">Pentru a-ți activa contul, apasă pe butonul de mai jos:</p>
    <p style="text-align:center;margin:30px 0;">
      <a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Activează contul
      </a>
    </p>
    <p style="color:#6b7280;font-size:14px;margin:0 0 8px;">Dacă butonul nu funcționează, poți copia acest link în browser:</p>
    <p style="word-break:break-all;font-size:13px;margin:0;">
      <a href="${link}" style="color:#4f46e5;">${link}</a>
    </p>
    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email a fost trimis automat de ${brandName}. Dacă nu ai cerut crearea unui cont, ignoră acest mesaj.
    </p>
  </div>
  `;

  const text = `
Bine ai venit pe ${brandName}!

Pentru a-ți activa contul, apasă pe linkul de mai jos:

${link}

Dacă nu ai cerut crearea unui cont, ignoră acest mesaj.
`.trim();

  return { html, text, subject: `Activează-ți contul pe ${brandName}` };
}

export function resetPasswordEmailTemplate({
  link,
  brandName = "Artfest",
  logoCid,
  logoUrl,
}) {
  const logoSrc =
    logoCid ? `cid:${logoCid}` : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${logoSrc}" alt="${brandName} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>
    <h2 style="color:#111827;margin:0 0 8px;">Resetează-ți parola</h2>
    <p style="color:#374151;margin:0 0 16px;">Ai cerut resetarea parolei pentru contul tău ${brandName}. Apasă pe butonul de mai jos:</p>
    <p style="text-align:center;margin:30px 0;">
      <a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Resetează parola
      </a>
    </p>
    <p style="color:#6b7280;font-size:14px;margin:0 0 8px;">Dacă butonul nu funcționează, poți copia acest link în browser:</p>
    <p style="word-break:break-all;font-size:13px;margin:0;">
      <a href="${link}" style="color:#4f46e5;">${link}</a>
    </p>
    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Dacă nu ai cerut resetarea parolei, ignoră acest mesaj.
    </p>
  </div>
  `;

  const text = `
Ai cerut resetarea parolei pentru contul tău ${brandName}.

Pentru a continua, accesează linkul de mai jos:

${link}

Dacă nu ai cerut acest lucru, ignoră acest mesaj.
`.trim();

  return { html, text, subject: `Resetează-ți parola pe ${brandName}` };
}
