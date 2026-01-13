// backend/src/lib/invoiceHtmlTemplate.js
//
// HTML template “factură perfectă” pentru marketplace:
// - Brand vendor fără logo (monogram + nume comercial)
// - Date fiscale vendor (din billingProfile) + contact
// - Platforma (ArtFest) apare ca “operator marketplace / suport”, NU ca vânzător
// - Tabel cu cap repetat pe pagini (pentru Puppeteer/print)
// - Footer fix cu vendor + suport platformă
//
// Folosire:
// const platform = { name:"ArtFest", supportEmail:"support@artfest.ro", website:"artfest.ro" };
// const html = renderInvoiceHtml({ invoice, billingProfile, platform });

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function f2(n) {
  return Number(n || 0).toFixed(2);
}

function fmtDateRo(d) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("ro-RO");
  } catch {
    return "-";
  }
}

function initials(name) {
  const s = String(name || "").trim();
  if (!s) return "V";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = (parts[0] || "").slice(0, 1);
  const b = (parts[1] || parts[0] || "").slice(0, 1);
  return (a + b).toUpperCase();
}

function vendorDisplayName(vendor) {
  // vendorName = nume comercial (din UI-ul tău)
  // companyName = denumire legală
  return vendor.vendorName || vendor.companyName || "";
}

function vatDisplay(vendor) {
  const st = String(vendor?.vatStatus || "").trim();
  if (st === "payer") {
    const r = vendor?.vatRate ? `${vendor.vatRate}%` : "—";
    return `Plătitor (${r})`;
  }
  if (st === "non_payer") return "Neplătitor";
  return "-";
}

export function renderInvoiceHtml({ invoice, billingProfile, platform }) {
  const cur = invoice.currency || "RON";
  const issueDate = fmtDateRo(invoice.issueDate);
  const dueDate = fmtDateRo(invoice.dueDate || invoice.issueDate);

  const vendor = billingProfile || {};
  const lines = invoice.lines || [];

  // Platform config (ArtFest)
  const pf = platform || {
    name: "ArtFest",
    supportEmail: "support@artfest.ro",
    website: "artfest.ro",
  };

  // Branding vendor fără logo: monogram + nume comercial
  const vendorTitle = vendorDisplayName(vendor) || "Vânzător";
  const vendorSubtitle = [
    vendor.companyName,
    vendor.legalType ? `(${vendor.legalType})` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const vendorMark = initials(vendorTitle || vendor.companyName);

  // calc per line (dacă nu ai deja totalNet/totalVat pe linie)
  const computedLines = lines.map((ln) => {
    const qty = Number(ln.quantity || 0);
    const unit = Number(ln.unitNet || 0);
    const vatRate = Number(ln.vatRate || 0);

    const net = qty * unit;
    const vat = (net * vatRate) / 100;
    const gross = net + vat;

    return { ...ln, qty, unit, vatRate, net, vat, gross };
  });

  const totalNet = Number(
    invoice.totalNet || computedLines.reduce((a, x) => a + x.net, 0)
  );
  const totalVat = Number(
    invoice.totalVat || computedLines.reduce((a, x) => a + x.vat, 0)
  );
  const totalGross = Number(invoice.totalGross || totalNet + totalVat);

  const invoiceNumber = invoice.number || invoice.id;
  const series = invoice.series || "FA";

  // optional: defalcare TVA
  const vatGroups = new Map();
  for (const ln of computedLines) {
    const k = ln.vatRate.toFixed(2);
    const g = vatGroups.get(k) || { rate: ln.vatRate, net: 0, vat: 0 };
    g.net += ln.net;
    g.vat += ln.vat;
    vatGroups.set(k, g);
  }
  const vatRows = [...vatGroups.values()].sort((a, b) => a.rate - b.rate);

  const notes = invoice.notes ? esc(invoice.notes).replaceAll("\n", "<br/>") : "";

  return `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Factura ${esc(series)} ${esc(invoiceNumber)}</title>

  <style>
    /* ==== Page setup ==== */
    @page { size: A4; margin: 14mm 14mm 18mm 14mm; }
    html, body { height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial, sans-serif;
      color: #111;
      font-size: 12px;
      line-height: 1.35;
    }

    /* ==== Layout ==== */
    .row { display: flex; gap: 16px; }
    .col { flex: 1; }
    .muted { color: #666; }
    .h1 { font-size: 22px; font-weight: 800; letter-spacing: .5px; }
    .h2 { font-size: 13px; font-weight: 700; margin: 0 0 6px 0; }
    .box {
      border: 1px solid #e6e6e6;
      border-radius: 10px;
      padding: 10px 12px;
      background: #fff;
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 14px;
    }

    /* ==== Brand (no-logo vendor) ==== */
    .brandRow { display:flex; gap:10px; align-items:center; }
    .mark {
      width: 38px; height: 38px; border-radius: 12px;
      display:flex; align-items:center; justify-content:center;
      border: 1px solid #e6e6e6; background:#fafafa;
      font-weight: 800;
      letter-spacing: .5px;
    }
    .brandTitle { font-size: 14px; font-weight: 800; margin:0; }
    .brandSub { font-size: 11px; color:#666; margin:0; }
    .powered { font-size: 10px; color:#777; margin-top:2px; }

    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid #e6e6e6;
      font-size: 11px;
      color: #333;
      background: #fafafa;
    }
    .small { font-size: 11px; }

    /* ==== Table ==== */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    thead { display: table-header-group; }
    tfoot { display: table-row-group; }
    tr { page-break-inside: avoid; }
    th, td {
      border-bottom: 1px solid #eee;
      padding: 8px 8px;
      vertical-align: top;
    }
    th {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .4px;
      color: #444;
      background: #fafafa;
      border-top: 1px solid #eee;
    }
    td.num, th.num { text-align: right; white-space: nowrap; }
    td.desc { width: 44%; }

    /* ==== Totals ==== */
    .totals {
      margin-top: 12px;
      display: flex;
      justify-content: flex-end;
    }
    .totals .box { min-width: 260px; }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
    }
    .totals-row strong { font-weight: 800; }
    .grand {
      border-top: 1px dashed #ddd;
      margin-top: 6px;
      padding-top: 8px;
      font-size: 14px;
    }

    /* ==== Footer ==== */
    .footer {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 8mm;
      font-size: 10px;
      color: #777;
    }
    .footer .line {
      border-top: 1px solid #eee;
      margin-top: 6px;
      padding-top: 6px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }

    /* ==== Print hints ==== */
    .avoid-break { page-break-inside: avoid; }
  </style>
</head>

<body>
  <div class="topbar">
    <div class="brand">
      <div class="brandRow">
        <div class="mark">${esc(vendorMark)}</div>
        <div>
          <div class="brandTitle">${esc(vendorTitle)}</div>
          <div class="brandSub">${esc(vendorSubtitle || "—")}</div>
          <div class="powered">Vândut prin ${esc(pf.name || "platformă marketplace")}</div>
        </div>
      </div>
    </div>

    <div style="text-align:right">
      <div class="h1">FACTURĂ</div>
      <div style="height:6px"></div>
      <div class="pill">Serie: <strong>${esc(series)}</strong></div>
      <div style="height:6px"></div>
      <div class="pill">Număr: <strong>${esc(invoiceNumber)}</strong></div>
      <div style="height:6px"></div>
      <div class="muted small">Dată emitere: <strong>${esc(issueDate)}</strong></div>
      <div class="muted small">Scadență: <strong>${esc(dueDate)}</strong></div>
    </div>
  </div>

  <div class="row">
    <div class="col box">
      <div class="h2">Vânzător</div>
      <div><strong>${esc(vendor.companyName || vendorTitle || "")}</strong></div>
      <div class="muted">Nume comercial: ${esc(vendor.vendorName || "-")}</div>
      <div class="muted">CUI: ${esc(vendor.cui || "-")}</div>
      <div class="muted">Nr. Reg. Com.: ${esc(vendor.regCom || "-")}</div>
      <div class="muted">Adresă: ${esc(vendor.address || "-")}</div>
      <div class="muted">Email: ${esc(vendor.email || "-")}</div>
      <div class="muted">Telefon: ${esc(vendor.phone || "-")}</div>
      <div class="muted">Persoană contact: ${esc(vendor.contactPerson || "-")}</div>
      <div class="muted">IBAN: ${esc(vendor.iban || "-")}</div>
      <div class="muted">Banca: ${esc(vendor.bank || "-")}</div>
      <div class="muted">Statut TVA: ${esc(vatDisplay(vendor))}</div>
    </div>

    <div class="col box">
      <div class="h2">Cumpărător</div>
      <div><strong>${esc(invoice.clientName || "-")}</strong></div>
      <div class="muted">Email: ${esc(invoice.clientEmail || "-")}</div>
      <div class="muted">Telefon: ${esc(invoice.clientPhone || "-")}</div>
      <div class="muted">Adresă: ${esc(invoice.clientAddress || "-")}</div>
      ${
        invoice.orderId
          ? `<div class="muted">Comandă / Referință: ${esc(invoice.orderId)}</div>`
          : ""
      }
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="desc">Descriere</th>
        <th class="num">Cant.</th>
        <th class="num">Preț unitar</th>
        <th class="num">TVA %</th>
        <th class="num">Valoare</th>
      </tr>
    </thead>
    <tbody>
      ${
        computedLines.length
          ? computedLines
              .map(
                (ln) => `
        <tr>
          <td class="desc">
            <div><strong>${esc(ln.description || "")}</strong></div>
          </td>
          <td class="num">${esc(ln.qty)}</td>
          <td class="num">${esc(f2(ln.unit))} ${esc(cur)}</td>
          <td class="num">${esc(ln.vatRate.toFixed(0))}%</td>
          <td class="num"><strong>${esc(f2(ln.gross))} ${esc(cur)}</strong></td>
        </tr>`
              )
              .join("")
          : `
        <tr>
          <td class="desc muted">—</td>
          <td class="num muted">0</td>
          <td class="num muted">0.00 ${esc(cur)}</td>
          <td class="num muted">0%</td>
          <td class="num muted">0.00 ${esc(cur)}</td>
        </tr>`
      }
    </tbody>
  </table>

  <div class="row" style="margin-top:12px">
    <div class="col">
      ${
        notes
          ? `<div class="box avoid-break">
              <div class="h2">Mențiuni</div>
              <div>${notes}</div>
            </div>`
          : ""
      }

      ${
        vatRows.length > 1
          ? `<div class="box avoid-break" style="margin-top:10px">
              <div class="h2">Defalcare TVA</div>
              <table style="margin-top:6px">
                <thead>
                  <tr>
                    <th>TVA %</th>
                    <th class="num">Bază</th>
                    <th class="num">TVA</th>
                  </tr>
                </thead>
                <tbody>
                  ${vatRows
                    .map(
                      (g) => `
                    <tr>
                      <td>${esc(g.rate.toFixed(0))}%</td>
                      <td class="num">${esc(f2(g.net))} ${esc(cur)}</td>
                      <td class="num">${esc(f2(g.vat))} ${esc(cur)}</td>
                    </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
          : ""
      }
    </div>

    <div class="col totals">
      <div class="box avoid-break">
        <div class="totals-row"><span>Total fără TVA</span><span>${esc(f2(totalNet))} ${esc(cur)}</span></div>
        <div class="totals-row"><span>TVA</span><span>${esc(f2(totalVat))} ${esc(cur)}</span></div>
        <div class="totals-row grand"><strong>Total de plată</strong><strong>${esc(f2(totalGross))} ${esc(cur)}</strong></div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div class="line">
      <div>
        ${esc(vendorTitle || vendor.companyName || "Vânzător")} • CUI: ${esc(vendor.cui || "-")} • IBAN: ${esc(vendor.iban || "-")}
      </div>
      <div>
        Suport ${esc(pf.name || "platformă")}: ${esc(pf.supportEmail || "")} • ${esc(pf.website || "")}
      </div>
    </div>
  </div>
</body>
</html>`;
}
