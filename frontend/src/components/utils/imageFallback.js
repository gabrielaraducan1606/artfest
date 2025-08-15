// Tiny helpers to build lightweight, local SVG placeholders (data URI)
// — no external requests, great for production.

const svg = (w, h, label = "") => {
  const bg = "f3f4f6"; // neutral-100
  const fg = "9ca3af"; // neutral-400
  const txt = encodeURIComponent(label);
  const fontSize = Math.max(12, Math.round(Math.min(w, h) / 12));

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="100%" height="100%" fill="#${bg}"/>
    <g fill="#${fg}">
      <rect x="0" y="0" width="${w}" height="${h}" fill="none"/>
    </g>
    ${
      label
        ? `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
            font-family="Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
            font-size="${fontSize}" fill="#${fg}">${txt}</text>`
        : ""
    }
  </svg>`.trim();
};

const toDataUri = (markup) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`;

/** Generic placeholder */
export const placeholder = (w = 600, h = 450, label = "") =>
  toDataUri(svg(w, h, label));

/** Product placeholder (default 4:3) */
export const productPlaceholder = (w = 600, h = 450, label = "Produs") =>
  placeholder(w, h, label);

/** Square avatar/logo */
export const avatarPlaceholder = (size = 120, label = "") =>
  placeholder(size, size, label);

/** Tiny square (e.g. suggestion thumbnails) */
export const thumbPlaceholder = (size = 50, label = "") =>
  placeholder(size, size, label);

/** onError handler: swap to local placeholder once, avoid loops */
export const onImgError = (e, w = 600, h = 450, label = "Imagine") => {
  const el = e?.currentTarget;
  if (!el) return;
  el.onerror = null; // avoid infinite loop
  el.src = placeholder(w, h, label);
};
