// src/utils/gpsrHomeAddress.js
//
// Explicația adresei poștale GPSR din formularele creatorului (Smart Listing +
// ProductModal). Doar texte, fără rețea și fără date: nu completăm și nu copiem
// nicio adresă (domiciliu, facturare, ridicare, retur). Câmpul adresei și
// validările lui rămân neschimbate.

/** Vizibil sub câmp: scurt. */
export const GPSR_ADDRESS_SHORT_NOTE =
  "Va fi afișată public pe pagina produsului. Nu trebuie să fie neapărat adresa de domiciliu.";

export const GPSR_ADDRESS_WHY_LABEL = "De ce este necesară adresa?";

/** În secțiunea extensibilă „De ce este necesară adresa?”. */
export const GPSR_ADDRESS_WHY_TEXT = Object.freeze([
  "Conform art. 19 lit. (a) din Regulamentul (UE) 2023/988, trebuie să furnizezi o adresă poștală validă la care producătorul poate fi contactat.",
  "Nu este obligatoriu ca aceasta să fie adresa de domiciliu. Poți utiliza o altă adresă de contact, dacă ai dreptul să o folosești și aceasta îndeplinește cerințele legale.",
  "Adresa introdusă va fi afișată public pe pagina produsului. Nu introduce o adresă fictivă.",
]);

export const GPSR_NO_ADDRESS_LABEL = "Nu ai încă o adresă pe care o poți folosi?";

export const GPSR_NO_ADDRESS_EXPLANATION =
  "Nu introduce o adresă fictivă. Produsul nu poate fi publicat fără adresa poștală de contact a producătorului, dar îl poți păstra în ciornă privată și poți cere ajutor echipei Artfest.";
