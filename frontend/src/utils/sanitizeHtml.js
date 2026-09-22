// src/utils/sanitizeHtml.js
//
// Sanitizare HTML PURĂ (fără DOM, deci testabilă în Node și sigură și în
// browser), pentru câmpuri de text îmbogățit scrise de admin (ex.
// Collection.description) randate cu dangerouslySetInnerHTML.
//
// Abordare: NU "curățăm" HTML-ul primit, ci îl RECONSTRUIM din tokeni:
//  - se păstrează doar etichete dintr-o listă albă, FĂRĂ atribute (cu
//    excepția <a href>, validat pe listă albă de scheme);
//  - tot textul e escapat; orice `<` care nu formează o etichetă validă
//    devine `&lt;`;
//  - blocurile <script>/<style>/<iframe>/... sunt eliminate cu tot cu
//    conținut; comentariile la fel;
//  - etichetele sunt echilibrate (se închid la final cele rămase
//    deschise; închiderile fără pereche sunt ignorate).
// Nimic din input nu ajunge în output ca marcaj decât prin aceste reguli.

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "a",
  "h2",
  "h3",
  "h4",
  "blockquote",
]);

const VOID_TAGS = new Set(["br"]);

const DROP_WITH_CONTENT =
  "script|style|iframe|object|embed|noscript|template|svg|math|form|textarea|title";

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

// "&" care nu începe o entitate validă -> "&amp;"
const BARE_AMP_RE = /&(?!(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);)/g;

function escapeText(text) {
  return text
    .replace(BARE_AMP_RE, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Lista albă de destinații: http(s), mailto, tel, cale internă (/x, nu
// //host), ancoră (#x). Validarea se face pe textul BRUT al atributului;
// la ieșire `&` e escapat mereu, deci browserul vede exact ce am validat
// (nu poate decoda entități într-o schemă periculoasă).
function safeHref(rawTag) {
  const m = rawTag.match(/\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  if (!m) return null;

  const value = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  if (!value || value.length > 2000) return null;

  // caractere de control/spații interne ("java\nscript:") => respins
  // eslint-disable-next-line no-control-regex -- intenționat: respingem caracterele de control
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return null;

  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value;
  if (/^\/(?!\/)/.test(value)) return value;
  if (/^#/.test(value)) return value;

  return null;
}

export function sanitizeHtml(input) {
  let html = String(input ?? "");
  if (!html) return "";

  html = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      new RegExp(`<(${DROP_WITH_CONTENT})\\b[\\s\\S]*?<\\/\\1\\s*>`, "gi"),
      ""
    )
    // etichete de acest tip rămase neînchise
    .replace(new RegExp(`<\\/?(${DROP_WITH_CONTENT})\\b[^>]*>`, "gi"), "");

  let out = "";
  let last = 0;
  const stack = [];

  for (const match of html.matchAll(TAG_RE)) {
    out += escapeText(html.slice(last, match.index));
    last = match.index + match[0].length;

    const closing = match[1] === "/";
    const name = match[2].toLowerCase();

    if (!ALLOWED_TAGS.has(name)) continue; // eticheta dispare, textul rămâne

    if (closing) {
      if (VOID_TAGS.has(name)) continue;
      const at = stack.lastIndexOf(name);
      if (at === -1) continue; // închidere fără pereche

      while (stack.length > at) {
        out += `</${stack.pop()}>`;
      }
      continue;
    }

    if (VOID_TAGS.has(name)) {
      out += `<${name}>`;
      continue;
    }

    if (name === "a") {
      const href = safeHref(match[0]);
      out += href
        ? `<a href="${escapeAttr(href)}" rel="noopener noreferrer">`
        : "<a>";
    } else {
      out += `<${name}>`;
    }

    stack.push(name);
  }

  out += escapeText(html.slice(last));

  while (stack.length) {
    out += `</${stack.pop()}>`;
  }

  return out;
}

const ENTITIES = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

/** Text simplu dintr-un fragment HTML (pentru intro, comparații, lungime). */
export function htmlToText(input) {
  return String(input ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      new RegExp(`<(${DROP_WITH_CONTENT})\\b[\\s\\S]*?<\\/\\1\\s*>`, "gi"),
      " "
    )
    .replace(/<\/?(p|br|li|h[1-6]|div|blockquote|ul|ol)\b[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, " ")
    .trim();
}
