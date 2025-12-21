/**
 * Template email de verificare a contului (signup).
 * Returnează:
 *  - html: corp email HTML
 *  - text: variantă text simplu
 *  - subject: subiectul emailului
 *
 * Parametri:
 *  - link: URL-ul de activare cont
 *  - brandName: numele brandului (default "Artfest")
 *  - logoCid / logoUrl: pentru logo inline sau URL direct
 */

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
    logoCid
      ? `cid:${logoCid}`
      : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

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
    logoCid
      ? `cid:${logoCid}`
      : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

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

/* ======================================================
 *   🔐 NOI template-uri: parolă veche + login suspect
 * ====================================================*/

/**
 * Email template: recomandare schimbare parolă (parolă veche)
 */
export function passwordStaleReminderEmailTemplate({
  passwordAgeDays,
  maxPasswordAgeDays,
  link,
  brandName = "Artfest",
  logoCid,
  logoUrl,
}) {
  const logoSrc =
    logoCid
      ? `cid:${logoCid}`
      : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

  const safeAge = Number.isFinite(passwordAgeDays)
    ? passwordAgeDays
    : null;
  const safeMax = Number.isFinite(maxPasswordAgeDays)
    ? maxPasswordAgeDays
    : null;

  const ageText =
    safeAge != null ? `${safeAge} zile` : "o perioadă îndelungată";
  const maxText =
    safeMax != null ? `${safeMax} zile` : "o perioadă mai lungă";

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${logoSrc}" alt="${brandName} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>
    <h2 style="color:#111827;margin:0 0 8px;">Îți recomandăm să îți actualizezi parola</h2>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Parola contului tău pe <strong>${brandName}</strong> nu a mai fost schimbată de aproximativ <strong>${ageText}</strong>.
    </p>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Din motive de securitate, îți recomandăm să îți actualizezi parola cel puțin o dată la <strong>${maxText}</strong>
      și să folosești o parolă unică, diferită de alte site-uri.
    </p>
    ${
      link
        ? `
      <p style="text-align:center;margin:24px 0 0;">
        <a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Schimbă parola
        </a>
      </p>
    `
        : ""
    }
    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email are scop informativ și a fost generat automat de ${brandName}.
    </p>
  </div>
  `;

  const text = [
    `Parola contului tău pe ${brandName} nu a mai fost schimbată de aproximativ ${ageText}.`,
    `Recomandăm actualizarea parolei cel puțin o dată la ${maxText} și folosirea unei parole unice.`,
    link ? `Poți accesa contul tău aici: ${link}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    html,
    text,
    subject: `Îți recomandăm să îți actualizezi parola pe ${brandName}`,
  };
}

/**
 * Email template: avertizare login suspect (multe încercări eșuate)
 */
export function suspiciousLoginWarningEmailTemplate({
  link,
  brandName = "Artfest",
  logoCid,
  logoUrl,
}) {
  const logoSrc =
    logoCid
      ? `cid:${logoCid}`
      : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${logoSrc}" alt="${brandName} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>
    <h2 style="color:#b91c1c;margin:0 0 8px;">Am observat încercări eșuate de conectare</h2>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Am detectat mai multe încercări eșuate de autentificare în contul tău <strong>${brandName}</strong>
      într-un interval scurt de timp.
    </p>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Dacă <strong>tu</strong> ai încercat să te conectezi și știi de aceste încercări, nu este nevoie să faci nimic în plus.
    </p>
    <p style="color:#374151;margin:0 0 16px;line-height:1.5;">
      Dacă <strong>nu</strong> recunoști aceste încercări:
    </p>
    <ul style="color:#374151;margin:0 0 16px 18px;padding:0;line-height:1.5;">
      <li>îți recomandăm să îți schimbi imediat parola;</li>
      <li>dacă folosești aceeași parolă și pe alte site-uri, actualizeaz-o și acolo;</li>
      <li>evită să folosești aceeași parolă pe mai multe servicii.</li>
    </ul>
    ${
      link
        ? `
      <p style="text-align:center;margin:24px 0 0;">
        <a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Mergi în contul tău
        </a>
      </p>
    `
        : ""
    }
    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email a fost generat automat de ${brandName}. Dacă nu recunoști activitatea, schimbă parola cât mai curând.
    </p>
  </div>
  `;

  const text = [
    `Am observat mai multe încercări eșuate de autentificare în contul tău ${brandName} într-un interval scurt de timp.`,
    `Dacă tu ai făcut aceste încercări, nu este nevoie de altă acțiune.`,
    `Dacă nu recunoști activitatea, îți recomandăm să îți schimbi imediat parola și, dacă o folosești și pe alte site-uri, să o actualizezi și acolo.`,
    link ? `Poți accesa contul tău aici: ${link}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    html,
    text,
    subject: `Avertizare: încercări eșuate de conectare în contul tău ${brandName}`,
  };
}

/* ======================================================
 *   🔔 Template nou: follow-up vendor
 * ====================================================*/

/**
 * Email template: reminder follow-up pentru vendor (lead)
 */
export function vendorFollowUpReminderEmailTemplate({
  contactName,
  followUpAt,
  link,
  brandName = "Artfest",
  logoCid,
  logoUrl,
}) {
  const logoSrc =
    logoCid
      ? `cid:${logoCid}`
      : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

  const dateStr = followUpAt
    ? new Date(followUpAt).toLocaleString("ro-RO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "astăzi";

  const safeName = contactName || "client";

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${logoSrc}" alt="${brandName} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>
    <h2 style="color:#111827;margin:0 0 8px;">Follow-up programat pentru ${safeName}</h2>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Ți-ai propus să revii la acest client în data de <strong>${dateStr}</strong>.
    </p>
    <p style="color:#374151;margin:0 0 16px;line-height:1.5;">
      Îți recomandăm să contactezi acum clientul pentru a continua discuția sau pentru a finaliza rezervarea.
    </p>
    ${
      link
        ? `
      <p style="text-align:center;margin:24px 0 0;">
        <a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Deschide conversația
        </a>
      </p>
    `
        : ""
    }
    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email a fost generat automat de ${brandName} pentru a te ajuta să ții evidența follow-up-urilor.
    </p>
  </div>
  `;

  const textLines = [
    `Follow-up programat pentru ${safeName}.`,
    `Ți-ai propus să revii la acest client în data de ${dateStr}.`,
    link ? `Poți deschide conversația aici: ${link}` : "",
  ].filter(Boolean);

  const text = textLines.join("\n");

  return {
    html,
    text,
    subject: `Follow-up pentru ${safeName} - ${brandName}`,
  };
}
/* ============================================================
   === TEMPLATE-uri GUEST SUPPORT — ADĂUGAT ===
   ============================================================ */

export function guestSupportConfirmationTemplate({
  name,
  subject,
  message,
  brandName = "Artfest",
  logoCid,
  logoUrl,
}) {
  const logoSrc = logoCid ? `cid:${logoCid}` : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

  const html = `
  <div style="font-family:Inter,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${logoSrc}" width="120" />
    </div>

    <h2 style="color:#111827;margin-bottom:10px;">Am primit mesajul tău</h2>

    <p>Bună${name ? " " + name : ""},<br>
    Îți mulțumim că ai contactat suportul ${brandName}. Vom reveni cu un răspuns în cel mai scurt timp.</p>

    <p><strong>Subiect:</strong> ${subject}</p>

    <p><strong>Mesaj trimis:</strong><br>${message}</p>

    <p style="font-size:12px;color:#999;margin-top:20px;">Acest email este o confirmare automată.</p>
  </div>
  `;

  const text = `
Am primit mesajul tău, ${name || ""}.

Subiect: ${subject}
Mesaj: ${message}

Vom reveni cu un răspuns în curând.
  `.trim();

  return {
    html,
    text,
    subject: `Am primit mesajul tău - ${brandName}`,
  };
}

export function guestSupportReplyTemplate({
  name,
  subject,
  reply,
  brandName = "Artfest",
  logoCid,
  logoUrl,
}) {
  const logoSrc = logoCid ? `cid:${logoCid}` : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

  const html = `
  <div style="font-family:Inter,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${logoSrc}" width="120" />
    </div>

    <h2 style="color:#111827;margin-bottom:10px;">Răspuns la mesajul tău</h2>

    <p>Bună${name ? " " + name : ""},</p>

    <p>Ți-am răspuns la solicitarea ta:</p>

    <p style="background:#fff;padding:12px;border-radius:8px;border:1px solid #ddd;">
      ${reply}
    </p>

    <p style="margin-top:16px;font-size:12px;color:#999;">
      Dacă ai alte întrebări, răspunde la acest email.
    </p>
  </div>
  `;

  const text = `
Răspuns la mesajul tău:

${reply}

Ne poți răspunde oricând.
  `.trim();

  return {
    html,
    text,
    subject: `Răspuns la solicitarea ta - ${brandName}`,
  };
}


export function emailChangeVerificationTemplate({
  link,
  brandName = "Artfest",
  logoCid,
  logoUrl,
}) {
  const logoSrc = logoCid
    ? `cid:${logoCid}`
    : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${logoSrc}" alt="${brandName} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>
    <h2 style="color:#111827;margin:0 0 8px;">Confirmă noua ta adresă de email</h2>
    <p style="color:#374151;margin:0 0 16px;">
      Ai cerut schimbarea adresei de email pentru contul tău ${brandName}.
      Pentru a finaliza schimbarea, apasă pe butonul de mai jos:
    </p>
    <p style="text-align:center;margin:30px 0;">
      <a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Confirmă noul email
      </a>
    </p>
    <p style="color:#6b7280;font-size:14px;margin:0 0 8px;">
      Dacă butonul nu funcționează, poți copia acest link în browser:
    </p>
    <p style="word-break:break-all;font-size:13px;margin:0;">
      <a href="${link}" style="color:#4f46e5;">${link}</a>
    </p>
    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Dacă nu ai cerut schimbarea adresei de email, poți ignora acest mesaj.
    </p>
  </div>
  `;

  const text = `
Ai cerut schimbarea adresei de email pentru contul tău ${brandName}.

Pentru a confirma noul email, accesează acest link:
${link}

Dacă nu ai cerut această schimbare, ignoră acest mesaj.
  `.trim();

  return {
    html,
    text,
    subject: `Confirmă noua ta adresă de email pentru ${brandName}`,
  };
}

export function invoiceIssuedEmailTemplate({
  orderId,
  invoiceNumber,
  totalLabel,
  link,
  brandName = "Artfest",
  logoCid,
  logoUrl,
}) {
  const logoSrc = logoCid
    ? `cid:${logoCid}`
    : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

  const safeInvNo = invoiceNumber || "factura ta";

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${logoSrc}" alt="${brandName} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>

    <h2 style="color:#111827;margin:0 0 8px;">A fost emisă o factură pentru comanda ta</h2>
    <p style="color:#374151;margin:0 0 12px;">
      Pentru comanda ta <strong>#${orderId}</strong> a fost emisă <strong>${safeInvNo}</strong>.
    </p>
    ${
      totalLabel
        ? `<p style="color:#374151;margin:0 0 16px;">
            <strong>Total factură:</strong> ${totalLabel}
           </p>`
        : ""
    }

    ${
      link
        ? `
      <p style="text-align:center;margin:24px 0 0;">
        <a href="${link}" style="background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Vezi factura în contul tău
        </a>
      </p>
      <p style="color:#6b7280;font-size:13px;margin:12px 0 0;text-align:center;">
        Sau accesează linkul: <a href="${link}" style="color:#4f46e5;">${link}</a>
      </p>
    `
        : ""
    }

    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email a fost generat automat de ${brandName}. Te rugăm să nu răspunzi la acest mesaj.
    </p>
  </div>
  `;

  const textLines = [
    `A fost emisă o factură pentru comanda ta #${orderId}.`,
    `Număr factură: ${safeInvNo}`,
    totalLabel ? `Total factură: ${totalLabel}` : "",
    link ? `Poți vedea factura aici: ${link}` : "",
  ].filter(Boolean);

  const text = textLines.join("\n");

  return {
    html,
    text,
    subject: `Factura pentru comanda ta #${orderId}`,
  };
}
export function vendorDeactivateConfirmTemplate({
  link,
  brandName = "Artfest",
  logoCid,
  logoUrl,
}) {
  const logoSrc = logoCid
    ? `cid:${logoCid}`
    : (logoUrl || "https://artfest.ro/assets/LogoArtfest.png");

  const html = `
  <div style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:560px;margin:auto;padding:20px;background:#f9fafb;border-radius:12px">
    <div style="text-align:center;margin-bottom:20px;">
      <img src="${logoSrc}" alt="${brandName} logo" width="120" height="120"
           style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;max-width:120px;height:auto;">
    </div>

    <h2 style="color:#111827;margin:0 0 8px;">Confirmă dezactivarea contului de vendor</h2>
    <p style="color:#374151;margin:0 0 12px;line-height:1.5;">
      Ai cerut dezactivarea contului de vendor pe <strong>${brandName}</strong>.
      Această acțiune va ascunde magazinul și produsele, și va opri notificările/marketingul.
    </p>
    <p style="color:#374151;margin:0 0 16px;line-height:1.5;">
      Datele sensibile (facturi, comenzi, billing, mesaje) vor rămâne în sistem pentru obligații legale/audit.
    </p>

    <p style="text-align:center;margin:30px 0;">
      <a href="${link}" style="background:#ef4444;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
        Confirmă dezactivarea
      </a>
    </p>

    <p style="color:#6b7280;font-size:14px;margin:0 0 8px;">Dacă nu ai cerut asta, ignoră emailul.</p>
    <p style="word-break:break-all;font-size:13px;margin:0;">
      <a href="${link}" style="color:#ef4444;">${link}</a>
    </p>

    <hr style="margin:30px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="font-size:12px;color:#9ca3af;text-align:center;margin:0;">
      Acest email a fost generat automat de ${brandName}. Te rugăm să nu răspunzi la acest mesaj.
    </p>
  </div>
  `;

  const text = `
Confirmă dezactivarea contului de vendor pe ${brandName}:

${link}

Dacă nu ai cerut asta, ignoră emailul.
  `.trim();

  return { html, text, subject: `Confirmă dezactivarea contului de vendor - ${brandName}` };
}
