// backend/src/lib/gpsrNoticeVersions.js
//
// Versiunile informării GPSR pentru creatori + textul declarației per produs.
// Sursă UNICĂ (importată și de frontend): textele sunt imuabile per versiune -
// o modificare = o versiune NOUĂ adăugată la începutul listei; versiunile
// vechi rămân aici pentru audit (Admin → Politici) și NU se editează.
// Fără dependențe Node (fără crypto): amprenta se calculează în
// lib/gpsrDeclaration.js, doar pe server.
//
// Două evidențe DIFERITE, care nu se confundă:
//   - informarea generală (acest text) = conținut informativ, versionat;
//   - declarația per produs (ProductGpsrDeclaration) = vânzătorul confirmă,
//     pentru UN produs, că a citit informarea în versiunea X și că datele
//     producătorului / de siguranță ale ACELUI produs sunt corecte.
//   Declarația generală de la primul produs (VendorProductDeclaration) și
//   politicile (VendorPolicy / VendorAcceptance) rămân separate și neatinse.

export const GPSR_REGULATION_URL = "https://eur-lex.europa.eu/legal-content/RO/TXT/?uri=CELEX:32023R0988";

export const GPSR_NOTICE_VERSIONS = Object.freeze([
  Object.freeze({
    id: "gpsr-notice-2026-11-12",
    publishedAt: "2026-11-12",
    title: "Siguranța produselor (GPSR)",
    summary:
      "Regulamentul (UE) 2023/988 privind siguranța generală a produselor (GPSR) se aplică produselor de consum vândute în UE, inclusiv celor lucrate manual. Ca producător sau vânzător, răspunzi pentru siguranța produsului și pentru informațiile afișate despre el.",
    points: Object.freeze([
      {
        key: "safe",
        title: "Produse sigure",
        text: "Poți introduce pe piață doar produse sigure în condiții normale sau previzibile de utilizare, inclusiv pentru copii, dacă produsul le poate ajunge.",
      },
      {
        key: "manufacturer",
        title: "Identificarea producătorului",
        text: "Pe pagina produsului apar denumirea producătorului (sau a mărcii înregistrate) și datele lui de contact. Dacă produsul e realizat de altcineva, se afișează producătorul real.",
      },
      {
        key: "contact",
        title: "Adresă poștală și contact electronic",
        text: "Unde GPSR se aplică, sunt obligatorii o adresă poștală la care producătorul poate fi contactat și o adresă electronică (de exemplu email). Ambele sunt publice.",
      },
      {
        key: "risk",
        title: "Evaluarea riscurilor și documentația tehnică",
        text: "Producătorul analizează riscurile produsului (materiale, piese mici, substanțe, flacără, electricitate etc.) și păstrează o documentație tehnică proporțională cu produsul.",
      },
      {
        key: "instructions",
        title: "Instrucțiuni și avertismente",
        text: "Instrucțiunile și avertismentele de siguranță se scriu clar, în limba română, atunci când sunt necesare pentru folosirea în siguranță.",
      },
      {
        key: "traceability",
        title: "Identificare și trasabilitate",
        text: "Produsul trebuie să poată fi identificat (de exemplu tip, lot, model sau o descriere și o fotografie clare), ca să poată fi urmărit dacă apare o problemă.",
      },
      {
        key: "risk-products",
        title: "Dacă un produs prezintă riscuri",
        text: "Iei măsuri corective (de exemplu oprirea vânzării, informarea clienților sau retragerea produsului) și, când este necesar, notifici autoritățile competente.",
      },
    ]),
    disclaimer:
      "Aceste informații te ajută să înțelegi obligațiile, dar nu reprezintă consultanță juridică, o certificare sau o garanție oferită de Artfest. Pentru situații concrete, consultă textul oficial sau un specialist.",
    confirmationText:
      "Confirm că am citit informațiile privind Regulamentul (UE) 2023/988, că datele furnizate despre producător și produs sunt corecte și că îmi asum responsabilitatea pentru respectarea cerințelor de siguranță aplicabile produsului.",
  }),
]);

export const CURRENT_GPSR_NOTICE = GPSR_NOTICE_VERSIONS[0];
export const CURRENT_GPSR_NOTICE_VERSION = CURRENT_GPSR_NOTICE.id;

export function getGpsrNoticeVersion(id) {
  return GPSR_NOTICE_VERSIONS.find((version) => version.id === id) || null;
}
