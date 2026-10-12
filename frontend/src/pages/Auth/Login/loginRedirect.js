// src/pages/Auth/Login/loginRedirect.js
//
// Redirect-ul contextual după login - SURSĂ UNICĂ pentru modalul global
// (?auth=login&redirect=..., Navbar.jsx) și pagina /autentificare?redirect=...
// (App.jsx). Ambele îl trimit către <Login redirectTo={...} />, care face
// navigarea finală (finishLogin).
//
// Acceptăm doar redirect-uri interne, cu tot cu query-ul paginii de plecare
// (ex. /produs/abc?vcol=septembrie - ?vcol= e recapturat după reload de
// InfluencerAttributionCapture.jsx).
//
// Ex. acceptate: /  /cereri/123  /produs/abc#recenzii  /produs/abc?vcol=x
// Respinse: //evil.com  https://evil.com  ""

export function getSafeLoginRedirect(search) {
  try {
    const requestedRedirect = new URLSearchParams(search || "").get("redirect");

    if (requestedRedirect && requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//")) {
      return requestedRedirect;
    }

    // fără redirect contextual -> Login.jsx decide desktop-ul după rol
    return null;
  } catch {
    return null;
  }
}

/*
 * Același redirect, transmis mai departe pe o rută internă din fluxul de
 * autentificare (ex. /verify-email?email=... după înregistrare), ca să nu
 * se piardă până la finalul fluxului. Fără redirect valid -> path neschimbat.
 */
export function withLoginRedirect(path, redirect) {
  const safe = getSafeLoginRedirect(redirect ? `?redirect=${encodeURIComponent(redirect)}` : "");
  if (!path || !safe) return path;

  const [base, hash = ""] = String(path).split("#");
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}redirect=${encodeURIComponent(safe)}${hash ? `#${hash}` : ""}`;
}

/*
 * Pagina de login pentru o rută protejată, cu întoarcere EXACT la pagina
 * cerută (pathname + search + hash) - ex. linkul din emailul „mesaj nou”
 * (/cont/mesaje?threadId=..., /mesaje?threadId=..., /mesaje?vendorThreadId=...).
 * Același ?redirect= citit de getSafeLoginRedirect în <LoginPage>.
 */
export function loginPathFor(location) {
  const current = `${location?.pathname || "/"}${location?.search || ""}${location?.hash || ""}`;
  return withLoginRedirect("/autentificare", current);
}

/*
 * Deep-link la conversația unei cereri de ofertă (?assistant=quote|vendor-quote
 * &quoteId=...) - deschis de asistent doar pentru un cont autentificat.
 */
export function isQuoteDeepLink(search) {
  try {
    const params = new URLSearchParams(search || "");
    const target = params.get("assistant");
    return (target === "quote" || target === "vendor-quote") && Boolean(params.get("quoteId"));
  } catch {
    return false;
  }
}

/*
 * Destinația finală după înregistrare / confirmarea emailului:
 *  - cont de VÂNZĂTOR -> fluxul lui (onboarding), neschimbat;
 *  - altfel, redirect contextual valid (ex. /produs/abc?vcol=x) -> acolo;
 *  - altfel -> destinația implicită (răspunsul backend-ului / dashboard).
 */
export function resolvePostAuthDestination({ redirectTo = null, vendorIntent = false, fallback }) {
  if (vendorIntent) return fallback;
  return getSafeLoginRedirect(redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : "") || fallback;
}

/*
 * Completează un URL intern (pathname + search) cu parametrii dintr-un alt
 * query (ex. buildCheckoutReferralQuery() - contextul de referral din memorie:
 * ?ref= / ?cref= / ?vcol=) DOAR pentru cheile care LIPSESC din URL. O cheie
 * prezentă deja în URL rămâne sursa curentă și nu e completată / suprascrisă.
 * Folosit înainte de redirect-ul la login: după reload memoria e goală, iar
 * contextul revine doar din URL.
 */
export function withMissingQueryParams(pathWithSearch, extraQuery) {
  const raw = String(pathWithSearch || "");
  const extra = new URLSearchParams(String(extraQuery || "").replace(/^\?/, ""));
  if (![...extra.keys()].length) return raw;

  const [beforeHash, hash = ""] = raw.split("#");
  const queryIndex = beforeHash.indexOf("?");
  const path = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const current = new URLSearchParams(queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : "");

  for (const key of new Set(extra.keys())) {
    if (current.has(key)) continue;
    for (const value of extra.getAll(key)) current.append(key, value);
  }

  const search = current.toString();
  return `${path}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}
