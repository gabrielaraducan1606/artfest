// client/src/components/utils/imageFallback.js

// 1) Escapare sigură pentru textul din SVG (evită probleme cu & < > " ')
const escapeXml = (s = "") =>
  String(s).replace(/[<>&'"]/g, (c) => (
    { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" }[c]
  ));

// 2) Placeholder dreptunghi (pentru produse, cover etc.)
function svgRectPlaceholder(
  w,
  h,
  text = "",
  {
    bg = "#f3f4f6",
    fg = "#9ca3af",
    radius = 0, // colțuri rotunjite (0 = drept)
    fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    fontSize,
  } = {}
) {
  const label = text && String(text).trim() ? text : `${w}×${h}`;
  const fs = fontSize || Math.max(12, Math.round(Math.min(w, h) / 8));
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" rx="${radius}" ry="${radius}" fill="${bg}"/>
  <text x="50%" y="50%"
        dominant-baseline="middle"
        text-anchor="middle"
        font-family="${fontFamily}"
        font-size="${fs}"
        fill="${fg}">${escapeXml(label)}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// 3) Placeholder “avatar” rotund
function svgCirclePlaceholder(
  size = 160,
  text = "Profil",
  {
    bg = "#e5e7eb",
    fg = "#6b7280",
    fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    fontSize,
  } = {}
) {
  const w = size, h = size;
  const fs = fontSize || Math.max(12, Math.round(size / 8));
  // folosim <rect> cu rx/ry = jumătate pentru a fi perfect rotund în toate browserele
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect width="100%" height="100%" rx="${Math.floor(size/2)}" ry="${Math.floor(size/2)}" fill="${bg}"/>
  <text x="50%" y="50%"
        dominant-baseline="middle"
        text-anchor="middle"
        font-family="${fontFamily}"
        font-size="${fs}"
        fill="${fg}">${escapeXml(text)}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// 4) API simplu, compatibil cu ce foloseai deja
export const productPlaceholder = (w = 600, h = 450, text = "Produs") =>
  svgRectPlaceholder(w, h, text);

export const avatarPlaceholder = (size = 160, text = "Profil") =>
  svgCirclePlaceholder(size, text);

// 5) Fallback generic pentru <img onError=...>
export const onImgError = (e, w = 600, h = 450, text = "") => {
  // previne bucla infinită
  e.currentTarget.onerror = null;

  // dacă pare avatar (pătrat mic) dă placeholder rotund; altfel dreptunghi
  const isSquare = Number(w) === Number(h);
  const seemsAvatar = isSquare && Number(w) <= 256; // euristică
  e.currentTarget.src = seemsAvatar
    ? avatarPlaceholder(Math.max(w, h), text || "Profil")
    : productPlaceholder(w, h, text || "Imagine");
};
