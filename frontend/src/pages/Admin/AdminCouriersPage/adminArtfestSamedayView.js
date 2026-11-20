// src/pages/Admin/AdminCouriersPage/adminArtfestSamedayView.js
//
// Tariful simplu Artfest (Sameday prin Artfest, produse fără greutate): etichete și conversia
// sumei din bani în textul câmpului. Fără React (testabil cu node --test).

export const METHOD_LABELS = Object.freeze({ HOME: "Livrare la adresă", LOCKER: "Easybox", PUDO: "Sameday Point" });

/** 2490 -> „24,90”; null -> „” (neconfigurat, nu 0). */
export function amountToInput(cents) {
  if (cents === null || cents === undefined) return "";
  return (Number(cents) / 100).toFixed(2).replace(".", ",");
}
