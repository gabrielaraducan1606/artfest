// FAZA 3 - „Colecții” e conceptul UNIC vizibil pentru vendor (VendorCollection):
// un singur tab, editorul cu câmpurile preluate din campanii, fără CampaignsTab
// în UI-ul vendorului, profilul magazinului cu „Colecțiile magazinului”,
// redirect legacy /c/:slug, asistentul pe tab-ul unic.
//
// Rulare (din frontend/): node --test src/pages/Vendor/CatalogProduse/VendorCollections/vendorCollectionsTab.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const exists = (p) => fs.existsSync(new URL(p, import.meta.url));

const tab = read("./VendorCollectionsTab.jsx");
const links = read("./collectionsHubLinks.js");
const catalog = read("../CatalogProduse.jsx");
const nav = read("../../../../config/vendorNavigation.js");
const profil = read("../../ProfilMagazin/ProfilMagazin.jsx");
const hero = read("../../ProfilMagazin/components/StoreHero.jsx");
const storeSection = read("../../ProfilMagazin/components/StoreCampaignCollections.jsx");
const publicPage = read("../../../VendorCollections/PublicVendorCollectionPage.jsx");
const campaignPage = read("../../../Campaigns/PublicCampaignPage.jsx");
const registry = read("../../../../components/AIAssistant/assistantActionRegistry.js");
const intent = read("../../../../components/AIAssistant/VendorAIAssistant/vendorIntent.js");

/* ---------- un singur tab, fără CampaignsTab ---------- */

test("CatalogProduse: UN SINGUR tab „Colecții” care montează VendorCollectionsTab; fără CampaignsTab / hub / secțiuni", () => {
  assert.match(catalog, /changeTab\("campaigns"\)\s*\}\s*>\s*\{\/\*[\s\S]*?\*\/\}\s*Colecții\s*<\/button>/);
  assert.match(catalog, /activeTab === "campaigns" && \(\s*<VendorCollectionsTab \/>/);
  assert.doesNotMatch(catalog, /CampaignsTab|CollectionsHub|Campanii promoționale/);
  assert.doesNotMatch(catalog, />\s*Campanii\s*</);
  assert.equal((catalog.match(/Colecții\s*<\/button>/g) || []).length, 1);
  assert.equal(exists("./CollectionsHub.jsx"), false, "hub-ul cu secțiuni a dispărut");
});

test("meniul vendorului: un singur link „Colecții” -> tab-ul unic", () => {
  assert.match(nav, /label: "Colecții", to: "\/vendor\/catalog\?tab=campaigns"/);
  assert.doesNotMatch(nav, /label: "Campanii"/);
  assert.equal((nav.match(/label: "Colecții"/g) || []).length, 1);
  assert.match(links, /COLLECTIONS_HUB_URL = "\/vendor\/catalog\?tab=campaigns"/);
  assert.doesNotMatch(links, /SECTION|campanii/);
});

/* ---------- editorul ---------- */

test("editor: titlu, descriere, cover (upload), activ, perioadă, reducere, allOwnProducts -> PATCH", () => {
  for (const field of ["title", "description", "coverImage", "isActive", "allOwnProducts", "discountPercent", "startsAt", "endsAt"]) {
    assert.match(tab, new RegExp(`${field}:`), field);
  }
  assert.match(tab, /method: "PATCH"/);
  assert.match(tab, /uploadFile\(file, "\/api\/upload"\)/);
  assert.match(tab, /type="datetime-local"/);
  assert.match(tab, /fromLocalInput\(settings\.startsAt\)/);
  assert.match(tab, /fromLocalInput\(settings\.endsAt\)/);
});

test("editor: „Include automat toate produsele mele” în ACELAȘI formular (creare + editare), bifat implicit la creare", () => {
  assert.equal((tab.match(/>\s*Include automat toate produsele mele\s*</g) || []).length, 1);
  assert.match(tab, /NEW_COLLECTION_SETTINGS = \{[\s\S]*?allOwnProducts: true,/);
  assert.match(tab, /p\.isOwn && allOwnActive \?/);
  assert.match(tab, /Inclus automat/);
});

test("UX: [lista] [editor]; formular unic creare/editare: Date generale + „Perioadă și reducere” (accordion) înainte de salvare", () => {
  assert.match(tab, /<aside className=\{styles\.sidebar\}/);
  assert.match(tab, /className=\{styles\.editor\}/);
  assert.match(tab, /\+ Colecție nouă/);

  // ordinea din editor: date generale -> accordion -> salvare -> produse -> căutare
  const order = ["Date generale", "Perioadă și reducere", "Creează colecția", "Produse din colecție", "Adaugă produse din tot Artfest"];
  const positions = order.map((label) => tab.indexOf(label));
  assert.ok(positions.every((p) => p > 0), JSON.stringify(positions));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);

  // accordion nativ, controlat (nu se închide singur când golești reducerea)
  assert.match(tab, /<details\s+className=\{styles\.advanced\}\s+open=\{advancedOpen\}\s+onToggle=/);

  // creare și editare trimit aceleași câmpuri (inclusiv reducere / perioadă) - același API
  assert.match(tab, /method: "POST",\s*body: settingsPayload\(settings\)/);
  assert.match(tab, /method: "PATCH",\s*body: settingsPayload\(settings\)/);
  assert.doesNotMatch(tab, /<main\b/);
});

test("editor: reducerea explicată - doar produse proprii, suportată de vendor, nu de Artfest", () => {
  assert.match(tab, /doar produselor tale/);
  assert.match(tab, /suportată de tine \(nu de Artfest\)/);
  assert.match(tab, /Produsele altor magazine nu primesc această\s+reducere/);
  assert.match(tab, /MAX_DISCOUNT_PERCENT = 50/);
});

test("editor: produse cross-vendor din tot marketplace-ul, adăugare / scoatere, link public", () => {
  assert.match(tab, /\/api\/vendor\/collections\/\$\{encodeURIComponent\(selectedId\)\}\/product-search/);
  assert.match(tab, /body: \{ productIds: \[productId\] \}/);
  assert.match(tab, /method: "DELETE"/);
  assert.match(tab, /Produsul tău/);
  assert.match(tab, /Alt magazin/);
  assert.match(tab, /\/colectie-vendor\/\$\{selected\.slug\}/);
  assert.match(tab, /copyPublicLink/);
  for (const field of ["q", "store", "category"]) assert.ok(tab.includes(`params.set("${field}"`), field);
});

/* ---------- profil magazin ---------- */

test("profil magazin: fără modale de campanii; „Colecțiile magazinului” (VendorCollection) -> /colectie-vendor/:slug", () => {
  assert.doesNotMatch(profil, /StoreCampaignsModal|PublicCampaignModal|loadCampaignsForModal|\/api\/vendor\/campaigns/);
  assert.match(profil, /onOpenCampaigns=\{\(\) => navigate\(COLLECTIONS_HUB_URL\)\}/);
  assert.match(profil, /<StoreCampaignCollections storeSlug=\{storeSlug\} \/>/);

  assert.match(storeSection, /\/api\/public\/vendor-collections\/store\//);
  assert.match(storeSection, /Colecțiile magazinului/);
  assert.match(storeSection, /to=\{`\/colectie-vendor\/\$\{encodeURIComponent\(collection\.slug\)\}`\}/);
  assert.doesNotMatch(storeSection, /\/api\/public\/campaigns|Campaniile magazinului|onOpenCampaign/);

  assert.match(hero, /📚 Colecții/);
  assert.doesNotMatch(hero, /✨ Campanii/);
});

/* ---------- pagina publică canonică ---------- */

test("pagina publică: cover, titlu, descriere, owner, prețurile backend-ului, sellerul REAL pe fiecare produs", () => {
  assert.match(publicPage, /collection\.coverImage/);
  assert.match(publicPage, /Colecție · \{ownerName\}/);
  assert.match(publicPage, /Vândut de/);
  assert.match(publicPage, /p\?\.service\?\.profile\?\.displayName/);
  assert.match(publicPage, /collection\.isLive && Number\(collection\.discountPercent\) > 0/);
  assert.match(publicPage, /status === "SCHEDULED"/);
  assert.match(publicPage, /status === "EXPIRED"/);
});

/* ---------- legacy /c/:slug ---------- */

test("legacy /c/:slug: campanie migrată -> redirect (replace) la /colectie-vendor/:slug cu query; nemigrată -> pagina veche", () => {
  assert.match(campaignPage, /\/api\/public\/vendor-collections\/legacy-campaign\//);
  assert.match(campaignPage, /navigate\(`\/colectie-vendor\/\$\{encodeURIComponent\(collectionSlug\)\}\$\{location\.search \|\| ""\}`/);
  assert.match(campaignPage, /replace: true/);
  assert.match(campaignPage, /return api\(`\/api\/public\/campaigns\//);
});

/* ---------- asistent ---------- */

test("asistent: VENDOR_CAMPAIGNS -> „colecțiile tale”, tab-ul unic; „colecții” și „campanii” recunoscute", () => {
  assert.match(registry, /route: "\/vendor\/catalog\?tab=campaigns",[\s\S]*?label: "colecțiile tale"/);
  assert.doesNotMatch(registry, /section=campanii|label: "campaniile tale"/);

  const line = intent.split("\n").find((l) => l.includes('target: "VENDOR_CAMPAIGNS"'));
  const re = new RegExp(line.match(/re: \/(.+?)\/,/)[1]);
  for (const text of ["arata-mi colectiile", "colecțiile mele", "campaniile mele"]) assert.ok(re.test(text), text);
});

/* ---------- UX zona de produse ---------- */


test("UX produse: etichete „Produs propriu” / „Recomandare” în listă; „Produsul tău” / „Alt magazin” + microtext în căutare", () => {
  assert.match(tab, /badgeLabel=\{isOwn \? "Produs propriu" : "Recomandare"\}/);
  assert.match(tab, /hint=\{p\.isOwn \? null : "Poate genera remunerație din recomandare"\}/);
  assert.match(tab, /isOwn \? "Produsul tău" : "Alt magazin"/);
});

test("UX produse: empty state cu explicație + CTA „Explorează produsele Artfest”", () => {
  assert.match(tab, /Adaugă produse de la alte magazine pentru a transforma colecția într-o selecție\s+completă/);
  assert.match(tab, /Explorează produsele Artfest/);
});

test("formulări financiare prudente: fără „vei câștiga” / „câștig garantat” / „profit sigur”", () => {
  assert.doesNotMatch(tab, /vei câștiga|câștig garantat|profit sigur|primești câștig/i);
});


test("UX produse: explicația scurtă + CTA principal + cele două opțiuni, înaintea listei și a căutării; fără mesaj duplicat", () => {
  assert.match(tab, /Poți adăuga produse de la alte magazine și poți primi remunerație din\s+recomandările eligibile\./);
  assert.doesNotMatch(tab, /Construiește o colecție care poate lucra pentru tine/);
  assert.match(tab, /className=\{`\$\{styles\.primary\} \$\{styles\.ctaAdd\}`\} onClick=\{openProductSearch\}/);
  assert.match(tab, /<strong>Produsele tale<\/strong>/);
  assert.match(tab, /<strong>Produse de la alte magazine<\/strong>/);

  const order = ["Poți adăuga produse de la alte magazine", "Produse din colecție", "Adaugă produse din tot Artfest"];
  const positions = order.map((label) => tab.indexOf(label));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("banner „Poți câștiga și din recomandări”: o singură dată, ÎNAINTEA listei și a formularului de creare; CTA -> formularul de creare", () => {
  assert.equal((tab.match(/Poți câștiga și din recomandări/g) || []).length, 1);
  assert.match(tab, /Creează colecții cu produsele tale și cu produse de la alți creatori Artfest\. Dacă o\s+comandă eligibilă pornește din colecția ta, poți primi remunerație de recomandare\./);
  assert.match(tab, /Produsele tale pot beneficia de comision redus, iar produsele altor creatori îți pot\s+aduce remunerație din recomandări eligibile\./);
  assert.match(tab, /className=\{`\$\{styles\.primary\} \$\{styles\.earnCta\}`\} onClick=\{goToCreateForm\}/);
  assert.match(tab, />\s*Creează o colecție\s*</);

  // CTA: aceeași pagină - formularul de creare, scroll + focus pe titlu
  assert.match(tab, /function goToCreateForm\(\) \{\s*startNewCollection\(\);/);
  assert.match(tab, /editorFormRef\.current\?\.scrollIntoView/);
  assert.match(tab, /titleInputRef\.current\?\.focus/);
  assert.match(tab, /ref=\{titleInputRef\}/);

  // ordinea în pagină: banner -> layout (listă + formular / editor)
  assert.ok(tab.indexOf('aria-labelledby="earn-banner-title"') < tab.indexOf("className={styles.layout}"));
  assert.match(tab, /data-mode=\{isCreating \? "create" : "edit"\}/);
});

/* ---------- scroll / layout ---------- */

const css = read("./VendorCollectionsTab.module.css");

test("scroll desktop: un scroll în listă, unul în editor; plafon doar pe rezultatele marketplace; bară sticky", () => {
  const desktop = css.slice(css.lastIndexOf("/* ================= Scroll: un scroll în listă"));
  assert.match(desktop, /\.layout \{\s*height: calc\(100vh - var\(--appbar-h\) - 24px\);/);
  assert.match(desktop, /\.sidebar \.list \{\s*flex: 1 1 auto;[\s\S]*?overflow-y: auto;/);
  assert.match(desktop, /\.editor \{\s*align-content: start;[\s\S]*?overflow-y: auto;/);
  assert.match(desktop, /\.editor \.resultsGrid \{\s*max-height: min\(520px, 58vh\);/);
  assert.doesNotMatch(desktop, /\.editor \.grid \{\s*max-height/, "fără al doilea scroll imbricat pe produsele din colecție");
  assert.match(desktop, /\.editorBar \{\s*position: sticky;\s*top: 0;/);

  // bara: salvarea trimite același formular (atributul form)
  assert.match(tab, /form="collection-settings-form"/);
  assert.match(tab, /<form id="collection-settings-form"/);
  assert.match(tab, /className=\{`\$\{styles\.grid\} \$\{styles\.resultsGrid\}`\}/);
});

test("scroll mobil: fără scroll intern; listă și produse scurtate, cu „Vezi toate”", () => {
  assert.match(css, /\.sidebar \.list \{\s*max-height: none;\s*overflow: visible;/);
  assert.match(css, /@media \(max-width: 1023px\) \{\s*\.listItemExtra \{\s*display: none;/);
  assert.match(tab, /Vezi toate colecțiile \(\$\{collections\.length\}\)/);
  assert.match(tab, /Vezi toate produsele \(\$\{items\.length\}\)/);
  assert.match(tab, /window\.matchMedia\?\.\("\(max-width: 1023px\)"\)\.matches/);
});

/* =========================================================
   Admin Order Details: sursa vânzării (Own sale / Vendor referral /
   VendorCollection / Influencer / cod / campanie), grupurile de comision
   și eticheta per item. Mutat din adminOrderAttribution.test.js.
========================================================= */

const {
  getShipmentSource,
  getShipmentSourceKeys,
  getOrderSourceSummary,
  getCommissionGroupLabel,
  getItemAttributionLabel,
  getOrderModeLabel,
  formatConfigurationEntries,
} = await import("../../../Admin/AdminDesktop/tabs/adminOrderAttribution.js");

const adminItem = (extra = {}) => ({ productId: "p", vendorCollectionSlugSnapshot: null, vendorCollectionIdSnapshot: null, discountCodeId: null, ...extra });

test("sursa vânzării: fiecare tip are eticheta lui (nimic nu mai cade pe „Direct”)", () => {
  assert.equal(getShipmentSource({ items: [adminItem()] }), "Direct");
  assert.equal(getShipmentSource({ vendorReferralCommissionOverrideBps: 500, referrerVendorReferralCodeSnapshot: null, items: [adminItem()] }), "Own sale 5%");
  assert.equal(getShipmentSource({ referrerVendorId: "A", referrerVendorReferralCodeSnapshot: "atelier-a", items: [adminItem()] }), "Vendor referral");
  assert.equal(
    getShipmentSource({ referrerVendorId: "A", referrerVendorReferralCodeSnapshot: "COLLECTION:colectia-a", items: [adminItem({ vendorCollectionSlugSnapshot: "colectia-a" }), adminItem()] }),
    "VendorCollection (referral)"
  );
  assert.equal(
    getShipmentSource({ vendorReferralCommissionOverrideBps: 500, referrerVendorReferralCodeSnapshot: "COLLECTION:colectia-a", items: [adminItem({ vendorCollectionSlugSnapshot: "colectia-a" })] }),
    "VendorCollection (own sale 5%)"
  );
  assert.equal(getShipmentSource({ influencerId: "inf-1", items: [adminItem()] }), "Influencer");
  assert.equal(getShipmentSource({ influencerId: "inf-1", items: [adminItem({ discountCodeId: "dc" })] }), "Influencer (cod de reducere)");
  assert.equal(getShipmentSource({ items: [adminItem({ discountCodeId: "dc" })] }), "Cod de reducere");
  assert.equal(getShipmentSource({ campaignId: "camp-a", items: [adminItem()] }), "Campanie (legacy)");
});

test("shipment mixt: colecție proprie + campanie / referral extern + own-sale colecție -> ambele surse", () => {
  // A1 colecție own-sale + A2 campanie + A3 plan
  assert.deepEqual(
    getShipmentSourceKeys({ vendorReferralCommissionOverrideBps: 500, referrerVendorReferralCodeSnapshot: "COLLECTION:colectia-a", campaignId: "camp-a", items: [adminItem({ vendorCollectionSlugSnapshot: "colectia-a" }), adminItem(), adminItem()] }),
    ["VENDOR_COLLECTION_OWN_SALE", "CAMPAIGN"]
  );
  // ?ref= al lui B pe shipment-ul lui A + colecția proprie a lui A
  assert.equal(
    getShipmentSource({ referrerVendorId: "B", referrerVendorReferralCodeSnapshot: "atelier-b", vendorReferralCommissionOverrideBps: 500, items: [adminItem({ vendorCollectionSlugSnapshot: "selectie-a" }), adminItem()] }),
    "Vendor referral + VendorCollection (own sale 5%)"
  );
});

test("sumarul comenzii: o singură sursă sau „Surse multiple”", () => {
  assert.equal(getOrderSourceSummary({ shipments: [{ items: [] }] }), "Direct");
  assert.equal(
    getOrderSourceSummary({ shipments: [{ vendorReferralCommissionOverrideBps: 500, items: [] }, { referrerVendorId: "A", referrerVendorReferralCodeSnapshot: "COLLECTION:x", items: [] }] }),
    "Surse multiple"
  );
});

test("grupuri de comision: etichete reale, own-sale nu mai e „standard”", () => {
  assert.equal(getCommissionGroupLabel("vendor_collection_own_sale"), "Own-sale colecție");
  assert.equal(getCommissionGroupLabel("vendor_referral_own_sale"), "Own-sale (link / cod propriu)");
  assert.equal(getCommissionGroupLabel("campaign"), "Campanie");
  assert.equal(getCommissionGroupLabel("plan"), "Plan standard");
});

test("per item: rolul snapshot-ului (ca backend-ul), cod de reducere, tip produs, configurare", () => {
  const referralShipment = { referrerVendorId: "A", referrerVendorReferralCodeSnapshot: "COLLECTION:colectia-a" };
  assert.equal(getItemAttributionLabel(adminItem({ vendorCollectionSlugSnapshot: "colectia-a" }), referralShipment), "Referral colecție „colectia-a”");
  assert.equal(getItemAttributionLabel(adminItem({ vendorCollectionSlugSnapshot: "colectia-a" }), { vendorReferralCommissionOverrideBps: 500 }), "Own-sale colecție „colectia-a”");
  assert.equal(getItemAttributionLabel(adminItem(), referralShipment), null, "b2 în afara colecției - fără etichetă");
  assert.equal(getItemAttributionLabel(adminItem({ discountCodeId: "dc", discountCodeText: "TEO10" }), {}), "Cod de reducere TEO10");

  assert.equal(getOrderModeLabel("OPTIONS"), "Cu opțiuni");
  assert.equal(getOrderModeLabel("QUOTE_ONLY"), "Cerere de ofertă");
  assert.equal(getOrderModeLabel(null), null);

  assert.deepEqual(formatConfigurationEntries({ culoare: "rosu", marime: "M", gol: "" }), ["culoare: rosu", "marime: M"]);
  assert.deepEqual(formatConfigurationEntries({ invitati: [{ nume: "X" }] }), ['invitati: [{"nume":"X"}]']);
  assert.deepEqual(formatConfigurationEntries(null), []);
});

test("AdminOrdersTab folosește modulul (fără logica veche „standard” / Direct)", () => {
  const tab = read("../../../Admin/AdminDesktop/tabs/AdminOrdersTab.jsx");
  assert.match(tab, /from "\.\/adminOrderAttribution\.js";/);
  assert.doesNotMatch(tab, /g\.label === "campaign" \? "campanie" : "standard"/);
  assert.doesNotMatch(tab, /function getShipmentSource\(/);
  assert.match(tab, /<ItemAdminDetails item=\{it\} \/>/);
  assert.match(tab, /s\.vendorReferralCommission\.isReversed &&/);
  assert.match(tab, /s\.influencerCommission\.isReversed &&/);
});
