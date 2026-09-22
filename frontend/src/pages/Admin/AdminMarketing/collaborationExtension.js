// Logică PURĂ pentru modalul "Prelungește colaborarea" (Admin -> Influenceri).
//
// IMPORTANT: acest fișier calculează STRICT o previzualizare (ce dată ar
// rezulta din +1/+3/+6 luni, pornind de la collaborationEnd CURENT - vezi
// secțiunea 5 a cerinței, NU de la createdAt), pentru a o afișa admin-ului
// ÎNAINTE de confirmare (secțiunea 4). Nu calculează statusul colaborării,
// remunerația sau regula implicită de 3 luni - acelea rămân STRICT în
// backend (services/influencerCollaboration.js, computeCollaborationState),
// sursa unică. La confirmare, PATCH /api/admin/influencers/:id/collaboration
// trimite data aleasă ca text ISO; backend-ul validează și recalculează
// autoritar - rezultatul afișat după salvare vine mereu din răspunsul lui,
// niciodată din acest fișier.
//
// Rulare teste: node --test src/pages/Admin/AdminMarketing/collaborationExtension.test.js

export const EXTENSION_PRESETS = [
  { id: "1m", months: 1, label: "+1 lună" },
  { id: "3m", months: 3, label: "+3 luni" },
  { id: "6m", months: 6, label: "+6 luni" },
];

/*
 * Copie a addMonthsUtc din backend/src/services/influencerCollaboration.js
 * (aceeași aritmetică: UTC, ajustare la ultima zi a lunii țintă dacă ziua
 * originală nu există în ea) - STRICT pentru previzualizare. Backend-ul
 * recalculează și validează cu propriul helper la salvare.
 */
export function addMonthsUtc(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();

  const target = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + months,
      1,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds()
    )
  );

  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();

  target.setUTCDate(Math.min(day, daysInTargetMonth));

  return target;
}

/** Data propusă pentru un preset (+1/+3/+6 luni), de la end-ul CURENT. */
export function proposeExtensionDate(currentCollaborationEnd, months) {
  return addMonthsUtc(new Date(currentCollaborationEnd), months);
}

/** yyyy-mm-dd, pentru <input type="date">. */
export function toDateInputValue(date) {
  if (!date) return "";

  const d = new Date(date);

  if (Number.isNaN(d.getTime())) return "";

  return d.toISOString().slice(0, 10);
}

/** Corpul cererii PATCH /api/admin/influencers/:id/collaboration. */
export function buildExtensionPayload(date) {
  return { collaborationEnd: new Date(date).toISOString() };
}

/**
 * Verificare RAPIDĂ, doar pentru un mesaj inline mai prietenos înainte de a
 * trimite cererea - backend-ul e sursa reală de adevăr și validează din nou
 * exact aceleași reguli (services/influencerCollaboration.js,
 * validateCollaborationExtension).
 */
export function previewValidationError(date, currentCollaborationEnd) {
  const parsed = new Date(date);

  if (!date || Number.isNaN(parsed.getTime())) {
    return "Alege o dată validă.";
  }

  if (currentCollaborationEnd && parsed.getTime() <= new Date(currentCollaborationEnd).getTime()) {
    return "Noua dată trebuie să fie ulterioară perioadei curente de colaborare.";
  }

  return null;
}

export function formatExtensionDate(date) {
  if (!date) return "—";

  try {
    return new Date(date).toLocaleDateString("ro-RO", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}
