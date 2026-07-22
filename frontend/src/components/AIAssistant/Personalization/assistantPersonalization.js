// src/components/AiAssistant/personalization/assistantPersonalization.js

import {
  MagicIcon,
  PersonalizationIcon,
} from "./PersonalizationIcons.jsx";

/* =========================================================
   Acțiuni disponibile momentan
========================================================= */

export const PERSONALIZATION_ACTIONS = [
  {
    id: "my-quotes",
    title: "Cererile mele",
    description:
      "Vezi cererile trimise, conversațiile cu vânzătorii și ofertele primite.",
    icon: PersonalizationIcon,
  },

  /*
   * DEZACTIVAT TEMPORAR
   *
   * {
   *   id: "quote-from-product",
   *   title: "Pornesc de la un produs",
   *   description:
   *     "Solicită o ofertă pentru un produs existent și completează informațiile cerute de vânzător.",
   *   icon: PersonalizationIcon,
   * },
   */

  /*
   * DEZACTIVAT TEMPORAR
   *
   * {
   *   id: "custom-quote",
   *   title: "Am o idee personalizată",
   *   description:
   *     "Descrie ce îți dorești și pregătește o cerere personalizată.",
   *   icon: MagicIcon,
   * },
   */
];

/* =========================================================
   Pornire flow personalizare
========================================================= */

export function startPersonalizationFlow({
  actionId,
  addConversation,
}) {
  switch (actionId) {
    case "quote-from-product":
      addConversation(
        "Vreau să cer o ofertă pentru un produs.",
        "Sigur. Te ajut să pregătești cererea pas cu pas. Vom completa cantitatea și informațiile solicitate de vânzător, apoi cererea va fi înregistrată și trimisă prin platformă."
      );

      return true;

    case "custom-quote":
      addConversation(
        "Vreau o ofertă pentru o cerere personalizată.",
        "Sigur. Te ajut să pregătești cererea pas cu pas. Poți descrie ce îți dorești, iar discuția, oferta și orice comandă rezultată vor fi gestionate prin platformă."
      );

      return true;

    case "my-quotes":
      addConversation(
        "Vreau să văd cererile mele de ofertă.",
        "Aici poți urmări cererile trimise, conversațiile cu vânzătorii, ofertele primite și comenzile rezultate."
      );

      return true;

    default:
      return false;
  }
}

/* =========================================================
   Alegeri
========================================================= */

export function handlePersonalizationChoice() {
  return false;
}

/* =========================================================
   Răspunsuri temporare
========================================================= */

export function getPersonalizationTemporaryResponse(
  activeFlow
) {
  switch (activeFlow) {
    case "quote-from-product":
      return "Am înregistrat răspunsul. Continuăm cu următoarea informație necesară pentru cererea de ofertă.";

    case "custom-quote":
      return "Am înregistrat detaliul. Continuăm să completăm cererea.";

    case "my-quotes":
      return "Încarc cererile tale de ofertă.";

    default:
      return null;
  }
}

/* =========================================================
   Răspuns upload imagine
========================================================= */

export function getPersonalizationImageUploadResponse(
  activeFlow
) {
  switch (activeFlow) {
    case "quote-from-product":
      return "Am primit imaginea. Va fi verificată înainte de a fi atașată cererii.";

    case "custom-quote":
      return "Am primit imaginea de inspirație. Va fi verificată înainte de a fi atașată cererii.";

    default:
      return null;
  }
}

/* =========================================================
   Placeholder input
========================================================= */

export function getPersonalizationInputPlaceholder(
  activeFlow
) {
  switch (activeFlow) {
    case "quote-from-product":
      return "Scrie răspunsul tău...";

    case "custom-quote":
      return "Descrie cererea ta...";

    case "my-quotes":
      return "Caută o cerere...";

    default:
      return null;
  }
}
