// src/pages/Vendor/CatalogProduse/VendorCollections/collectionSettings.js
//
// Logica PURĂ a formularului de setări al unei colecții (fără React):
// valorile implicite, conversia din/spre API și modul de selecție a
// produselor. Testată în collectionSettings.test.js.
//
// Modul de selecție:
//  - MANUAL (implicit): în colecție intră DOAR produsele bifate de vânzător
//    (VendorCollectionItem). Produsele publicate ulterior NU intră singure.
//  - AUTOMAT (allOwnProducts=true): toate produsele publice ale
//    vânzătorului, inclusiv cele viitoare - doar dacă vânzătorul îl alege
//    explicit. Produsele altor magazine se aleg manual în ambele moduri.

export const MAX_DISCOUNT_PERCENT = 50;

// valorile implicite ale unei colecții noi: selecție MANUALĂ
export const NEW_COLLECTION_SETTINGS = Object.freeze({
  title: "",
  description: "",
  coverImage: "",
  isActive: true,
  allOwnProducts: false,
  discountPercent: 0,
  startsAt: "",
  endsAt: "",
});

// ISO -> valoare pentru <input type="datetime-local"> (ora locală)
export function toLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// valoare datetime-local (ora locală) -> ISO sau null (fără perioadă)
export function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function settingsFromCollection(collection) {
  if (!collection) return { ...NEW_COLLECTION_SETTINGS };
  return {
    title: collection.title || "",
    description: collection.description || "",
    coverImage: collection.coverImage || "",
    isActive: collection.isActive !== false,
    // doar `true` explicit din DB activează modul automat
    allOwnProducts: collection.allOwnProducts === true,
    discountPercent: Number(collection.discountPercent || 0),
    startsAt: toLocalInput(collection.startsAt),
    endsAt: toLocalInput(collection.endsAt),
  };
}

/**
 * Câmpurile trimise la API (aceleași pentru creare și editare).
 * La trecerea AUTOMAT -> MANUAL a unei colecții existente (alegere explicită +
 * „Salvează”), produsele incluse acum automat rămân ÎNTOTDEAUNA în colecție ca
 * selecții bifate (keepOwnProductsAsSelection) - nimic nu se pierde, iar
 * vânzătorul le poate debifa apoi pe rând.
 */
export function settingsPayload(settings, { previous = null } = {}) {
  const payload = {
    title: settings.title.trim(),
    description: settings.description.trim() || null,
    coverImage: settings.coverImage || null,
    isActive: settings.isActive,
    allOwnProducts: settings.allOwnProducts === true,
    discountPercent: Math.max(0, Math.min(MAX_DISCOUNT_PERCENT, Math.round(Number(settings.discountPercent) || 0))),
    startsAt: fromLocalInput(settings.startsAt),
    endsAt: fromLocalInput(settings.endsAt),
  };

  if (isSwitchingToManual(previous, settings)) {
    payload.keepOwnProductsAsSelection = true;
  }

  return payload;
}

/** Colecția salvată e automată, iar formularul o trece pe manual. */
export function isSwitchingToManual(previous, settings) {
  return Boolean(previous) && previous.allOwnProducts === true && settings?.allOwnProducts !== true;
}

/** Colecția salvată e manuală, iar formularul o trece pe includere automată. */
export function isSwitchingToAuto(previous, settings) {
  return Boolean(previous) && previous.allOwnProducts !== true && settings?.allOwnProducts === true;
}

/**
 * Ce i se explică vânzătorului cât timp schimbarea modului NU e salvată
 * (null = nimic de salvat). Un singur pas: „Salvează”.
 */
export function pendingModeChange(previous, settings) {
  if (isSwitchingToManual(previous, settings)) {
    return {
      to: "manual",
      title: "Salvează ca să poți alege produsele pe rând",
      text: "Produsele tale incluse acum automat rămân în colecție, bifate. După salvare le poți debifa pe cele pe care nu le vrei. Produsele de nou publicate nu se mai adaugă singure.",
      saveLabel: "Salvează: aleg eu produsele",
    };
  }
  if (isSwitchingToAuto(previous, settings)) {
    return {
      to: "auto",
      title: "Salvează ca să incluzi automat toate produsele tale",
      text: "Toate produsele tale publice eligibile vor intra în colecție, inclusiv cele pe care le publici de acum înainte. Produsele altor magazine pe care le-ai adăugat rămân în colecție.",
      saveLabel: "Salvează: include automat",
    };
  }
  return null;
}
