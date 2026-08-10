// src/components/AIAssistant/Vendor/vendorFlows.js

import {
  VENDOR_ACTION_IDS,
} from "./vendorMenus.js";

/* =========================================================
   Flow-uri pentru produse
========================================================= */

export const VENDOR_PRODUCT_FLOWS = {
  ADD_PRODUCT:
    VENDOR_ACTION_IDS.ADD_PRODUCT,

  EDIT_PRODUCT:
    VENDOR_ACTION_IDS.EDIT_PRODUCT,

  PRICE_STOCK:
    VENDOR_ACTION_IDS.PRICE_STOCK,

  PRODUCT_HELP:
    VENDOR_ACTION_IDS.PRODUCT_HELP,
};

/* =========================================================
   Pornirea acțiunilor
========================================================= */

export async function startVendorFlow({
  actionId,
  addConversation,
  addMessage,
  createMessage,
  setActiveFlow,
}) {
  switch (actionId) {
    case VENDOR_PRODUCT_FLOWS.ADD_PRODUCT:
      setActiveFlow(
        VENDOR_PRODUCT_FLOWS.ADD_PRODUCT
      );

      addConversation(
        "Vreau să adaug un produs.",
        `Perfect. Încarcă una sau mai multe fotografii ale produsului.

După ce le încarci, asistentul te va ajuta să pregătești titlul, descrierea, prețul, disponibilitatea și modul de comandă.`,
        {
          type:
            "vendor-product-upload",

          choices: [
            "Încarcă fotografii",
          ],
        }
      );

      return true;

    case VENDOR_PRODUCT_FLOWS.EDIT_PRODUCT:
      setActiveFlow(
        VENDOR_PRODUCT_FLOWS.EDIT_PRODUCT
      );

      addConversation(
        "Vreau să editez un produs.",
        `Alege produsul pe care dorești să îl modifici.

În etapa următoare vom încărca aici lista produselor tale.`,
        {
          type:
            "choices",

          choices: [
            "Vezi produsele mele",
          ],
        }
      );

      return true;

    case VENDOR_PRODUCT_FLOWS.PRICE_STOCK:
      setActiveFlow(
        VENDOR_PRODUCT_FLOWS.PRICE_STOCK
      );

      addConversation(
        "Vreau să actualizez prețul sau stocul.",
        `Alege produsul, apoi spune ce dorești să modifici.

Vei putea schimba rapid prețul, stocul sau disponibilitatea.`,
        {
          type:
            "choices",

          choices: [
            "Alege un produs",
          ],
        }
      );

      return true;

    case VENDOR_PRODUCT_FLOWS.PRODUCT_HELP:
      setActiveFlow(
        VENDOR_PRODUCT_FLOWS.PRODUCT_HELP
      );

      addConversation(
        "Am nevoie de ajutor pentru un produs.",
        `Nicio problemă. Încarcă fotografiile produsului și spune-ne pe scurt ce vinzi.

AI-ul va pregăti un draft, iar echipa Artfest te poate ajuta să îl finalizezi.`,
        {
          type:
            "vendor-product-help-upload",

          choices: [
            "Încarcă fotografii",
          ],
        }
      );

      return true;

    default:
      break;
  }

  if (
    actionId ===
    VENDOR_ACTION_IDS.RECEIVED_QUOTES
  ) {
    setActiveFlow(
      VENDOR_ACTION_IDS.RECEIVED_QUOTES
    );

    addMessage(
      createMessage(
        "assistant",
        "Secțiunea pentru cererile primite va fi conectată la fluxul existent în etapa următoare."
      )
    );

    return true;
  }

  if (
    actionId ===
    VENDOR_ACTION_IDS.ORDERS
  ) {
    setActiveFlow(
      VENDOR_ACTION_IDS.ORDERS
    );

    addMessage(
      createMessage(
        "assistant",
        "Secțiunea pentru comenzile magazinului va fi conectată ulterior."
      )
    );

    return true;
  }

  if (
    actionId ===
    VENDOR_ACTION_IDS.STORE
  ) {
    setActiveFlow(
      VENDOR_ACTION_IDS.STORE
    );

    addMessage(
      createMessage(
        "assistant",
        "Administrarea profilului și a setărilor magazinului va fi conectată ulterior."
      )
    );

    return true;
  }

  if (
    actionId ===
    VENDOR_ACTION_IDS.SHOPPING
  ) {
    setActiveFlow(
      VENDOR_ACTION_IDS.SHOPPING
    );

    addMessage(
      createMessage(
        "assistant",
        "Căutarea produselor din marketplace va fi conectată la asistentul existent."
      )
    );

    return true;
  }

  if (
    actionId ===
    VENDOR_ACTION_IDS.SUPPORT
  ) {
    setActiveFlow(
      VENDOR_ACTION_IDS.SUPPORT
    );

    addMessage(
      createMessage(
        "assistant",
        "Ajutorul și suportul vor fi conectate la sistemul actual de tichete."
      )
    );

    return true;
  }

  return false;
}

/* =========================================================
   Alegeri din conversație
========================================================= */

export async function handleVendorChoice({
  activeFlow,
  choice,
  addMessage,
  createMessage,
}) {
  if (
    activeFlow ===
      VENDOR_PRODUCT_FLOWS.ADD_PRODUCT &&
    choice ===
      "Încarcă fotografii"
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Folosește butonul cu agrafă pentru a încărca fotografiile produsului."
      )
    );

    return {
      handled: true,
      shouldOpenUpload: true,
    };
  }

  if (
    activeFlow ===
      VENDOR_PRODUCT_FLOWS.PRODUCT_HELP &&
    choice ===
      "Încarcă fotografii"
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Folosește butonul cu agrafă și încarcă fotografiile pe care vrei să le trimiți echipei Artfest."
      )
    );

    return {
      handled: true,
      shouldOpenUpload: true,
    };
  }

  if (
    activeFlow ===
      VENDOR_PRODUCT_FLOWS.EDIT_PRODUCT &&
    choice ===
      "Vezi produsele mele"
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Lista produselor tale va fi conectată în etapa următoare."
      )
    );

    return {
      handled: true,
      shouldOpenUpload: false,
    };
  }

  if (
    activeFlow ===
      VENDOR_PRODUCT_FLOWS.PRICE_STOCK &&
    choice ===
      "Alege un produs"
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Selectorul de produse va fi conectat în etapa următoare."
      )
    );

    return {
      handled: true,
      shouldOpenUpload: false,
    };
  }

  return {
    handled: false,
    shouldOpenUpload: false,
  };
}

/* =========================================================
   Mesaje text
========================================================= */

export async function submitVendorMessage({
  activeFlow,
  value,
  addMessage,
  createMessage,
}) {
  const text =
    String(value || "").trim();

  if (!text) {
    return false;
  }

  if (
    activeFlow ===
    VENDOR_PRODUCT_FLOWS.ADD_PRODUCT
  ) {
    addMessage(
      createMessage(
        "assistant",
        `Am notat explicația ta:

„${text}”

După conectarea analizei AI, voi folosi acest text împreună cu fotografiile pentru a pregăti produsul.`
      )
    );

    return true;
  }

  if (
    activeFlow ===
    VENDOR_PRODUCT_FLOWS.EDIT_PRODUCT
  ) {
    addMessage(
      createMessage(
        "assistant",
        `Am notat modificarea dorită:

„${text}”

După conectarea produselor tale, vei putea aplica această modificare direct produsului selectat.`
      )
    );

    return true;
  }

  if (
    activeFlow ===
    VENDOR_PRODUCT_FLOWS.PRICE_STOCK
  ) {
    addMessage(
      createMessage(
        "assistant",
        `Am notat:

„${text}”

După alegerea produsului, vom putea actualiza rapid prețul sau stocul.`
      )
    );

    return true;
  }

  if (
    activeFlow ===
    VENDOR_PRODUCT_FLOWS.PRODUCT_HELP
  ) {
    addMessage(
      createMessage(
        "assistant",
        `Am notat informațiile pentru echipa Artfest:

„${text}”

După conectarea solicitărilor de ajutor, acestea vor fi trimise împreună cu fotografiile produsului.`
      )
    );

    return true;
  }

  return false;
}

/* =========================================================
   Placeholder
========================================================= */

export function getVendorInputPlaceholder(
  activeFlow
) {
  switch (activeFlow) {
    case VENDOR_PRODUCT_FLOWS.ADD_PRODUCT:
      return "Descrie pe scurt produsul și cum se comandă...";

    case VENDOR_PRODUCT_FLOWS.EDIT_PRODUCT:
      return "Spune ce dorești să modifici...";

    case VENDOR_PRODUCT_FLOWS.PRICE_STOCK:
      return "Ex: schimbă prețul la 120 lei...";

    case VENDOR_PRODUCT_FLOWS.PRODUCT_HELP:
      return "Spune-ne ce produs vinzi și unde ai nevoie de ajutor...";

    default:
      return "Scrie un mesaj...";
  }
}