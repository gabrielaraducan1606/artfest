// Memoria de REFERRAL request-based (influencer + vendor), privacy-minimal:
// ?ref= / ?cref= -> memoria aplicației -> câmpuri de checkout. Fără
// localStorage / cookie, fără request, fără dependență de consent
// (ATTRIBUTION_REQUIRES_CONSENT = false). Tipul codului îl decide serverul.
//
// Module REALE: cookieConsent.js, referralMemory.js, influencerAttributionApp.js.
//
// Rulare (din frontend/): node --experimental-test-module-mocks --test src/utils/referralMemory.test.js

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
const ops = [];
globalThis.localStorage = {
  getItem: (k) => {
    ops.push(["get", k]);
    return store.has(k) ? store.get(k) : null;
  },
  setItem: (k, v) => {
    ops.push(["set", k]);
    store.set(k, String(v));
  },
  removeItem: (k) => {
    ops.push(["remove", k]);
    store.delete(k);
  },
};
globalThis.window = new EventTarget();
let cookieWrites = 0;
globalThis.document = {
  get cookie() {
    return "";
  },
  set cookie(_v) {
    cookieWrites++;
  },
};

const apiCalls = [];
mock.module("../lib/api.js", {
  namedExports: {
    api: async (path) => {
      apiCalls.push(String(path));
      return { ok: true };
    },
  },
});

const { saveConsent, hasAttributionConsent, hasAnyDecision } = await import("../lib/cookieConsent.js");
const memoryModule = await import("./referralMemory.js");
const app = await import("./influencerAttributionApp.js");
const { ATTRIBUTION_REQUIRES_CONSENT } = await import("../config/features.js");

const acceptAll = () => saveConsent({ analytics: true, marketing: true, attribution: true }, { action: "ACCEPT_ALL" });
const necessaryOnly = () => saveConsent({ analytics: false, marketing: false, attribution: false }, { action: "NECESSARY_ONLY" });

const referralStorageOps = () => ops.filter(([, k]) => /influencer|referral/i.test(k));
const attributionRequests = () => apiCalls.filter((p) => /influencer\/attribution|vendor-referral\/attribution/.test(p));

let clock = 1_000;
let detach;
function makeMemory(options = {}) {
  const m = memoryModule.createReferralMemory({
    requiresConsent: false,
    hasConsent: hasAttributionConsent,
    hasDecision: hasAnyDecision,
    now: () => ++clock,
    ...options,
  });
  detach = m.attach(window);
  return m;
}

beforeEach(() => {
  store.clear();
  ops.length = 0;
  apiCalls.length = 0;
  cookieWrites = 0;
  detach?.();
});

test("politica curentă: ATTRIBUTION_REQUIRES_CONSENT = false", () => {
  assert.equal(ATTRIBUTION_REQUIRES_CONSENT, false);
});

test("vendor referral direct (?ref=VENDOR) -> vendorReferralCode + referralCodes la checkout", () => {
  const m = makeMemory();
  m.captureFromSearch("?ref=atelier-a");

  const f = m.getCheckoutFields();
  assert.equal(f.vendorReferralCode, "atelier-a");
  assert.deepEqual(f.referralCodes.map((r) => r.code), ["atelier-a"]);
  assert.equal(f.influencerCollectionReferralCode, null);
});

test("influencer apoi vendor -> AMBELE coduri ajung la server (tipul îl decide serverul), cel mai recent primul", () => {
  const m = makeMemory();
  m.captureFromSearch("?ref=teo-31b637");
  m.captureFromSearch("?ref=atelier-a");

  assert.deepEqual(m.getCheckoutFields().referralCodes.map((r) => r.code), ["atelier-a", "teo-31b637"]);
});

test("?ref= repetat -> devine cel mai recent (last-click-wins), fără duplicate; cel mult 5 coduri", () => {
  const m = makeMemory();
  for (const c of ["a", "b", "c", "a", "d", "e", "f", "g"]) m.captureExplicit(c);
  assert.deepEqual(m.getCheckoutFields().referralCodes.map((r) => r.code), ["g", "f", "e", "d", "a"]);
});

test("vendor apoi colecție de influencer fără ?ref= -> ambele păstrate (codul de vendor nu blochează colecția)", () => {
  const m = makeMemory();
  m.captureFromSearch("?ref=atelier-a");
  m.captureCollection("teo-31b637");

  const f = m.getCheckoutFields();
  assert.equal(f.vendorReferralCode, "atelier-a");
  assert.equal(f.influencerCollectionReferralCode, "teo-31b637");
});

test("colecție: primul proprietar rămâne (a doua colecție nu îl suprascrie)", () => {
  const m = makeMemory();
  m.captureCollection("owner-1");
  m.captureCollection("owner-2");
  assert.equal(m.getCheckoutFields().influencerCollectionReferralCode, "owner-1");
});

test("navigare internă -> memoria rămâne; refresh / tab nou -> recuperat doar din URL", () => {
  const m = makeMemory();
  m.captureFromSearch("?ref=atelier-a");
  for (let i = 0; i < 5; i++) m.captureFromSearch("");
  assert.equal(m.getCheckoutFields().vendorReferralCode, "atelier-a");

  // Coș -> /checkout păstrează tot în URL; refresh = aplicație nouă din acel URL
  m.captureCollection("teo-31b637");
  const query = m.toCheckoutQuery();
  assert.equal(query, "ref=atelier-a&cref=teo-31b637");

  const afterRefresh = makeMemory();
  afterRefresh.captureFromSearch(`?${query}`);
  const f = afterRefresh.getCheckoutFields();
  assert.equal(f.vendorReferralCode, "atelier-a");
  assert.equal(f.influencerCollectionReferralCode, "teo-31b637");

  // ordinea mai multor ?ref= se păstrează după refresh
  const multi = makeMemory();
  multi.captureFromSearch("?ref=teo-31b637");
  multi.captureFromSearch("?ref=atelier-a");
  const reloaded = makeMemory();
  reloaded.captureFromSearch(`?${multi.toCheckoutQuery()}`);
  assert.deepEqual(reloaded.getCheckoutFields().referralCodes.map((r) => r.code), ["atelier-a", "teo-31b637"]);

  // fără ?ref= în URL -> pierdut (fără stocare persistentă)
  assert.equal(makeMemory().getCheckoutFields().vendorReferralCode, null);
});

test("linkuri legacy ?ref=X&refSource=collection -> tratate ca fallback de colecție", () => {
  const m = makeMemory();
  m.captureFromSearch("?ref=teo-31b637&refSource=collection");
  const f = m.getCheckoutFields();
  assert.equal(f.influencerCollectionReferralCode, "teo-31b637");
  assert.deepEqual(f.referralCodes, []);
});

test("linkuri: produse din colecție și Coș -> /checkout", () => {
  assert.equal(app.buildCollectionProductLinkQuery({ urlRef: "alt-code", ownerReferralCode: "owner-code" }), "ref=alt-code");
  assert.equal(app.buildCollectionProductLinkQuery({ urlRef: "", ownerReferralCode: "owner-code" }), "cref=owner-code");
  assert.equal(app.buildCollectionProductLinkQuery({ urlRef: "", ownerReferralCode: null }), "");
});

test("cu attribution=false salvat: instanța aplicației trimite codurile; zero storage / cookie / request", () => {
  necessaryOnly();
  ops.length = 0;

  app.captureReferralsFromUrl("?ref=atelier-a");
  app.captureInfluencerReferral("teo-31b637", "/selectii/aaa");

  const f = memoryModule.getReferralCheckoutFields();
  assert.equal(f.vendorReferralCode, "atelier-a");
  assert.equal(f.influencerCollectionReferralCode, "teo-31b637");
  assert.equal(memoryModule.getVendorReferralCodeForCheckout(), "atelier-a");
  assert.equal(app.buildCheckoutReferralQuery(), "ref=atelier-a&cref=teo-31b637");

  assert.deepEqual(referralStorageOps(), [], "nicio citire/scriere referral în localStorage");
  assert.equal(cookieWrites, 0);
  assert.deepEqual(attributionRequests(), [], "niciun request la endpoint-urile vechi");
});

test("cod gol / prea lung -> ignorat (validarea reală e pe server)", () => {
  const m = makeMemory();
  assert.equal(m.captureExplicit("   "), false);
  assert.equal(m.captureExplicit("x".repeat(65)), false);
  assert.deepEqual(m.getCheckoutFields().referralCodes, []);
});

test("politica alternativă (requiresConsent=true): refuz -> nimic; fără decizie -> trimis după acceptare; retragere -> golit", () => {
  necessaryOnly();
  const refusedMem = makeMemory({ requiresConsent: true });
  assert.equal(refusedMem.captureExplicit("atelier-a"), false);

  store.delete("cookie:consent:v1");
  const pending = makeMemory({ requiresConsent: true });
  pending.captureExplicit("atelier-a");
  assert.equal(pending.getCheckoutFields().vendorReferralCode, null);
  acceptAll();
  assert.equal(pending.getCheckoutFields().vendorReferralCode, "atelier-a");
  saveConsent({ attribution: false }, { action: "CUSTOM" });
  assert.deepEqual(pending.getCheckoutFields().referralCodes, []);
});

/* =========================================================
   VendorCollection request-based (/colectie-vendor/:slug, ?vcol=)
   Serverul atribuie colecția DOAR produselor membre, per item - frontend-ul
   doar transportă slug-ul (nu e un ?ref= generic).
========================================================= */

const fsMod = await import("node:fs");
const readSrc = (p) => fsMod.readFileSync(new URL(p, import.meta.url), "utf8");

test("colecție vendor fără ?ref= -> vendorCollectionSlugs la checkout, NU ?ref= generic", () => {
  const m = makeMemory();
  assert.equal(m.captureVendorCollection("colectia-a"), true);

  const f = m.getCheckoutFields();
  assert.deepEqual(f.vendorCollectionSlugs.map((e) => e.slug), ["colectia-a"]);
  assert.equal(f.vendorReferralCode, null, "colecția nu devine cod de vendor");
  assert.deepEqual(f.referralCodes, []);
});

test("colecție vendor cu ?ref= explicit -> ?ref= rămâne explicit; ambele ajung la server (last-click pe server)", () => {
  const m = makeMemory();
  m.captureFromSearch("?ref=atelier-b");
  m.captureVendorCollection("colectia-a");

  const f = m.getCheckoutFields();
  assert.equal(f.vendorReferralCode, "atelier-b");
  assert.equal(f.vendorCollectionSlugs[0].slug, "colectia-a");
  assert.ok(f.vendorCollectionSlugs[0].at > f.referralCodes[0].at, "momentul capturii, pentru last-click");
});

test("produs propriu / produs al altui vendor -> același payload (serverul decide own-sale vs referral)", () => {
  const m = makeMemory();
  m.captureVendorCollection("colectia-a");
  const own = JSON.stringify(m.getCheckoutFields());
  const other = JSON.stringify(m.getCheckoutFields());
  assert.equal(own, other);
});

test("colecție: last-click, fără duplicate, cel mult 5; slug invalid ignorat", () => {
  const m = makeMemory();
  for (const s of ["a", "b", "a", "c", "d", "e", "f"]) m.captureVendorCollection(s);
  assert.deepEqual(m.getCheckoutFields().vendorCollectionSlugs.map((e) => e.slug), ["f", "e", "d", "c", "a"]);
  assert.equal(m.captureVendorCollection(""), false);
  assert.equal(m.captureVendorCollection("x".repeat(181)), false);
});

test("tab nou / refresh pe produs (?vcol=) și coș -> /checkout?vcol= -> refresh pe checkout păstrează colecția", () => {
  const before = makeMemory();
  before.captureVendorCollection("colectia-a");
  const checkoutQuery = before.toCheckoutQuery();
  assert.equal(checkoutQuery, "vcol=colectia-a");

  // tab nou cu linkul produsului: /produs/b1?vcol=colectia-a
  const productTab = makeMemory();
  productTab.captureFromSearch("?vcol=colectia-a");
  assert.deepEqual(productTab.getCheckoutFields().vendorCollectionSlugs.map((e) => e.slug), ["colectia-a"]);

  // refresh pe /checkout?vcol=colectia-a
  const afterRefresh = makeMemory();
  afterRefresh.captureFromSearch(`?${checkoutQuery}`);
  assert.deepEqual(afterRefresh.getCheckoutFields().vendorCollectionSlugs.map((e) => e.slug), ["colectia-a"]);
});

test("colecție vendor cu attribution=false salvat: zero storage / cookie / request / click tracking", () => {
  necessaryOnly();
  ops.length = 0;
  cookieWrites = 0;
  apiCalls.length = 0;

  memoryModule.captureVendorCollectionSlug("colectia-a");
  memoryModule.captureReferralsFromSearch("?vcol=colectia-b");

  const f = memoryModule.getReferralCheckoutFields();
  assert.deepEqual(f.vendorCollectionSlugs.map((e) => e.slug), ["colectia-b", "colectia-a"]);
  assert.match(memoryModule.buildCheckoutReferralQuery(), /vcol=colectia-b&vcol=colectia-a/);

  assert.deepEqual(ops.filter(([op, k]) => op !== "remove" && /collection|referral|attribution/i.test(k)), []);
  assert.equal(cookieWrites, 0);
  assert.deepEqual(apiCalls, [], "niciun request de atribuire / click");
});

test("surse: fără tokenul / localStorage vechi de colecție; pagina publică și checkout pe vendorCollectionSlugs", () => {
  assert.equal(fsMod.existsSync(new URL("./vendorCollectionAttribution.js", import.meta.url)), false);

  const page = readSrc("../pages/VendorCollections/PublicVendorCollectionPage.jsx");
  const checkout = readSrc("../pages/Checkout/Checkout.jsx");
  const quotes = readSrc("../components/AIAssistant/quotes/quoteApi.js");
  const app = readSrc("../App.jsx");

  for (const [name, src] of Object.entries({ page, checkout, quotes })) {
    assert.doesNotMatch(src, /vendorCollectionAttribution|attributionToken/, name);
  }
  // pagina colecției: fără storage / consent (Checkout folosește localStorage pentru alte date, nu atribuire)
  assert.doesNotMatch(page, /localStorage\.\w+\(|sessionStorage\.\w+\(|document\.cookie\s*=|hasAttributionConsent\(/);
  assert.match(page, /captureVendorCollectionSlug\(collectionSlug\)/);
  assert.match(page, /VENDOR_COLLECTION_PARAM/);
  assert.match(app, /path="\/colectie-vendor\/:slug"/);
  assert.match(checkout, /\.\.\.getReferralCheckoutFields\(\)/);
});

/* =========================================================
   FAZA 2: contextul de promoție pentru endpoint-urile de PREȚ
========================================================= */

test("promotionContext: GET-urile de preț primesc campaignSlugs + vendorCollectionSlugs; body-urile la fel", async () => {
  const promo = await import("./promotionContext.js");
  const campaigns = await import("./campaignAttribution.js");

  memoryModule.captureVendorCollectionSlug("colectia-x");
  campaigns.captureCampaignSlug("toamna-a");

  const query = promo.buildPromotionApiQuery();
  assert.match(query, /campaignSlugs=toamna-a/);
  assert.match(query, /vendorCollectionSlugs=colectia-x/);

  const fields = promo.getPromotionBodyFields();
  assert.ok(fields.campaignSlugs.includes("toamna-a"));
  assert.equal(fields.vendorCollectionSlugs[0].slug, "colectia-x");

  const sources = {
    cart: readSrc("../pages/Cart/Cart.jsx"),
    checkout: readSrc("../pages/Checkout/Checkout.jsx"),
    product: readSrc("../pages/Vendor/Produse/ProductDetails.jsx"),
  };
  assert.match(sources.cart, /buildPromotionApiQuery\(\)/);
  assert.match(sources.cart, /\.\.\.getPromotionBodyFields\(\)/);
  assert.match(sources.checkout, /summary\?\$\{buildPromotionApiQuery\(\)\}/);
  assert.match(sources.checkout, /\.\.\.getPromotionBodyFields\(\)/);
  assert.match(sources.product, /buildPromotionApiQuery\(\)/);
  assert.doesNotMatch(sources.cart, /buildCampaignSlugsApiQuery|getCampaignSlugsForCheckout/);
});

test("pagina colecției: în afara intervalului (isLive=false) nu pornește atribuirea", () => {
  const page = readSrc("../pages/VendorCollections/PublicVendorCollectionPage.jsx");
  assert.match(page, /collection\?\.isLive === false \? null/);
});

/* =========================================================
   „Cere ofertă” + login / înregistrare: sesiunea globală, redirect
   (getSafeLoginRedirect - sursă unică), ?vcol= / ?ref= / ?cref= păstrate
   prin reload, plus mesajul QUOTE_ONLY din Checkout (înainte de submit).
   Mutat din quoteLoginFlow.test.js / checkoutQuoteOnly.test.js.
========================================================= */

const { getSafeLoginRedirect } = await import("../pages/Auth/Login/loginRedirect.js");

const readQL = (rel) => fsMod.readFileSync(new URL(rel, import.meta.url), "utf8");
const productDetails = readQL("../pages/Vendor/Produse/ProductDetails.jsx");
const appSrc = readQL("../App.jsx");
const navbar = readQL("../components/Navbar/Navbar.jsx");
const quoteApi = readQL("../components/AIAssistant/quotes/quoteApi.js");

/* ---------- helper-ul de redirect (sursă unică) ---------- */

test("getSafeLoginRedirect: păstrează pathname + search (inclusiv ?vcol=)", () => {
  const back = "/produs/abc?vcol=septembrie";
  assert.equal(getSafeLoginRedirect(`?redirect=${encodeURIComponent(back)}`), back);
  assert.equal(getSafeLoginRedirect(`?auth=login&redirect=${encodeURIComponent("/produs/abc#recenzii")}`), "/produs/abc#recenzii");
});

test("getSafeLoginRedirect: respinge redirect-uri externe / lipsă", () => {
  for (const bad of ["//evil.com/x", "https://evil.com", "evil.com", ""]) {
    assert.equal(getSafeLoginRedirect(`?redirect=${encodeURIComponent(bad)}`), null, bad);
  }
  assert.equal(getSafeLoginRedirect(""), null);
  assert.equal(getSafeLoginRedirect(undefined), null);
});

test("Navbar (modalul global) și /autentificare folosesc ACELAȘI helper -> <Login redirectTo>", () => {
  assert.match(navbar, /const loginRedirect = getSafeLoginRedirect\(location\.search\);/);
  assert.match(navbar, /redirectTo=\{loginRedirect\}/);

  assert.match(appSrc, /function LoginPage\(\) \{/);
  assert.match(appSrc, /const redirectTo = getSafeLoginRedirect\(location\.search\);/);
  assert.match(appSrc, /return <Login redirectTo=\{redirectTo\} \/>;/);
  assert.match(appSrc, /path="\/autentificare"\s*element=\{\s*<LoginPage \/>/);
});

test("E. deja autentificat pe /autentificare?redirect=... -> direct la destinație (fără buclă)", () => {
  assert.match(appSrc, /if \(redirectTo && !loading && me\) \{\s*return <Navigate to=\{redirectTo\} replace \/>;/);
});

/* ---------- A / B: utilizator deja autentificat (USER sau VENDOR) ---------- */

test("A/B. „Cere ofertă” verifică sesiunea globală; cât se încarcă NU trimite la login", () => {
  assert.match(productDetails, /import \{ useAuth \} from "\.\.\/\.\.\/Auth\/Context\/context\.js";/);
  assert.match(productDetails, /const \{ me: sessionMe, loading: sessionLoading \} = useAuth\(\) \|\| \{\};/);
  assert.match(productDetails, /const currentUser = me \|\| sessionMe \|\| null;/);

  // încărcare în curs -> click reținut, nu login
  assert.match(productDetails, /if \(!currentUser && sessionLoading\) \{\s*pendingQuoteRequestRef\.current = true;\s*return;/);
  // reluat o singură dată după încărcare
  assert.match(productDetails, /if \(sessionLoading \|\| !pendingQuoteRequestRef\.current\) return;\s*pendingQuoteRequestRef\.current = false;\s*onRequestQuote\(\);/);

  // login DOAR dacă nu există utilizator (nicio verificare de rol: USER / VENDOR / ADMIN trec)
  const handler = productDetails.slice(productDetails.indexOf("const onRequestQuote = useCallback"), productDetails.indexOf("// click făcut cât se încărca sesiunea"));
  assert.match(handler, /if \(!currentUser\) \{/);
  assert.doesNotMatch(handler, /role/);
});

test("B. vendorul NU poate cere ofertă pentru propriul produs (și după sesiunea globală)", () => {
  assert.match(productDetails, /if \(!product \|\| isOwner \|\| isOwnerBySession\) \{/);
});

/* ---------- C / D: guest -> login -> înapoi, cu ?vcol= ---------- */

test("C. guest: redirect-ul la login conține pathname + search (deci ?vcol=)", () => {
  const handler = productDetails.slice(productDetails.indexOf("const onRequestQuote = useCallback"), productDetails.indexOf("// click făcut cât se încărca sesiunea"));
  assert.match(handler, /window\.location\.pathname \+\s*window\.location\.search/);
  assert.match(handler, /navigate\(\s*`\/autentificare\?redirect=\$\{redir\}`/);
});

test("D. după revenire (reload pe /produs/abc?vcol=septembrie) colecția e recapturată și pleacă în cererea de ofertă", () => {
  const back = getSafeLoginRedirect(`?redirect=${encodeURIComponent("/produs/abc?vcol=septembrie")}`);
  const memory = memoryModule.createReferralMemory({ requiresConsent: false }); // memorie nouă = după window.location.assign
  memory.captureFromSearch(back.slice(back.indexOf("?")));

  const fields = memory.getCheckoutFields();
  assert.deepEqual(fields.vendorCollectionSlugs.map((e) => e.slug), ["septembrie"]);

  // quoteApi.createQuoteRequest trimite câmpurile memoriei în POST /api/assistant/quotes
  const create = quoteApi.slice(quoteApi.indexOf("export async function createQuoteRequest"), quoteApi.indexOf("export async function fetchMyQuotes"));
  assert.match(create, /"\/api\/assistant\/quotes"/);
  assert.match(create, /\.\.\.getReferralCheckoutFields\(\),/);
});

/* =========================================================
   Login -> Înregistrare -> (confirmare email) -> destinația inițială
   Același helper (getSafeLoginRedirect) pe tot fluxul.
========================================================= */

const { withLoginRedirect, resolvePostAuthDestination } = await import("../pages/Auth/Login/loginRedirect.js");
const register = readQL("../pages/Auth/Register/Register.jsx");
const verifyEmail = readQL("../pages/Auth/VerifyEmail/VerifyEmail.jsx");

const BACK = "/produs/abc?vcol=septembrie";

// simulează un pas al fluxului: URL-ul paginii -> search-ul ei
const searchOf = (url) => (url.includes("?") ? url.slice(url.indexOf("?")) : "");

test("1/2. guest -> login -> „Creează cont” -> confirmare email -> produs, cu ?vcol= păstrat", () => {
  for (const start of [
    `/autentificare?redirect=${encodeURIComponent(BACK)}`, // tab-ul „Înregistrare” din pagina de login
    `/inregistrare?redirect=${encodeURIComponent(BACK)}`, // ruta dedicată
    `/produs/abc?vcol=septembrie&auth=login&redirect=${encodeURIComponent(BACK)}`, // modalul global
  ]) {
    // Register: signup -> pending_verification -> /verify-email?email=...&redirect=...
    const verifyUrl = withLoginRedirect("/verify-email?email=ana%40t.ro", getSafeLoginRedirect(searchOf(start)));
    assert.equal(verifyUrl, `/verify-email?email=ana%40t.ro&redirect=${encodeURIComponent(BACK)}`, start);

    // VerifyEmail: cod corect -> destinația inițială, nu dashboard-ul
    const finalUrl = resolvePostAuthDestination({ redirectTo: getSafeLoginRedirect(searchOf(verifyUrl)), fallback: "/desktop-user" });
    assert.equal(finalUrl, BACK, start);

    // după window.location.assign(finalUrl): colecția e recapturată
    const memory = memoryModule.createReferralMemory({ requiresConsent: false });
    memory.captureFromSearch(searchOf(finalUrl));
    assert.deepEqual(memory.getCheckoutFields().vendorCollectionSlugs.map((e) => e.slug), ["septembrie"], start);
  }

  // înregistrare fără confirmare (ex. Google) -> direct la destinație
  assert.equal(resolvePostAuthDestination({ redirectTo: getSafeLoginRedirect(`?redirect=${encodeURIComponent(BACK)}`), fallback: "/desktop-user" }), BACK);
});

test("3. redirect extern blocat pe tot fluxul de înregistrare", () => {
  for (const bad of ["//evil.com/x", "https://evil.com/x", "evil.com"]) {
    const search = `?redirect=${encodeURIComponent(bad)}`;
    assert.equal(withLoginRedirect("/verify-email?email=a%40t.ro", getSafeLoginRedirect(search)), "/verify-email?email=a%40t.ro", bad);
    assert.equal(withLoginRedirect("/verify-email?email=a%40t.ro", bad), "/verify-email?email=a%40t.ro", bad);
    assert.equal(resolvePostAuthDestination({ redirectTo: bad, fallback: "/desktop-user" }), "/desktop-user", bad);
  }
});

test("4. login normal (fără redirect) neschimbat: Login decide după rol", () => {
  assert.equal(getSafeLoginRedirect("?auth=login"), null);
  const login = readQL("../pages/Auth/Login/Login.jsx");
  assert.match(login, /if \(redirectTo\) \{\s*next = redirectTo;\s*\}/);
  assert.match(login, /next = "\/desktop-user";/);
});

test("5. înregistrare normală fără redirect neschimbată; vânzătorul păstrează onboarding-ul", () => {
  assert.equal(resolvePostAuthDestination({ redirectTo: null, fallback: "/desktop-user" }), "/desktop-user");
  assert.equal(withLoginRedirect("/verify-email?email=a%40t.ro", null), "/verify-email?email=a%40t.ro");
  // vânzător: chiar cu redirect, rămâne fluxul de onboarding
  assert.equal(resolvePostAuthDestination({ redirectTo: BACK, vendorIntent: true, fallback: "/onboarding" }), "/onboarding");
});

test("Register și VerifyEmail folosesc același helper (fără mecanism paralel)", () => {
  assert.match(register, /from "\.\.\/Login\/loginRedirect\.js";/);
  assert.match(register, /redirectTo: getSafeLoginRedirect\(window\.location\.search\),\s*fallback:\s*response\?\.next \|\|\s*"\/desktop-user",/);
  assert.match(register, /asVendor \? null : getSafeLoginRedirect\(window\.location\.search\)/);
  // ramura de vânzător din redirectAfterSuccess rămâne neatinsă
  assert.match(register, /response\?\.next \|\|\s*"\/onboarding";/);

  assert.match(verifyEmail, /import \{ getSafeLoginRedirect, resolvePostAuthDestination \} from "\.\.\/Login\/loginRedirect\.js";/);
  assert.match(verifyEmail, /vendorIntent: intent === "vendor",/);
});

/* =========================================================
   „Cere ofertă” -> login: contextul de referral din MEMORIE intră în
   URL-ul de întoarcere (doar parametrii lipsă) - buildCheckoutReferralQuery
   (același helper ca Coș -> Checkout) + withMissingQueryParams.
========================================================= */

const { withMissingQueryParams } = await import("../pages/Auth/Login/loginRedirect.js");
const INF = "teo-31b637";

// payload-ul cererii de ofertă (quoteApi: ...getReferralCheckoutFields()), fără timestamp-uri
const payloadOf = (memory) => {
  const f = memory.getCheckoutFields();
  return { ...f, referralCodes: f.referralCodes.map((e) => e.code), vendorCollectionSlugs: f.vendorCollectionSlugs.map((e) => e.slug) };
};

// ce face ProductDetails.onRequestQuote pentru guest, apoi Login -> reload pe URL-ul de întoarcere
function quoteLoginRoundTrip(memoryBefore, currentUrl) {
  const redirectTarget = withMissingQueryParams(currentUrl, memoryBefore.toCheckoutQuery());
  const loginUrl = `/autentificare?redirect=${encodeURIComponent(redirectTarget)}`;
  const back = getSafeLoginRedirect(searchOf(loginUrl));
  const memoryAfter = memoryModule.createReferralMemory({ requiresConsent: false }); // reload -> memorie goală
  memoryAfter.captureFromSearch(searchOf(back));
  return { back, memoryAfter };
}

test("A. influencer capturat pe homepage, produs fără ?ref= -> după login ref păstrat, același payload", () => {
  const before = memoryModule.createReferralMemory({ requiresConsent: false });
  before.captureFromSearch(`?ref=${INF}`); // /?ref=teo...
  const { back, memoryAfter } = quoteLoginRoundTrip(before, "/produs/qb");
  assert.equal(back, `/produs/qb?ref=${INF}`);
  assert.deepEqual(payloadOf(memoryAfter), payloadOf(before));
});

test("B. colecție influencer fără ?ref= -> ?cref= păstrat (și când URL-ul produsului l-a pierdut)", () => {
  const before = memoryModule.createReferralMemory({ requiresConsent: false });
  before.captureCollection(INF); // vizita /selectii/:slug fără ?ref=
  for (const url of [`/produs/qb?cref=${INF}`, "/produs/qb", "/produs/qb?from=similar"]) {
    const { back, memoryAfter } = quoteLoginRoundTrip(before, url);
    assert.equal(new URLSearchParams(searchOf(back)).getAll("cref").length, 1, url);
    assert.equal(memoryAfter.getCheckoutFields().influencerCollectionReferralCode, INF, url);
    assert.deepEqual(payloadOf(memoryAfter), payloadOf(before), url);
  }
});

test("C. VendorCollection -> ?vcol= păstrat (și după navigare la alt produs)", () => {
  const before = memoryModule.createReferralMemory({ requiresConsent: false });
  before.captureVendorCollection("septembrie");
  for (const url of ["/produs/qb?vcol=septembrie", "/produs/alt-produs"]) {
    const { back, memoryAfter } = quoteLoginRoundTrip(before, url);
    assert.deepEqual(new URLSearchParams(searchOf(back)).getAll("vcol"), ["septembrie"], url);
    assert.deepEqual(payloadOf(memoryAfter).vendorCollectionSlugs, ["septembrie"], url);
  }
});

test("D. ?ref= explicit din URL NU e suprascris; doar cheile lipsă sunt completate", () => {
  const before = memoryModule.createReferralMemory({ requiresConsent: false });
  before.captureFromSearch(`?ref=${INF}&vcol=septembrie`);
  before.captureFromSearch("?ref=alt-cod"); // cel mai recent, e și în URL

  const { back } = quoteLoginRoundTrip(before, "/produs/qb?ref=alt-cod&color=rosu");
  const params = new URLSearchParams(searchOf(back));
  assert.deepEqual(params.getAll("ref"), ["alt-cod"], "ref din URL rămâne singura sursă");
  assert.deepEqual(params.getAll("vcol"), ["septembrie"], "vcol lipsea -> completat");
  assert.equal(params.get("color"), "rosu", "ceilalți parametri ai paginii rămân");

  // fără nimic în memorie -> URL neschimbat
  assert.equal(withMissingQueryParams("/produs/qb?x=1#recenzii", ""), "/produs/qb?x=1#recenzii");
});

test("E. fără buclă: URL-ul completat e idempotent și /autentificare cu sesiune activă trimite direct la destinație", () => {
  const before = memoryModule.createReferralMemory({ requiresConsent: false });
  before.captureFromSearch(`?ref=${INF}&vcol=septembrie`);
  const once = withMissingQueryParams("/produs/qb", before.toCheckoutQuery());
  assert.equal(withMissingQueryParams(once, before.toCheckoutQuery()), once, "a doua trecere nu mai adaugă nimic");
  assert.match(appSrc, /if \(redirectTo && !loading && me\) \{\s*return <Navigate to=\{redirectTo\} replace \/>;/);
});

test("F. DIRECT / OPTIONS / QUOTE_ONLY neschimbate: completarea e doar pe redirect-ul de login din „Cere ofertă”", () => {
  const details = readQL("../pages/Vendor/Produse/ProductDetails.jsx");
  assert.equal(details.split("withMissingQueryParams(").length - 1, 1, "un singur apel");
  const handler = details.slice(details.indexOf("const onRequestQuote = useCallback"), details.indexOf("// click făcut cât se încărca sesiunea"));
  assert.match(handler, /withMissingQueryParams\(\s*window\.location\.pathname \+\s*window\.location\.search,\s*buildCheckoutReferralQuery\(\)\s*\)/);
  // adăugarea în coș nu folosește redirect-ul de login
  const addToCart = details.slice(details.indexOf("const configuration = {"), details.indexOf("const addToCartAny"));
  assert.doesNotMatch(addToCart, /withMissingQueryParams|autentificare/);
});


/* ---------- Checkout: QUOTE_ONLY detectat de summary ---------- */

const checkoutSrc = readQL("../pages/Checkout/Checkout.jsx");

test("mesajul QUOTE_ONLY e cel cerut și e mapat și pentru eroarea de plasare", () => {
  assert.match(checkoutSrc, /const QUOTE_ONLY_MESSAGE = "Acest produs se comandă prin cerere de ofertă\.";/);
  assert.match(checkoutSrc, /case "quote_only_product":\s*return QUOTE_ONLY_MESSAGE;/);
});

test("eroarea din summary (la încărcare, înainte de submit) setează produsul și mesajul cu titlul", () => {
  assert.match(checkoutSrc, /if \(error\?\.code === "quote_only_product"\) \{/);
  assert.match(checkoutSrc, /setQuoteOnlyProduct\(\{ id: error\?\.data\?\.productId \|\| null, title \}\);/);
  // resetat la fiecare reîncărcare a sumarului
  assert.match(checkoutSrc, /setLoading\(true\);\s*setError\(""\);\s*setQuoteOnlyProduct\(null\);/);
});

test("starea goală nu mai afirmă „Coșul tău este gol” când produsul e QUOTE_ONLY; trimite la coș", () => {
  const quoteOnlyBranch = checkoutSrc.indexOf("items.length === 0 && quoteOnlyProduct ?");
  const emptyBranch = checkoutSrc.indexOf("Coșul tău este gol.");
  assert.ok(quoteOnlyBranch > 0 && quoteOnlyBranch < emptyBranch);
  assert.match(checkoutSrc, /Elimină produsul din coș și cere o ofertă din pagina lui\./);
  assert.match(checkoutSrc, /<Link to="\/cos" className=\{styles\.linkPrimary\}>\s*Mergi la coș/);
});
