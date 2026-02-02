// frontend/src/pages/Vendor/Orders/utils/format.js

export function formatMoney(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
  }).format(v);
}

export function formatDate(d) {
  try {
    const dt = new Date(d);
    return new Intl.DateTimeFormat("ro-RO", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(dt);
  } catch {
    return d || "";
  }
}

export function getLeadStatusLabel(st) {
  if (!st) return null;
  switch (st) {
    case "nou":
      return "Lead nou";
    case "in_discutii":
      return "În discuții";
    case "oferta_trimisa":
      return "Ofertă trimisă";
    case "rezervat":
      return "Rezervat";
    case "pierdut":
      return "Pierdut";
    default:
      return st;
  }
}
