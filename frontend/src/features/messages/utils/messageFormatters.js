// frontend/src/features/messages/utils/messageFormatters.js
//
// ETAPA 3 (refactor comun Mesaje) - utilitare identice, duplicate cuvant cu
// cuvant intre UserMessages.jsx si Vendor/Mesaje/Messages.jsx inainte de
// acest refactor. Extrase aici ca sursa unica.

export function nowIso() {
  return new Date().toISOString();
}

// `threadId` e opțional (extensie aditivă) - ascultătorii existenți
// (UnreadMessagesProvider, messageThreadsCache) nu citesc `detail`, deci
// nu se schimbă nimic pentru ei. threadMessagesCache îl folosește ca să
// invalideze DOAR cache-ul threadului afectat, nu pe toate.
export function dispatchMessagesChanged(threadId) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("messages:changed", threadId ? { detail: { threadId } } : undefined)
    );
  }
}

export function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const diffDays = Math.floor((+today - +d) / 86400000);
  if (isToday)
    return d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" });
  if (diffDays < 7)
    return d.toLocaleDateString("ro-RO", {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return d.toLocaleDateString("ro-RO", { day: "2-digit", month: "short" });
}

export function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("ro-RO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function initialsOf(name = "U") {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function autoResize(el) {
  if (!el) return;
  el.style.height = "auto";
  const max = 80;
  el.style.height = Math.min(el.scrollHeight, max) + "px";
}

export function isImageMime(mime = "") {
  return String(mime || "").startsWith("image/");
}

// Unifica UserMessages.jsx#niceBytes si Messages.jsx#prettyBytes (acelasi
// algoritm; singura diferenta reala era afisarea pentru size === 0).
export function formatBytes(n) {
  if (!n && n !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const fixed = i === 0 ? 0 : v < 10 ? 1 : 0;
  return `${v.toFixed(fixed)} ${units[i]}`;
}
