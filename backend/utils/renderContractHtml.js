// backend/utils/renderContractHtml.js
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TEMPLATE_PATH = path.join(ROOT, "templates", "contract.ro.html");

// Helpers sigure (escape implicit)
Handlebars.registerHelper("formatDate", (iso, fmt = "DD.MM.YYYY") => {
  if (!iso) return "";
  const d = new Date(iso);
  const z = (n) => String(n).padStart(2, "0");
  const DD = z(d.getDate()), MM = z(d.getMonth() + 1), YYYY = d.getFullYear();
  const HH = z(d.getHours()), mm = z(d.getMinutes());
  return fmt.includes("HH") ? `${DD}.${MM}.${YYYY} ${HH}:${mm}` : `${DD}.${MM}.${YYYY}`;
});
Handlebars.registerHelper("ifNot", function (v, options) {
  return !v ? options.fn(this) : options.inverse(this);
});

let COMPILED;

export async function renderContractHtml(data) {
  if (!COMPILED) {
    const src = await fs.readFile(TEMPLATE_PATH, "utf8");
    COMPILED = Handlebars.compile(src);
  }

  // Font absolut (Windows friendly)
  const fontPath = path.join(ROOT, "assets", "fonts", "DejaVuSans.ttf").replace(/\\/g, "/");
  const fontFileUrl = `file:///${fontPath.replace(/^\/+/, "")}`;

  // mic clamp anti „romane”
  const clamp = (s, n = 4000) => (typeof s === "string" && s.length > n ? s.slice(0, n) + "…" : s);
  const safeData = JSON.parse(JSON.stringify(data, (k, v) => (typeof v === "string" ? clamp(v) : v)));

  return COMPILED({ ...safeData, now: data?.now || new Date().toISOString(), fontFileUrl });
}

export default renderContractHtml;
