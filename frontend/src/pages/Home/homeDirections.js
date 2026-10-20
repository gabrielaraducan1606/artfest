// src/pages/Home/homeDirections.js
//
// Scurtăturile din secțiunea „Două direcții” a homepage-ului.
//
// Destinațiile au fost verificate (2026-10-16) pe API-ul public: fiecare
// întoarce produse reale, fără fallback-ul generic
// (appliedFilters.fallback = "generic_after_zero_results"):
//  - categoriile exacte (?categorie=) - potrivire precisă, una per link;
//  - căutările (?q=) doar pentru cuvinte unice cu rezultate relevante.
// Căutările pe mai multe cuvinte („casă nouă”, „decor casă”) potrivesc
// fiecare cuvânt separat și aduc produse fără legătură, iar „crăciun” nu
// avea niciun produs - de aceea nu sunt aici. Orice scurtătură nouă se
// verifică la fel înainte de adăugare.

export const HANDMADE_SHORTCUTS = [
  { key: "bijuterii", label: "Bijuterii", to: "/produse?q=bijuterii" },
  { key: "lumanari", label: "Lumânări", to: "/produse?q=lumanari" },
  {
    key: "cadouri-cu-nume",
    label: "Cadouri cu nume",
    to: "/produse?categorie=cadouri_obiecte-cu-nume",
  },
  { key: "bebe", label: "Pentru bebeluși", to: "/produse?q=bebe" },
  { key: "profesori", label: "Cadouri pentru profesori", to: "/produse?q=profesor" },
];

export const EVENT_SHORTCUTS = [
  { key: "marturii-nunta", label: "Mărturii nuntă", to: "/produse?categorie=marturii_nunta" },
  {
    key: "invitatii-nunta",
    label: "Invitații nuntă",
    to: "/produse?categorie=papetarie_invitatii-nunta",
  },
  { key: "marturii-botez", label: "Mărturii botez", to: "/produse?categorie=marturii_botez" },
  {
    key: "invitatii-botez",
    label: "Invitații botez",
    to: "/produse?categorie=papetarie_invitatii-botez",
  },
  { key: "aniversare", label: "Aniversare", to: "/produse?q=aniversare" },
];
