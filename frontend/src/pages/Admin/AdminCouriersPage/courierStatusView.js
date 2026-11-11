// src/pages/Admin/AdminCouriersPage/courierStatusView.js
//
// Textele și culorile paginii Admin „Curieri” (fără React). Datele vin din
// /api/admin/couriers - deja filtrate pe server (fără credentiale / token).

export const STATUS_VIEW = Object.freeze({
  CONNECTED: { label: "Conectat", tone: "ok" },
  NOT_CONNECTED: { label: "Neconectat", tone: "off" },
  INCOMPLETE: { label: "Configurare incompletă", tone: "warn" },
  AUTH_ERROR: { label: "Eroare autentificare", tone: "error" },
  UNAVAILABLE: { label: "Indisponibil temporar", tone: "warn" },
  UNTESTED: { label: "Netestat", tone: "off" },
});

export function statusView(status) {
  return STATUS_VIEW[status] || STATUS_VIEW.UNTESTED;
}

export function environmentLabel(env) {
  if (env === "production") return "Production";
  if (env === "demo") return "Demo";
  return "Nesetat";
}

/** A. credentialele API din env; B. contul PLATFORM; C. conexiunea reală. */
export function layers(courier) {
  const cred = courier?.credentials || {};
  const last = courier?.lastCheck || null;
  const platform = {
    configured: "configurat",
    missing: "neconfigurat",
    invalid_credentials: "credentiale respinse anterior",
    inactive: "dezactivat",
  }[cred.platformAccount] || "necunoscut";
  return [
    { key: "env", label: "Credentiale API (server)", value: cred.env === "available" ? "disponibile" : "lipsă", tone: cred.env === "available" ? "ok" : "off" },
    { key: "platform", label: "Cont PLATFORM (bază de date)", value: platform, tone: cred.platformAccount === "configured" ? "ok" : cred.platformAccount === "missing" ? "off" : "warn" },
    {
      key: "connection",
      label: "Conexiune Sameday",
      value: last ? statusView(last.status).label.toLowerCase() : "netestată",
      tone: last ? statusView(last.status).tone : "off",
    },
  ];
}

export function testedWithLabel(testedWith) {
  if (testedWith === "platform_account") return "cu contul PLATFORM";
  if (testedWith === "server_env") return "cu credentialele din server (contul PLATFORM lipsește)";
  return null;
}

export const SERVICE_ROWS = Object.freeze([
  ["HOME", "Livrare la adresă (24H)"],
  ["LOCKER", "Easybox (Locker NextDay)"],
  ["PUDO", "Sameday Point (PUDO NextDay)"],
]);

/** „31 oct. 2026, 21:45”; „Verificat acum” în primul minut. */
export function formatCheckedAt(iso, now = Date.now()) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  if (now - t >= 0 && now - t < 60_000) return "Verificat acum";
  return new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
}
