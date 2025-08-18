// backend/utils/contractTemplate.js
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FONT_PATH = path.join(ROOT, "assets", "fonts", "DejaVuSans.ttf"); // TTF cu diacritice

let FONT_BYTES_CACHE = null; // ca să nu citim fișierul de fiecare dată

function wrap(font, text, size, maxW) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(t, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = t;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawKV(page, font, k, v, x, y, size = 11, totalW = 495) {
  const wK = Math.min(180, font.widthOfTextAtSize(k, size) + 6);
  page.drawText(k, { x, y, size, font, color: rgb(0.25, 0.25, 0.25) });
  const xV = x + wK;
  const lines = wrap(font, v, size, totalW - wK);
  lines.forEach((ln, i) => {
    page.drawText(ln, { x: xV, y: y - i * (size + 4), size, font, color: rgb(0, 0, 0) });
  });
  return y - (lines.length - 1) * (size + 4);
}

function drawTitle(page, font, title, x, y) {
  page.drawText(title, { x, y, size: 14, font, color: rgb(0, 0, 0) });
  page.drawLine({
    start: { x, y: y - 4 },
    end: { x: x + 495, y: y - 4 },
    thickness: 0.7,
    color: rgb(0.3, 0.3, 0.3),
  });
}

function catLabel(v) {
  const map = {
    "bijuterii-accesorii": "Bijuterii și accesorii",
    "articole-evenimente": "Articole pentru evenimente",
    "moda-handmade": "Modă handmade",
    "decoratiuni-interioare": "Decorațiuni interioare",
    "papetarie-cadouri": "Papetărie și cadouri",
    "produse-copii": "Produse pentru copii",
    "cosmetice-naturale": "Produse cosmetice naturale",
    "cadouri-personalizate": "Cadouri personalizate",
    altele: "Altele",
  };
  return map[v] || v || "—";
}

async function getFontBytes() {
  if (!fsSync.existsSync(FONT_PATH)) {
    throw new Error(`Lipsește fontul TTF cu diacritice: ${FONT_PATH}`);
  }
  if (!FONT_BYTES_CACHE) {
    FONT_BYTES_CACHE = await fs.readFile(FONT_PATH);
  }
  return FONT_BYTES_CACHE;
}

export async function buildContractForSellerPDF({ seller, number }) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit); // IMPORTANT: înregistrează fontkit

  const fontBytes = await getFontBytes();
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  // A4
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const M = 50;
  let y = height - M;

  // Header
  page.drawText("Contract de colaborare", { x: M, y, size: 22, font, color: rgb(0, 0, 0) });
  y -= 26;
  page.drawText(`Nr. ${number} — Seller: ${seller.shopName}`, {
    x: M,
    y,
    size: 11,
    font,
    color: rgb(0.2, 0.2, 0.2),
  });
  y -= 22;

  // Părți
  drawTitle(page, font, "I. Părțile", M, y);
  y -= 20;
  y = drawKV(page, font, "Vânzător:", seller.shopName || seller.companyName || "—", M, y);
  y -= 12;
  y = drawKV(page, font, "Tip entitate:", (seller.entityType || "").toUpperCase(), M, y);
  y -= 12;
  y = drawKV(page, font, "CUI:", seller.cui || "—", M, y);
  y -= 12;
  y = drawKV(
    page,
    font,
    "Adresă:",
    [seller.address, seller.city, seller.country].filter(Boolean).join(", ") || "—",
    M,
    y
  );
  y -= 12;
  y = drawKV(page, font, "IBAN:", seller.iban || "—", M, y);
  y -= 12;
  y = drawKV(
    page,
    font,
    "Contact:",
    [seller.publicEmail || seller.emailFinance || seller.email, seller.publicPhone ? seller.phone : ""]
      .filter(Boolean)
      .join(" | ") || "—",
    M,
    y
  );
  y -= 12;
  y = drawKV(page, font, "Categorie:", catLabel(seller.category), M, y);
  y -= 20;

  // Obiect
  drawTitle(page, font, "II. Obiectul", M, y);
  y -= 18;
  wrap(
    font,
    "Prezentul contract reglementează colaborarea dintre Platformă și Vânzător pentru listarea, promovarea și vânzarea online a produselor handmade prin intermediul marketplace-ului.",
    11,
    width - M * 2
  ).forEach((ln) => {
    page.drawText(ln, { x: M, y, size: 11, font });
    y -= 15;
  });
  y -= 6;

  // Condiții
  drawTitle(page, font, "III. Termene și condiții sintetice", M, y);
  y -= 18;
  const bullets = [
    `Plan abonament selectat: ${(seller.subscriptionPlan || "start").toUpperCase()}.`,
    "Plățile către Vânzător se efectuează în contul IBAN indicat, conform politicilor de decont.",
    "Vânzătorul garantează originalitatea și conformitatea produselor listate.",
    "Politici de livrare/retur comunicate public pe pagina Vânzătorului.",
  ];
  bullets.forEach((b) => {
    wrap(font, "• " + b, 11, width - M * 2).forEach((ln) => {
      page.drawText(ln, { x: M, y, size: 11, font });
      y -= 15;
    });
    y -= 4;
  });

  // Semnături
  y -= 10;
  drawTitle(page, font, "IV. Semnături", M, y);
  y -= 60;
  page.drawText("VÂNZĂTOR", { x: M, y: y + 40, size: 11, font });
  page.drawLine({ start: { x: M, y }, end: { x: M + 220, y }, thickness: 0.7 });
  page.drawText("PLATFORMĂ", { x: M + 275, y: y + 40, size: 11, font });
  page.drawLine({ start: { x: M + 275, y }, end: { x: M + 495, y }, thickness: 0.7 });

  const note =
    "Document generat electronic pe baza datelor furnizate la onboarding (Pasul 1 și Pasul 2). Versiunea semnată va include data/ora și adresa IP.";
  y -= 40;
  wrap(font, note, 9.5, width - M * 2).forEach((ln) => {
    page.drawText(ln, { x: M, y, size: 9.5, font, color: rgb(0.2, 0.2, 0.2) });
    y -= 13;
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

export async function signContractPDF({ pdfBuffer, signaturePngBase64, signerName, signedAt, signerIp }) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  pdfDoc.registerFontkit(fontkit); // IMPORTANT: înregistrează fontkit

  const fontBytes = await getFontBytes();
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });

  const page = pdfDoc.getPages().at(-1);

  const pngBase64 = String(signaturePngBase64 || "").replace(/^data:image\/png;base64,/, "");
  const pngBytes = Buffer.from(pngBase64, "base64");
  const img = await pdfDoc.embedPng(pngBytes);
  const { width: iw, height: ih } = img;
  const maxW = 220;
  const sc = Math.min(1, maxW / iw);

  // în zona „VÂNZĂTOR”
  page.drawImage(img, { x: 50, y: 160, width: iw * sc, height: ih * sc });

  const meta = `Semnat de ${signerName} la ${new Date(signedAt).toLocaleString()} (IP: ${signerIp || "-"})`;
  page.drawText(meta, { x: 50, y: 140, size: 10, font, color: rgb(0.25, 0.25, 0.25) });

  const out = await pdfDoc.save();
  return Buffer.from(out);
}
