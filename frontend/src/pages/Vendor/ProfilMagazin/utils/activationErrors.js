export function extractMissing(e) {
  try {
    return (
      e?.missing ||
      e?.data?.missing ||
      e?.response?.data?.missing ||
      e?.body?.missing ||
      null
    );
  } catch {
    return null;
  }
}

export function extractCode(e) {
  try {
    return (
      e?.error ||
      e?.code ||
      e?.data?.error ||
      e?.response?.data?.error ||
      null
    );
  } catch {
    return null;
  }
}

export function extractHttpStatus(e) {
  return e?.status || e?.response?.status || e?.data?.statusCode || null;
}

export function humanizeActivateError(e) {
  const code = extractCode(e);
  const missing = extractMissing(e);

  if (code === "vendor_entity_not_confirmed") {
    return "Pentru a activa serviciile, trebuie să confirmi că reprezinți o entitate juridică (PFA / SRL / II / IF). Poți face asta din bannerul de deasupra listei de servicii din Dashboard.";
  }

  if (Array.isArray(missing) && missing.length) {
    return `Completează câmpurile obligatorii: ${missing.join(", ")}`;
  }

  if (code === "missing_required_fields_core") {
    return "Completează câmpurile esențiale ale serviciului și profilului, apoi încearcă din nou.";
  }

  if (code === "missing_required_fields_profile") {
    return "Completează profilul magazinului (brand, adresă, zonă acoperire, imagine și acord Master), apoi încearcă din nou.";
  }

  return e?.message || "Nu am putut activa serviciul.";
}