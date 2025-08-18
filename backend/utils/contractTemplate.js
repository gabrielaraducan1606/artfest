// backend/utils/contractTemplate.js
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, rgb } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ASSETS = path.join(ROOT, "assets");
const FONTS_DIR = path.join(ASSETS, "fonts");
const DEFAULT_FONT = path.join(FONTS_DIR, "DejaVuSans.ttf"); // pune aici fontul tău

function safe(v, fallback = "—") {
  if (v === 0) return "0";
  return v ? String(v) : fallback;
}

function wrapText(font, text, size, maxWidth) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    const width = font.widthOfTextAtSize(test, size);
    if (width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawSectionTitle(page, font, title, x, y) {
  page.drawText(title, { x, y, size: 14, font, color: rgb(0, 0, 0) });
  page.drawLine({ start: { x, y: y - 4 }, end: { x: x + 495, y: y - 4 }, thickness: 0.7, color: rgb(0.3, 0.3, 0.3) });
}

function drawLabelValue(page, font, label, value, x, y, size = 11, w = 495) {
  const labelW = font.widthOfTextAtSize(label, size);
  page.drawText(label, { x, y, size, font, color: rgb(0.2, 0.2, 0.2) });
  const textX = x + Math.min(labelW + 6, 180);
  const maxW = w - (textX - x);
  const lines = wrapText(font, value, size, maxW);
  lines.forEach((ln, i) => {
    page.drawText(ln, { x: textX, y: y - i * (size + 4), size, font, color: rgb(0, 0, 0) });
  });
  return y - (lines.length - 1) * (size + 4);
}

/**
 * Construieste un draft de contract din datele Step1 + Step2.
 * returnează Buffer PDF.
 */
export async function buildContractDraftPDF({ sellerId, step1 = {}, step2 = {}, number }) {
  if (!fsSync.existsSync(DEFAULT_FONT)) {
    throw new Error(`Lipsește fontul TTF: ${DEFAULT_FONT}. Creează backend/assets/fonts/DejaVuSans.ttf`);
  }

  const pdfDoc = await PDFDocument.create();
  const fontBytes = await fs.readFile(DEFAULT_FONT);
  const font = await pdfDoc.embedFont(fontBytes);

  // A4
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const margin = 50;
  let cursor = height - margin;

  // Header
  page.drawText("Contract de colaborare", { x: margin, y: cursor, size: 22, font, color: rgb(0, 0, 0) });
  cursor -= 26;
  page.drawText(`Nr. ${number} / SellerID: ${sellerId}`, { x: margin, y: cursor, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
  cursor -= 20;

  // Părțile contractante
  drawSectionTitle(page, font, "I. Părțile", margin, cursor);
  cursor -= 20;

  cursor = drawLabelValue(page, font, "Vânzător:", safe(step1.shopName || step2.companyName), margin, cursor);
  cursor -= 16;

  cursor = drawLabelValue(page, font, "CUI:", safe(step2.cui), margin, cursor);
  cursor -= 14;

  const addr = [step2.address, step2.city, step2.country].filter(Boolean).join(", ");
  cursor = drawLabelValue(page, font, "Adresă:", safe(addr), margin, cursor);
  cursor -= 14;

  cursor = drawLabelValue(page, font, "IBAN:", safe(step2.iban), margin, cursor);
  cursor -= 14;

  const contact = [step1.publicEmail || step2.emailFinance, step1.phone || step2.phone].filter(Boolean).join(" | ");
  cursor = drawLabelValue(page, font, "Contact:", safe(contact), margin, cursor);
  cursor -= 16;

  const categoryMap = {
    "bijuterii-accesorii": "Bijuterii și accesorii",
    "articole-evenimente": "Articole pentru evenimente",
    "moda-handmade": "Modă handmade",
    "decoratiuni-interioare": "Decorațiuni interioare",
    "papetarie-cadouri": "Papetărie și cadouri",
    "produse-copii": "Produse pentru copii",
    "cosmetice-naturale": "Produse cosmetice naturale",
    "cadouri-personalizate": "Cadouri personalizate",
    "altele": "Altele",
  };
  cursor = drawLabelValue(page, font, "Categorie:", safe(categoryMap[step1.category] || step1.category), margin, cursor);
  cursor -= 20;

  // Obiectul & prevederi esențiale (demo)
  drawSectionTitle(page, font, "II. Obiectul", margin, cursor);
  cursor -= 18;
  const obiect =
    "Prezentul contract reglementează colaborarea dintre Platformă și Vânzător pentru listarea, promovarea și vânzarea online a produselor handmade prin intermediul marketplace-ului.";
  wrapText(font, obiect, 11, width - margin * 2).forEach((ln) => {
    page.drawText(ln, { x: margin, y: cursor, size: 11, font, color: rgb(0, 0, 0) });
    cursor -= 15;
  });
  cursor -= 6;

  drawSectionTitle(page, font, "III. Termene și condiții sintetice", margin, cursor);
  cursor -= 18;
  const bullets = [
    "Vânzătorul este responsabil de conformitatea și originalitatea produselor listate.",
    "Plățile către Vânzător se efectuează în contul IBAN indicat, conform politicilor de decont.",
    "Taxele de abonament selectate: " + safe(step2.subscriptionPlan?.toUpperCase(), "—"),
    "Politici de livrare/retur comunicate public pe pagina Vânzătorului.",
  ];
  bullets.forEach((b) => {
    const lines = wrapText(font, "• " + b, 11, width - margin * 2);
    lines.forEach((ln) => {
      page.drawText(ln, { x: margin, y: cursor, size: 11, font, color: rgb(0, 0, 0) });
      cursor -= 15;
    });
    cursor -= 4;
  });

  // Semnături
  cursor -= 10;
  drawSectionTitle(page, font, "IV. Semnături", margin, cursor);
  cursor -= 60;

  page.drawText("VÂNZĂTOR", { x: margin, y: cursor + 40, size: 11, font });
  page.drawLine({ start: { x: margin, y: cursor }, end: { x: margin + 220, y: cursor }, thickness: 0.7 });

  page.drawText("PLATFORMĂ", { x: margin + 275, y: cursor + 40, size: 11, font });
  page.drawLine({ start: { x: margin + 275, y: cursor }, end: { x: margin + 495, y: cursor }, thickness: 0.7 });

  // Notă
  cursor -= 40;
  const nota =
    "Acest document este generat electronic pe baza datelor furnizate la onboarding (Pasul 1 și Pasul 2). Versiunea semnată va include data/ora și adresa IP.";
  wrapText(font, nota, 9.5, width - margin * 2).forEach((ln) => {
    page.drawText(ln, { x: margin, y: cursor, size: 9.5, font, color: rgb(0.2, 0.2, 0.2) });
    cursor -= 13;
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Adaugă semnătura vânzătorului pe PDF-ul existent + timestamp + IP.
 * returnează Buffer PDF.
 */
export async function signContractPDF({ pdfBuffer, signaturePngBase64, signerName, signedAt, signerIp }) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();
  const page = pages[pages.length - 1];

  // font
  const fontBytes = await fs.readFile(DEFAULT_FONT);
  const font = await pdfDoc.embedFont(fontBytes);

  // semnătura
  const pngBytes = Buffer.from(signaturePngBase64.replace(/^data:image\/png;base64,/, ""), "base64");
  const png = await pdfDoc.embedPng(pngBytes);
  const { width: imgW, height: imgH } = png.scale(1);

  // poziționare în zona „VÂNZĂTOR”
  const x = 50;
  const y = 160;
  const maxW = 220;
  const scale = Math.min(1, maxW / imgW);
  page.drawImage(png, { x, y, width: imgW * scale, height: imgH * scale });

  // metadate
  const meta = `Semnat de ${signerName} la ${new Date(signedAt).toLocaleString()} (IP: ${signerIp || "-"})`;
  page.drawText(meta, { x: 50, y: 140, size: 10, font, color: rgb(0.2, 0.2, 0.2) });

  const out = await pdfDoc.save();
  return Buffer.from(out);
}
