// src/ai/manifests/platformOverview.manifest.js

/*
 * Manifest general de prezentare a platformei - răspunde la
 * întrebări de tip "Ce este Artfest?" / "Ce pot face aici?",
 * indiferent dacă cel care întreabă e vizitator neautentificat,
 * cumpărător sau vânzător. NU e un manifest de funcționalitate
 * tehnică (endpoints/capabilities) - e strict knowledge general,
 * de orientare, construit din faptele deja confirmate în
 * celelalte manifeste (products, orders, quotes, vendorCampaigns,
 * catalogProducts, subscriptionsPlans etc.) - nu inventează nimic
 * nou, doar rezumă pe înțelesul oricui.
 */

export const PLATFORM_OVERVIEW_MANIFEST = {
  id: "platform-overview",

  title: "Ce este Artfest / prezentare generală",

  audience: ["GUEST", "USER", "VENDOR"],
  knowledgeAudience: ["GUEST", "USER", "VENDOR", "ADMIN"],

  available: true,
  status: "ACTIVE",

  tags: [
    "ce este artfest",
    "despre artfest",
    "prezentare platforma",
    "cum functioneaza artfest",
    "marketplace handmade",
    "pentru cine e artfest",
    "cine vinde produsele",
    "artfest stoc propriu",
    "cine expediaza produsul",
    "cum caut un produs",
    "cautare produse",
  ],

  aliases: [
    "ce este artfest",
    "ce e artfest",
    "despre ce e artfest",
    "ce pot face pe artfest",
    "ce pot face aici",
    "pentru cine este artfest",
    "cui se adreseaza artfest",
    "pot cumpara si vinde pe artfest",
    "cum functioneaza platforma",
    "cum functioneaza artfest",
    "ce fel de platforma este artfest",
    "ce vand pe artfest",
    "ce gasesc pe artfest",
    "artfest ce este",
    "cine vinde produsele de pe artfest",
    "cine sunt vanzatorii de pe artfest",
    "produsele sunt ale artfest",
    "artfest are stoc propriu",
    "aveti stoc propriu",
    "aveti voi produsele",
    "cine realizeaza produsul",
    "cine expediaza produsul",
    "cine livreaza produsul",
    "cine trimite comanda",
    "artfest fabrica produsele",
    "cum caut un produs pe artfest",
    "cum caut produse",
    "cum gasesc produse pe artfest",
    "unde caut produse",
    "cum functioneaza cautarea",
    "cum folosesc bara de cautare",
    "cum imi creez cont de vanzator",
    "cum devin vanzator",
    "vreau sa vand pe artfest",
    "vreau sa imi deschid magazin",
    "vreau cont de creator",
    "cum imi fac magazin pe artfest",
    "cont de vanzator",
    "cont de creator",
    "creare cont de vanzator",
    "inregistrare vanzator",
    "devino partener",
  ],

  uiLocations: [
    { audience: "GUEST", path: "/" },
    { audience: "USER", path: "/" },
    { audience: "VENDOR", path: "/" },
  ],

  capabilities: {
    browseAndBuy: { available: true, status: "ACTIVE" },
    requestCustomOrders: { available: true, status: "ACTIVE" },
    sellAsVendor: { available: true, status: "ACTIVE" },
  },

  limitations: [],

  unavailableFeatures: [],

  endpoints: {},

  description:
    "Artfest este un marketplace românesc pentru produse handmade, personalizate și pentru evenimente (nunți, botezuri, cadouri, decorațiuni etc.), care conectează direct cumpărătorii cu creatorii/vânzătorii independenți.",

  faq: [
    {
      q: "Ce este Artfest?",
      a: "Artfest este un marketplace românesc dedicat produselor handmade, personalizate și pentru evenimente - nunți, botezuri, cadouri, decorațiuni și altele. Conectează direct cumpărătorii cu creatorii/artizanii care fac aceste produse, fără intermediari clasici de tip magazin.",
    },
    {
      q: "Ce pot face pe Artfest?",
      a: "Ca vizitator sau cumpărător: cauți și răsfoiești produse, le cumperi direct din coș, ceri o ofertă personalizată (fie public, la care pot răspunde mai mulți vânzători, fie direct unui vânzător anume), urmărești magazine, lași recenzii, salvezi produse la favorite. Ca vânzător: îți creezi propriul magazin, îți adaugi produsele (unul câte unul sau în bulk, din Excel/CSV), gestionezi comenzi și mesaje cu clienții, poți face campanii proprii de promovare cu comision redus, urmărești costuri și profit, primești facturi.",
    },
    {
      q: "Pentru cine este Artfest?",
      a: "Pentru oricine caută un produs handmade sau personalizat - de la cadouri și decorațiuni, la tot ce ține de organizarea unui eveniment - și pentru creatorii/artizanii care vor să-și vândă propriile produse, fără să investească într-un magazin online separat.",
    },
    {
      q: "Pot cumpăra și vinde pe Artfest?",
      a: "Da - contul tău de cumpărător (User) și contul de vânzător (Vendor) sunt roluri distincte, dar aceeași persoană poate avea ambele. Ca vânzător, îți creezi un magazin propriu în platformă; ca cumpărător, cumperi normal, ca pe orice marketplace.",
    },
    {
      q: "Cum funcționează platforma?",
      a: "Vânzătorii își listează produsele în propriul magazin din Artfest - fiecare produs poate fi cumpărat direct, cu opțiuni de personalizare (culoare, mărime, mesaj etc.), sau disponibil doar la cerere de ofertă, dacă necesită o discuție înainte de preț. Cumpărătorii răsfoiesc, adaugă în coș și plătesc (card sau ramburs), sau cer o ofertă personalizată direct unui vânzător ori public, la care pot răspunde mai mulți. Artfest se ocupă de platformă, plăți și comunicare - fiecare vânzător își gestionează propriile produse, comenzi și livrare.",
    },
    {
      q: "Ce tip de produse găsesc pe Artfest?",
      a: "În principal produse handmade și personalizate: decorațiuni, cadouri, invitații, accesorii, produse pentru evenimente (nunți, botezuri) și altele create manual de artizani independenți - nu produse de masă, fabricate industrial.",
    },
    {
      q: "Cum devin vânzător pe Artfest?",
      a: "Îți creezi un cont de vânzător (buton „Devino partener” - un formular de înregistrare separat de cel de cumpărător, unde alegi direct modul vânzător). După ce contul e creat, ești dus la pașii de configurare a magazinului (ce servicii oferi, apoi detaliile magazinului) - de acolo îți poți adăuga produsele și începe să vinzi.",
    },
    {
      q: "Vreau să vând pe Artfest / vreau să îmi deschid un magazin / vreau cont de creator",
      a: "Sigur - îți poți crea un cont de vânzător chiar acum, apoi configurezi magazinul Artfest pas cu pas.",
    },
    {
      q: "Cine vinde produsele de pe Artfest?",
      a: "Toate produsele sunt vândute de creatori/vânzători independenți, fiecare cu propriul magazin în platformă - Artfest este marketplace-ul care îi conectează cu cumpărătorii, nu vinde el însuși produse.",
    },
    {
      q: "Artfest are stoc propriu?",
      a: "Nu. Artfest nu deține și nu gestionează niciun stoc - fiecare vânzător își administrează singur produsele, disponibilitatea și realizarea/livrarea lor.",
    },
    {
      q: "Cine realizează și expediază produsul?",
      a: "Vânzătorul/creatorul care a listat produsul - el îl realizează (sau îl are deja pregătit, în funcție de disponibilitate) și tot el organizează expedierea. Artfest se ocupă de platformă, plăți și comunicare, nu de producție sau livrare fizică.",
    },
    {
      q: "Cum caut un produs pe Artfest?",
      a: "Ai mai multe opțiuni: bara de căutare din partea de sus a paginii (caută după text), categoriile și filtrele din pagina de produse (preț, culoare, material, ocazie etc.), sau poți cere direct asistentului să caute pentru tine - după descriere, buget, ocazie sau chiar după o fotografie.",
    },
  ],

  notes:
    "Manifest de orientare generală, nu de funcționalitate tehnică - conținutul e un rezumat, pe înțelesul oricui, al faptelor deja confirmate în manifestele products, orders, quotes, vendorCampaigns, catalogProducts, subscriptionsPlans, vendorStoreProfile. Nu introduce nicio funcție/regulă nouă. Creat 2026-08-26. Extins 2026-08-28 (audit GUEST): aliases/FAQ pentru \"cine vinde\"/\"stoc propriu\"/\"cine expediază\" (produse cădeau greșit pe product-search local, vezi AiAssistant.jsx detectAssistantIntent) și pentru \"cum caut un produs\" (bară de căutare + categorii/filtre + asistent) - căutarea efectivă prin bara de căutare/filtre e verificată din Products.jsx (searchRow, categoryRail, filtersModal); căutarea prin asistent, din assistantProducts.js (SHOPPING_ACTIONS: image-search, product-search, gift, budget).",
};
