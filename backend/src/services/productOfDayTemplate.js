// backend/src/services/productOfDayTemplate.js
//
// Compositorul determinist pentru materialul "Produsul zilei" - portat
// exact din prototipul local v2 aprobat (fonturi, layout, coordonate).
// AI-ul (apelat separat, în rută) generează DOAR fundalul/decorul; acest
// modul adaugă determinist logo-ul real, titlul, prețul și CTA-ul, ca
// textele/prețurile să fie 100% corecte și identice ca structură în
// fiecare zi.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FONTS_DIR = path.join(__dirname, "..", "assets", "fonts");
const LOGO_PATH = path.join(
  __dirname,
  "..",
  "..",
  "public",
  "assets",
  "LogoArtfest.png"
);

export const CANVAS_WIDTH = 1080;
export const CANVAS_HEIGHT = 1350;

const VISUAL_X = 460;
const VISUAL_WIDTH = CANVAS_WIDTH - VISUAL_X;

const LOGO_WIDTH = 190;
const LOGO_HEIGHT = Math.round((375 / 1024) * LOGO_WIDTH);

const VIOLET_DARK = "#4c1d95";
const VIOLET = "#7c3aed";
const VIOLET_SOFT = "#a78bfa";
const TEXT_MUTED = "#6b7280";

const roMoney = new Intl.NumberFormat("ro-RO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text, { maxWidth, avgCharWidth, maxLines }) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  const maxChars = Math.max(4, Math.floor(maxWidth / avgCharWidth));

  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
    if (lines.length === maxLines - 1 && candidate.length > maxChars) {
      break;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  const consumed = lines.join(" ").length;
  if (consumed < text.trim().length && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] =
      last.length > 1 ? `${last.replace(/[,.;:]+$/, "")}…` : `${last}…`;
  }

  return lines;
}

function fontFace(family, weight, fileName) {
  const base64 = fs
    .readFileSync(path.join(FONTS_DIR, fileName))
    .toString("base64");

  return `@font-face { font-family: '${family}'; font-weight: ${weight}; src: url(data:font/woff;base64,${base64}) format('woff'); }`;
}

const FONTS_CSS = [
  fontFace("Playfair Display", 700, "PlayfairDisplay-Bold.woff"),
  fontFace("Dancing Script", 700, "DancingScript-Bold.woff"),
  fontFace("Lora", 400, "Lora-Regular.woff"),
  fontFace("Lora", 600, "Lora-SemiBold.woff"),
  fontFace("Lora", 700, "Lora-Bold.woff"),
].join("\n");

const LOGO_BASE64 = fs.readFileSync(LOGO_PATH).toString("base64");

/*
 * Accent decorativ discret (fără text) - aceeași formă organică lila
 * din prototipul v2, poziționată în zona liberă dintre preț și CTA.
 */
const DECORATIVE_ACCENT_SVG = `
  <g opacity="0.55">
    <ellipse cx="150" cy="1010" rx="70" ry="46" fill="${VIOLET_SOFT}" opacity="0.18" transform="rotate(-18 150 1010)" />
    <ellipse cx="210" cy="1040" rx="55" ry="36" fill="${VIOLET_SOFT}" opacity="0.15" transform="rotate(12 210 1040)" />
    <ellipse cx="120" cy="1070" rx="46" ry="30" fill="${VIOLET}" opacity="0.12" transform="rotate(-6 120 1070)" />
    <circle cx="205" cy="985" r="5" fill="${VIOLET}" opacity="0.35" />
  </g>
`;

/**
 * Compune imaginea finală 1080x1350 pentru "Produsul zilei".
 *
 * @param {Buffer} aiImageBuffer - imaginea generată de AI (doar fundal/
 *   decor/produs, FĂRĂ text) - vezi buildProductOfDayBackgroundPrompt().
 * @param {string} title - Product.title (real, din DB).
 * @param {string} vendorName - nume magazin/vendor (real, din DB).
 * @param {object} pricing - rezultatul calculateProductPromotionPricing()
 *   (originalPrice, finalPrice, hasDiscount, totalDiscountPercent) -
 *   NU se recalculează nimic aici, doar se afișează.
 * @param {boolean} isQuoteOnly - true pentru produse QUOTE_ONLY.
 * @returns {Promise<Buffer>} PNG final, 1080x1350.
 */
export async function composeProductOfDayImage({
  aiImageBuffer,
  title,
  vendorName,
  pricing,
  isQuoteOnly,
}) {
  const visualBuffer = await sharp(aiImageBuffer)
    .resize({
      width: VISUAL_WIDTH,
      height: CANVAS_HEIGHT,
      fit: "cover",
      position: sharp.strategy.attention,
    })
    .toBuffer();

  const baseBuffer = await sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: { r: 250, g: 246, b: 251, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const titleLines = wrapText(title, {
    maxWidth: 356,
    avgCharWidth: 20,
    maxLines: 2,
  });

  const priceBlockSvg = isQuoteOnly
    ? `<text x="64" y="800" font-family="Lora" font-weight="600" font-size="34" fill="${VIOLET_DARK}">Cere ofertă pe Artfest</text>`
    : `
      ${
        pricing.hasDiscount
          ? `<text x="64" y="740" font-family="Lora" font-weight="400" font-size="26" fill="${TEXT_MUTED}" text-decoration="line-through">${esc(
              roMoney.format(pricing.originalPrice)
            )} RON</text>`
          : ""
      }
      <text x="64" y="800" font-family="Lora" font-weight="700" font-size="54" fill="${VIOLET_DARK}">${esc(
        roMoney.format(pricing.finalPrice)
      )} RON</text>
      ${
        pricing.hasDiscount
          ? `<g><rect x="310" y="712" width="92" height="40" rx="20" fill="${VIOLET}" /><text x="356" y="738" font-family="Lora" font-weight="700" font-size="20" fill="#ffffff" text-anchor="middle">-${pricing.totalDiscountPercent}%</text></g>`
          : ""
      }
    `;

  const svg = `
<svg width="${CANVAS_WIDTH}" height="${CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs><style>${FONTS_CSS}</style></defs>

  <image x="64" y="56" width="${LOGO_WIDTH}" height="${LOGO_HEIGHT}" href="data:image/png;base64,${LOGO_BASE64}" />

  <text x="64" y="260" font-family="Playfair Display" font-weight="700" font-size="84" fill="${VIOLET_DARK}">Produsul</text>
  <text x="80" y="382" font-family="Dancing Script" font-weight="700" font-size="140" fill="${VIOLET_SOFT}">zilei</text>

  ${titleLines
    .map(
      (line, i) =>
        `<text x="64" y="${470 + i * 46}" font-family="Lora" font-weight="700" font-size="38" fill="${VIOLET_DARK}">${esc(
          line
        )}</text>`
    )
    .join("\n")}

  <line x1="64" y1="${470 + titleLines.length * 46 + 20}" x2="380" y2="${
    470 + titleLines.length * 46 + 20
  }" stroke="${VIOLET_SOFT}" stroke-width="1.5" />

  <text x="64" y="${470 + titleLines.length * 46 + 66}" font-family="Lora" font-weight="600" font-size="24" fill="${VIOLET}">${esc(
    vendorName
  )}</text>

  ${priceBlockSvg}

  ${DECORATIVE_ACCENT_SVG}

  <text x="64" y="1270" font-family="Lora" font-weight="400" font-size="26" fill="${TEXT_MUTED}">Disponibil pe</text>
  <text x="64" y="1312" font-family="Playfair Display" font-weight="700" font-size="34" fill="${VIOLET}">Artfest</text>
</svg>
`;

  const overlayBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

  return sharp(baseBuffer)
    .composite([
      { input: visualBuffer, left: VISUAL_X, top: 0 },
      { input: overlayBuffer, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

/**
 * Promptul pentru AI - generează STRICT fundal/decor/atmosferă/lumină/
 * compoziție în jurul produsului (LOCKED). Nu trebuie să deseneze text,
 * logo, preț sau CTA - toate acestea sunt adăugate determinist mai sus.
 */
export function buildProductOfDayBackgroundPrompt() {
  return `
You are creating the RIGHT-SIDE VISUAL PANEL for a premium vertical
(portrait) social media promotional poster for an online handmade
marketplace called Artfest.

PRODUCT PRESERVATION IS THE HIGHEST PRIORITY.
The product itself is LOCKED and must remain visually identical to the
original photo: same shape, same proportions, same colors, same material,
same details. Do not redesign, regenerate, reinterpret, or add/remove parts
of the product. Treat the product as READ ONLY. You may modify ONLY the
background, lighting, composition and decorative elements AROUND it.

COLOR PALETTE - THIS IS A HARD REQUIREMENT, NOT A SUGGESTION:
- the background and decorative elements MUST be dominated by: white,
  very light cream, soft lilac and light violet/purple (the Artfest brand
  identity color is a modern violet, similar to #8B5CF6 / #A78BFA)
- lilac/violet must be CLEARLY VISIBLE somewhere in the frame (a soft
  violet fabric, a lilac flower accent, a pale purple gradient in the
  light, or similar) - the image must read as "Artfest violet/lilac
  branded", not as a neutral generic beige mood board
- a touch of natural cream/beige is acceptable ONLY as a minor supporting
  tone, never as the dominant color

STRICTLY FORBIDDEN:
- beige or brown as the dominant/main color of the scene
- dried pampas grass / dried wheat / straw-colored dried flowers
- strong earthy/terracotta/rust tones
- a dark or black background
- neon or saturated candy colors
- any text, letters, numbers, prices, logos or watermarks

COMPOSITION:
- portrait orientation
- the product stays clearly recognizable, centered in the right two-thirds
  of the frame, in focus, well lit
- premium, elegant, handmade-marketplace aesthetic, airy and soft
- clean, uncluttered, a few tasteful floral/organic accents in soft
  lilac/violet or white tones

Style: realistic, premium studio photography, soft natural light, tasteful.
`.trim();
}
