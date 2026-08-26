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
      a: "Din contul tău, pornești procesul de înregistrare ca vânzător (onboarding) - completezi detaliile magazinului, apoi îți poți adăuga produsele și începe să vinzi.",
    },
  ],

  notes:
    "Manifest de orientare generală, nu de funcționalitate tehnică - conținutul e un rezumat, pe înțelesul oricui, al faptelor deja confirmate în manifestele products, orders, quotes, vendorCampaigns, catalogProducts, subscriptionsPlans, vendorStoreProfile. Nu introduce nicio funcție/regulă nouă. Creat 2026-08-26.",
};
