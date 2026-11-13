// backend/src/lib/fairDeliveryNotePdf.js
//
// PDF A4 pentru „Aviz de însoțire a mărfii” (cod 14-3-6A, OMFP 2634/2015),
// generat DOAR din datele înghețate la emitere (serializeNote): aceeași
// descărcare dă același document, fără renumerotare. Câmpurile necompletate
// (delegat, mijloc de transport, data/ora expedierii) rămân linii goale, de
// completat de mână. Paginare în subsol: „Pagina X din Y”.

import { renderPdfWithSharedBrowser } from "./pdfBrowser.js";

const TZ = "Europe/Bucharest";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function formatLei(cents) {
  if (cents === null || cents === undefined) return "";
  return new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(cents) / 100);
}

function fmtDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function fmtTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("ro-RO", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const blank = (value, width = 40) =>
  value ? `<b>${esc(value)}</b>` : `<span class="blank" style="min-width:${width}mm"></span>`;

function party(label, p) {
  const name = p?.name ? `${esc(p.name)}${p.legalType && !String(p.name).toUpperCase().includes(String(p.legalType).toUpperCase()) ? ` ${esc(p.legalType)}` : ""}` : "";
  return `
    <section class="party">
      <div class="party-label">${esc(label)}</div>
      <div class="party-name">${name || "&nbsp;"}</div>
      <table class="kv">
        <tr><td>Nr. înmatriculare Registrul Comerțului</td><td>${esc(p?.regCom || "")}</td></tr>
        <tr><td>Cod de identificare fiscală</td><td>${esc(p?.cui || "")}</td></tr>
        <tr><td>Sediul (localitatea, str., nr., județul)</td><td>${esc(p?.address || "")}</td></tr>
      </table>
    </section>`;
}

export function renderDeliveryNoteHtml(note) {
  const withValues = !note.withoutValues;
  const cancelled = note.status === "CANCELLED";
  // previzualizare: fără serie / număr definitiv, marcată vizibil ca neemisă
  const preview = note.preview === true;
  const seriesText = preview ? "—" : esc(note.series);
  const numberText = preview ? "—" : esc(note.number);
  const rows = note.lines
    .map(
      (l) => `
      <tr>
        <td class="c">${l.position}</td>
        <td>${esc(l.title)}${l.variantLabel ? `<div class="sub">${esc(l.variantLabel)}</div>` : ""}<div class="sub">Cod intern: ${esc(l.internalCode)}</div></td>
        <td class="c">${esc(l.unit)}</td>
        <td class="r">${l.quantity}</td>
        <td class="r">${withValues ? formatLei(l.unitPriceCents) : "—"}</td>
        <td class="r">${withValues ? formatLei(l.valueCents) : "—"}</td>
      </tr>`
    )
    .join("");

  const mentions = [
    note.withoutInvoice ? "<div class=\"mention\">Fără factură</div>" : "",
    note.withoutValues ? "<div class=\"mention\">Aviz emis fără valori (valoarea bunurilor se stabilește prin document justificativ separat).</div>" : "",
    note.replaces ? `<div class="mention">Înlocuiește avizul anulat ${esc(note.replaces.series)} nr. ${esc(note.replaces.number)}.</div>` : "",
  ].join("");

  return `<!doctype html>
<html lang="ro"><head><meta charset="utf-8"><title>${preview ? "Previzualizare aviz (neemis)" : `Aviz ${esc(note.series)} nr. ${esc(note.number)}`}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #111; }
  .top { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  .party { border: 0.3mm solid #333; padding: 3mm; }
  .party-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .06em; color: #555; }
  .party-name { font-weight: 700; font-size: 11pt; margin: 1mm 0 2mm; }
  .kv { width: 100%; border-collapse: collapse; }
  .kv td { padding: .6mm 0; vertical-align: top; }
  .kv td:first-child { color: #555; width: 45%; padding-right: 2mm; font-size: 8pt; }
  .title { text-align: center; margin: 6mm 0 4mm; }
  .title h1 { font-size: 16pt; letter-spacing: .08em; margin: 0; }
  .meta { display: inline-grid; grid-template-columns: auto auto auto; border: 0.3mm solid #333; margin-top: 2mm; }
  .meta div { padding: 1.5mm 4mm; border-right: 0.3mm solid #333; }
  .meta div:last-child { border-right: 0; }
  .meta small { display: block; font-size: 7pt; color: #555; }
  .info { border: 0.3mm solid #333; padding: 2mm 3mm; margin-bottom: 4mm; }
  .info p { margin: .8mm 0; }
  .mention { font-weight: 700; margin-top: 1mm; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th, table.items td { border: 0.3mm solid #333; padding: 1.5mm 2mm; vertical-align: top; }
  table.items thead { display: table-header-group; }
  table.items tr { page-break-inside: avoid; }
  table.items th { background: #eee; font-size: 8pt; font-weight: 600; }
  table.items .idx th { font-weight: 400; font-size: 7pt; padding: .5mm; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  .sub { font-size: 7.5pt; color: #555; }
  .total td { font-weight: 700; background: #f5f5f5; }
  .bottom { display: grid; grid-template-columns: 1.6fr 1fr 1fr; border: 0.3mm solid #333; border-top: 0; page-break-inside: avoid; }
  .bottom > div { padding: 3mm; border-right: 0.3mm solid #333; min-height: 38mm; }
  .bottom > div:last-child { border-right: 0; }
  .bottom h3 { font-size: 8pt; text-transform: uppercase; margin: 0 0 2mm; }
  .bottom p { margin: 1.4mm 0; }
  .blank { display: inline-block; border-bottom: 0.2mm dotted #333; height: 3.5mm; vertical-align: bottom; }
  .sign { margin-top: 14mm; border-top: 0.2mm solid #333; padding-top: 1mm; font-size: 7.5pt; color: #555; text-align: center; }
  .stamp { position: fixed; top: 110mm; left: 0; right: 0; text-align: center; font-size: 72pt; font-weight: 800; color: rgba(200,0,0,.18); transform: rotate(-24deg); letter-spacing: .1em; }
  .stamp.preview { top: 100mm; font-size: 46pt; color: rgba(90,60,200,.16); }
  .preview-box { border: 0.5mm dashed #5a3cc8; color: #3d2a8a; padding: 2mm 3mm; margin-bottom: 4mm; font-weight: 700; text-align: center; }
  .cancel-box { border: 0.5mm solid #c00; color: #900; padding: 2mm 3mm; margin-bottom: 4mm; }
</style></head>
<body>
  ${cancelled ? `<div class="stamp">ANULAT</div>` : ""}
  ${preview ? `<div class="stamp preview">PREVIZUALIZARE – NEEMIS</div>` : ""}
  <div class="top">
    ${party("Furnizor (emitent)", note.issuer)}
    ${party("Cumpărător / destinatar", note.recipient)}
  </div>
  <div class="title">
    <h1>AVIZ DE ÎNSOȚIRE A MĂRFII</h1>
    <div class="meta">
      <div><small>Seria</small><b>${seriesText}</b></div>
      <div><small>Nr.</small><b>${numberText}</b></div>
      <div><small>Data (ziua, luna, anul)</small><b>${fmtDate(note.issuedAt)}</b></div>
    </div>
  </div>
  ${preview ? `<div class="preview-box">PREVIZUALIZARE – NEEMIS. Documentul nu are serie și număr și nu poate fi folosit ca aviz. Seria și numărul se atribuie la confirmarea emiterii.</div>` : ""}
  ${cancelled ? `<div class="cancel-box"><b>Aviz ANULAT</b> la ${fmtDate(note.cancelledAt)} ${fmtTime(note.cancelledAt)}. Motiv: ${esc(note.cancelReason || "")}${note.replacedBy ? ` Înlocuit de avizul ${esc(note.replacedBy.series)} nr. ${esc(note.replacedBy.number)}.` : ""}</div>` : ""}
  <div class="info">
    <p><span class="sub">Motivul expedierii:</span> ${esc(note.reason)}</p>
    <p><span class="sub">Locul de destinație (livrare):</span> ${esc(note.destination)}</p>
    ${note.notes ? `<p><span class="sub">Mențiuni:</span> ${esc(note.notes)}</p>` : ""}
    ${mentions}
  </div>
  <table class="items">
    <thead>
      <tr>
        <th style="width:9mm">Nr. crt.</th>
        <th>Denumirea produselor</th>
        <th style="width:12mm">U.M.</th>
        <th style="width:20mm">Cantitatea livrată</th>
        <th style="width:26mm">Prețul unitar (fără T.V.A.) - lei -</th>
        <th style="width:26mm">Valoarea - lei -</th>
      </tr>
      <tr class="idx"><th>0</th><th>1</th><th>2</th><th>3</th><th>4</th><th>5 (3 x 4)</th></tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total">
        <td colspan="3" class="r">TOTAL</td>
        <td class="r">${note.totalQuantity}</td>
        <td></td>
        <td class="r">${withValues ? formatLei(note.totalValueCents) : "—"}</td>
      </tr>
    </tbody>
  </table>
  <div class="bottom">
    <div>
      <h3>Date privind expediția</h3>
      <p>Numele delegatului: ${blank(note.delegate?.name, 55)}</p>
      <p>C.I. seria ${blank(note.delegate?.idSeries, 10)} nr. ${blank(note.delegate?.idNumber, 22)}</p>
      <p>eliberat(ă) de ${blank(note.delegate?.idIssuedBy, 45)}</p>
      <p>Mijlocul de transport ${blank(note.vehicle, 22)} nr. <span class="blank" style="min-width:18mm"></span></p>
      <p>Expedierea s-a efectuat în prezența noastră la data de ${blank(note.shippedAt ? fmtDate(note.shippedAt) : "", 22)} ora ${blank(note.shippedAt ? fmtTime(note.shippedAt) : "", 12)}</p>
      <p>Semnăturile: <span class="blank" style="min-width:50mm"></span></p>
    </div>
    <div><h3>Furnizor</h3><div class="sign">Semnătura reprezentant furnizor</div></div>
    <div><h3>Primire</h3><div class="sign">Semnătura de primire</div></div>
  </div>
</body></html>`;
}

export function deliveryNoteFooter(note) {
  const label = note.preview === true
    ? "PREVIZUALIZARE – NEEMIS · Aviz de însoțire a mărfii · cod 14-3-6A"
    : `Aviz de însoțire a mărfii ${esc(note.series)} nr. ${esc(note.number)} · cod 14-3-6A`;
  return `<div style="width:100%;font-size:7pt;color:#555;padding:0 14mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif">
    <span>${label}</span><span>Pagina <span class="pageNumber"></span> din <span class="totalPages"></span></span></div>`;
}

export async function renderDeliveryNotePdf(note) {
  return renderPdfWithSharedBrowser(renderDeliveryNoteHtml(note), {
    format: "A4",
    margin: { top: "12mm", right: "12mm", bottom: "16mm", left: "12mm" },
    footerTemplate: deliveryNoteFooter(note),
  });
}
