// Memoria de CAMPANIE vendor request-based (utils/campaignAttribution.js):
// /c/:slug sau modalul campaniei -> slug în memoria aplicației (+ ?camp= în
// URL pentru refresh) -> campaignSlugs la coș / sumar / checkout.
// Fără localStorage / cookie, fără request propriu, fără dependență de consent.
//
// „Refresh” = o instanță NOUĂ a modulului (import cu query diferit), exact ce
// rămâne după reîncărcarea paginii: doar URL-ul.
//
// Rulare (din frontend/): node --experimental-test-module-mocks --test src/utils/campaignAttribution.test.js

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

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
globalThis.sessionStorage = globalThis.localStorage;
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
const fetchCalls = [];
globalThis.fetch = async (url) => {
  fetchCalls.push(String(url));
  return { ok: true, json: async () => ({}) };
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

const { saveConsent } = await import("../lib/cookieConsent.js");

let instance = 0;
// instanță proaspătă a modulului = pagină reîncărcată
const freshApp = () => import(`./campaignAttribution.js?instance=${++instance}`);

const necessaryOnly = () =>
  saveConsent({ analytics: false, marketing: false, attribution: false }, { action: "NECESSARY_ONLY" });

const campaignStorageOps = () => ops.filter(([op, k]) => op !== "remove" && /campaign/i.test(k));

beforeEach(() => {
  store.clear();
  ops.length = 0;
  fetchCalls.length = 0;
  apiCalls.length = 0;
  cookieWrites = 0;
});

test("/c/:slug -> produs -> coș -> checkout: slug-ul ajunge în campaignSlugs, fără storage", async () => {
  necessaryOnly(); // attribution=false salvat
  ops.length = 0;
  apiCalls.length = 0;
  cookieWrites = 0;

  const app = await freshApp();

  // PublicCampaignPage: serverul a răspuns 200 -> captureCampaignSlug
  assert.equal(app.captureCampaignSlug("toamna-a"), true);

  // linkul produsului din campanie (ProductCard linkQuery)
  assert.equal(app.buildCampaignUrlQuery(["toamna-a"]), "camp=toamna-a");

  // ProductDetails / coș: query API
  assert.equal(app.buildCampaignSlugsApiQuery(), "campaignSlugs=toamna-a");

  // Cart -> /checkout?camp=...
  assert.equal(app.buildCampaignUrlQuery(), "camp=toamna-a");

  // Checkout body
  assert.deepEqual(app.getCampaignSlugsForCheckout(), ["toamna-a"]);

  assert.deepEqual(campaignStorageOps(), [], "fără localStorage pentru campanie");
  assert.equal(cookieWrites, 0, "fără cookie");
  assert.deepEqual(fetchCalls, [], "fără request propriu de atribuire");
  assert.deepEqual(apiCalls, [], "fără request propriu de atribuire (api)");
});

test("modal campanie -> produs -> checkout (navigare internă, fără ?camp= în URL)", async () => {
  const app = await freshApp();
  app.captureCampaignSlug("toamna-b"); // pagina publică a campaniei (PublicCampaignPage)

  // navigare internă: aceeași instanță, nimic în URL -> memoria rămâne
  assert.deepEqual(app.getCampaignSlugsForCheckout(), ["toamna-b"]);
  assert.equal(store.size, 0);
});

test("refresh pe produs (/produs/:id?camp=slug) -> campania revine din URL", async () => {
  const before = await freshApp();
  before.captureCampaignSlug("toamna-a");
  const productUrl = `/produs/p1?${before.buildCampaignUrlQuery(["toamna-a"])}`;

  const after = await freshApp(); // reload
  assert.deepEqual(after.getCampaignSlugsForCheckout(), [], "memoria nu supraviețuiește reload-ului");

  // InfluencerAttributionCapture citește location.search
  after.captureCampaignsFromSearch(new URL(productUrl, "https://x.ro").search);
  assert.deepEqual(after.getCampaignSlugsForCheckout(), ["toamna-a"]);
});

test("refresh pe /checkout?camp=a&camp=b -> ordinea (cea mai recentă primul) se păstrează", async () => {
  const before = await freshApp();
  before.captureCampaignSlug("toamna-b");
  before.captureCampaignSlug("toamna-a"); // cea mai recentă
  const checkoutUrl = `/checkout?ref=atelier-a&${before.buildCampaignUrlQuery()}`;
  assert.equal(checkoutUrl, "/checkout?ref=atelier-a&camp=toamna-a&camp=toamna-b");

  const after = await freshApp();
  after.captureCampaignsFromSearch(new URL(checkoutUrl, "https://x.ro").search);
  assert.deepEqual(after.getCampaignSlugsForCheckout(), ["toamna-a", "toamna-b"]);
});

test("last-click-wins, fără duplicate, cel mult 10; valori invalide ignorate", async () => {
  const app = await freshApp();
  for (const s of ["a", "b", "a"]) app.captureCampaignSlug(s);
  assert.deepEqual(app.getCampaignSlugsForCheckout(), ["a", "b"]);

  for (const s of ["", "  ", null, undefined, "x".repeat(161), "a,b"]) {
    assert.equal(app.captureCampaignSlug(s), false);
  }

  for (let i = 0; i < 15; i++) app.captureCampaignSlug(`s${i}`);
  const slugs = app.getCampaignSlugsForCheckout();
  assert.equal(slugs.length, 10);
  assert.equal(slugs[0], "s14");
});

test("consent: nicio decizie / refuz / acceptare -> același comportament (nu depinde de consent)", async () => {
  store.clear(); // fără decizie
  const a = await freshApp();
  a.captureCampaignSlug("toamna-a");
  assert.deepEqual(a.getCampaignSlugsForCheckout(), ["toamna-a"]);

  necessaryOnly();
  window.dispatchEvent(new CustomEvent("cookie:consent", { detail: { attribution: false } }));
  assert.deepEqual(a.getCampaignSlugsForCheckout(), ["toamna-a"], "refuzul nu șterge campania");
});

test("după comandă: doar campaniile confirmate eligibile de server sunt consumate", async () => {
  const app = await freshApp();
  app.captureCampaignSlug("toamna-b");
  app.captureCampaignSlug("toamna-a");

  app.consumeCampaignSlugs(["toamna-a"]);
  assert.deepEqual(app.getCampaignSlugsForCheckout(), ["toamna-b"]);

  app.consumeCampaignSlugs(undefined);
  assert.deepEqual(app.getCampaignSlugsForCheckout(), ["toamna-b"]);
});

test("query-uri goale când nu există campanie", async () => {
  const app = await freshApp();
  assert.equal(app.buildCampaignSlugsApiQuery(), "");
  assert.equal(app.buildCampaignUrlQuery(), "");
});

/* ---------- surse: fără mecanismul vechi ---------- */

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

test("frontend-ul nu mai folosește tokenul / localStorage / consent pentru campanii", () => {
  const files = {
    campaignAttribution: read("./campaignAttribution.js"),
    checkout: read("../pages/Checkout/Checkout.jsx"),
    cart: read("../pages/Cart/Cart.jsx"),
    page: read("../pages/Campaigns/PublicCampaignPage.jsx"),
    product: read("../pages/Vendor/Produse/ProductDetails.jsx"),
    store: read("../pages/Vendor/ProfilMagazin/components/StoreCampaignCollections.jsx"),
    capture: read("../components/InfluencerAttributionCapture.jsx"),
  };

  for (const [name, src] of Object.entries(files)) {
    assert.doesNotMatch(src, /attributionToken/, `${name}: attributionToken`);
    assert.doesNotMatch(src, /getAttributionsForCheckout|consumeCampaignAttributions|offerCampaignAttribution/, `${name}: API vechi`);
    assert.doesNotMatch(src, /campaignAttributionCapture/, `${name}: captura veche`);
    assert.doesNotMatch(src, /campaignAttribution=/, `${name}: query vechi campaignAttribution`);
  }

  assert.doesNotMatch(files.campaignAttribution, /localStorage\.\w+\(|sessionStorage\.\w+\(|document\.cookie|hasAttributionConsent|hasAnyDecision|^import .*cookieConsent/m);
  assert.equal(fs.existsSync(new URL("./campaignAttributionCapture.js", import.meta.url)), false);

  assert.match(files.checkout, /campaignSlugs: getCampaignSlugsForCheckout\(\)/);
  assert.match(files.checkout, /consumeCampaignSlugs\(result\?\.eligibleCampaignSlugs\)/);
});

test("UI: profilul afișează „Colecțiile magazinului” (FAZA 3); componentele legacy de campanie sunt eliminate", () => {
  const store = read("../pages/Vendor/ProfilMagazin/components/StoreCampaignCollections.jsx");
  const vendorCollectionPage = read("../pages/VendorCollections/PublicVendorCollectionPage.jsx");

  // modalul de campanie din profil și vechiul tab „Campanii” - orfane după FAZA 3, șterse
  assert.equal(fs.existsSync(new URL("../pages/Vendor/ProfilMagazin/modals/PublicCampaignModal.jsx", import.meta.url)), false);
  assert.equal(fs.existsSync(new URL("../pages/Vendor/CatalogProduse/VendorCampaigns/CampaignsTab.jsx", import.meta.url)), false);

  // secțiunea din profil = VendorCollection
  assert.match(store, /Colecțiile magazinului/);
  assert.doesNotMatch(store, /creatorului|Campaniile/);
  assert.match(vendorCollectionPage, /Colecție ·/);
});
