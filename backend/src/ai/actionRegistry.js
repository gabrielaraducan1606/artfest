// backend/src/ai/actionRegistry.js

/*
 * Registru GENERIC de acțiuni disponibile prin copilotRouter.js -
 * un singur loc care declară CE acțiuni există, nu un if separat
 * per formulare de mesaj. Fiecare intrare reutilizează un handler
 * DEJA existent din vendorAssistantCommandService.js (Vendor
 * Assistant / Costuri & Profit) - nicio logică de business nouă,
 * nicio scriere directă în DB de aici.
 *
 * commandType e numele intern folosit de buildPrompt/dispatchCommand
 * din vendorAssistantCommandService.js - action e numele generic,
 * stabil, expus către restul copilot-ului (poate diferi de
 * commandType dacă denumirea internă nu e cea mai clară extern,
 * ex. RECALCULATE_PRODUCTS -> RECALCULATE_BATCH).
 *
 * IMPORTANT - de ce nu există UPDATE_PRICE / UPDATE_STOCK /
 * UPDATE_LEAD_TIME / UPDATE_TITLE / UPDATE_DESCRIPTION /
 * UPDATE_AVAILABILITY / ACTIVATE_PRODUCT / HIDE_PRODUCT separate:
 * toate sunt DEJA acoperite ca simple câmpuri ale UNEI SINGURE
 * acțiuni existente, UPDATE_PRODUCT (vezi
 * PRODUCT_UPDATE_ALLOWED_FIELDS din vendorAssistantCommandService.js:
 * title, description, price, readyQty, leadTimeDays, availability,
 * isHidden, etc.) - toate scriu prin ACELAȘI PUT
 * /api/vendors/products/:id. A le înregistra separat ar fi doar
 * redenumire, nu capabilitate nouă - "nu inventa" se aplică și la
 * fragmentarea artificială a unei acțiuni deja existente.
 *
 * CREATE_PRODUCT și un "ARCHIVE" separat de isHidden/isActive NU
 * sunt înregistrate - nu există un handler conversațional
 * (pendingAction) reutilizabil pentru crearea produsului (trece
 * printr-un wizard UI dedicat), iar schema Prisma a Product nu are
 * un status "archived" distinct de isActive/isHidden - le adăugăm
 * doar când există un handler real de reutilizat, nu inventăm unul.
 */

export const ACTION_HANDLERS = {
  UPDATE_PRODUCT: {
    commandType: "UPDATE_PRODUCT",
    entityType: "product",
    audience: ["VENDOR"],

    description:
      "Modifică un câmp simplu al unui produs publicat (preț, stoc, descriere, titlu, disponibilitate, vizibilitate/ascundere, categorie, material, tehnică, dimensiuni, timp de realizare etc.).",
  },

  UPDATE_COST_ITEM: {
    commandType: "UPDATE_COST_ITEM",
    entityType: "costItem",
    audience: ["VENDOR"],

    description:
      "Modifică costul unitar al unui element din biblioteca de costuri reutilizabile.",
  },

  CREATE_COST_ITEM: {
    commandType: "CREATE_COST_ITEM",
    entityType: "costItem",
    audience: ["VENDOR"],

    description:
      "Adaugă un material/ambalaj/consumabil nou în biblioteca de costuri reutilizabile a vendorului.",
  },

  UPDATE_PRODUCT_COSTING: {
    commandType: "UPDATE_PRODUCT_COSTING",
    entityType: "product",
    audience: ["VENDOR"],

    description:
      "Modifică draftul intern de calcul al costului unui produs (materiale, manoperă, profit dorit) - NU prețul public.",
  },

  RECALCULATE_PRODUCTS: {
    commandType: "RECALCULATE_BATCH",
    entityType: "product",
    audience: ["VENDOR"],

    description:
      "Recalculează determinist costingul mai multor produse deodată.",
  },

  APPLY_RECOMMENDED_PRICE: {
    commandType: "APPLY_RECOMMENDED_PRICE",
    entityType: "product",
    audience: ["VENDOR"],

    description:
      "Aplică prețul recomandat, calculat de sistem, ca preț public al unui produs.",
  },

  UPDATE_STORE_PROFILE: {
    commandType: "UPDATE_STORE_PROFILE",
    entityType: "store",
    audience: ["VENDOR"],

    description:
      "Modifică date publice ale profilului magazinului (nume, slogan, despre, oraș, adresă, telefon, email, website, descriere scurtă) - NU slug, imagini sau activarea/dezactivarea magazinului.",
  },

  UPDATE_ORDER_STATUS: {
    commandType: "UPDATE_ORDER_STATUS",
    entityType: "order",
    audience: ["VENDOR"],

    description:
      "Schimbă statusul unei comenzi identificate explicit, DOAR pentru tranzițiile 'în pregătire', 'gata de ridicare', 'expediată' sau 'livrată' - anularea NU e disponibilă prin acest flow.",
  },
};

export function isRegisteredAction(action) {
  return Object.prototype.hasOwnProperty.call(
    ACTION_HANDLERS,
    action
  );
}

export function getActionEntry(action) {
  return ACTION_HANDLERS[action] || null;
}

/*
 * Lista de commandType-uri "acțiune" (scriere, cu pendingAction),
 * ca să distingem de commandType-uri de CITIRE (READ_PROFITABILITY,
 * READ_PRODUCT_COST, READ_LIBRARY, CALCULATE_PRICE_GENERIC) care
 * pot ieși din același dispatchCommand, dar nu sunt "acțiuni" în
 * sensul PLATFORM_ACTION - nu au nevoie de confirmare, nu scriu.
 */
export const ACTION_COMMAND_TYPES = new Set(
  Object.values(ACTION_HANDLERS).map(
    (entry) => entry.commandType
  )
);
