// src/pages/Vendor/Subscription/subscriptionPlansContent.js

/*
 * Conținutul paginii de abonamente BASIC / PRO / BUSINESS - DOAR prezentare.
 * Fără JSX, fără apeluri API - testabil cu node --test.
 *
 * IMPORTANT:
 * - PRO și BUSINESS sunt „În pregătire”: nu există în SubscriptionPlan
 *   (în DB sunt doar basic + vechile pro/premium inactive), nu au prețuri
 *   Stripe și nu pot fi activate. Comisioanele lor sunt VIITOARE - calculul
 *   real al comisioanelor (commissionBps + regula own-sale 5%) rămâne
 *   neschimbat. Plafonul BUSINESS (5.000 lei/lună) e o propunere comercială.
 * - Creditele AI sunt PROPUSE, neactivate: AI-ul nu e limitat pe plan.
 * - Personalizarea magazinului NU face parte din niciun abonament: e un
 *   serviciu separat, disponibil tuturor planurilor (inclusiv BASIC),
 *   doar prezentat (fără comandă/plată). Nu există editor vizual.
 * - Planul real al vendorului vine din /api/vendors/me/subscription/status
 *   (vezi resolveCurrentPlanView) - niciodată date fictive.
 */

export const PLAN_STATUS = {
  AVAILABLE: "available",
  COMING_SOON: "coming_soon",
};

/* Creditele AI propuse pe plan - încă neactivate (nicio limită efectivă). */
export const PROPOSED_AI_CREDITS = {
  basic: 30,
  pro: 150,
  business: 500,
};

/* Plafonul lunar propus pentru BUSINESS - de validat înainte de implementare. */
export const BUSINESS_PLATFORM_CAP_LABEL = "5.000 lei";

export const SUBSCRIPTION_PLANS = [
  {
    code: "basic",
    name: "BASIC",
    tagline: "Pentru a începe și a vinde pe Artfest",
    priceLabel: "0 lei",
    priceSuffix: "/lună",
    status: PLAN_STATUS.AVAILABLE,
    commissions: [
      {
        value: "12%",
        label: "comision standard pentru comenzile generate de Artfest",
      },
      {
        value: "5%",
        label: "comision pentru comenzile proprii eligibile, conform regulilor actuale",
      },
    ],
    features: [
      "Magazin standard Artfest",
      "Toate funcționalitățile gratuite existente",
      "Produse și magazine nelimitate, conform configurației actuale",
    ],
    aiCredits: PROPOSED_AI_CREDITS.basic,
  },
  {
    code: "pro",
    name: "PRO",
    tagline: "Pentru vânzătorii care își aduc singuri clienții",
    priceLabel: "99 lei",
    priceSuffix: "/lună",
    status: PLAN_STATUS.COMING_SOON,
    highlighted: true,
    commissions: [
      {
        value: "0%",
        label: "comision Artfest pentru comenzile proprii eligibile",
      },
      {
        value: "5%",
        label: "comision Artfest pentru comenzile aduse de platformă",
      },
    ],
    features: [
      "Magazin standard Artfest",
      "Toate funcționalitățile BASIC",
    ],
    aiCredits: PROPOSED_AI_CREDITS.pro,
  },
  {
    code: "business",
    name: "BUSINESS",
    tagline: "Pentru magazinele cu volum mare de vânzări",
    priceLabel: "249 lei",
    priceSuffix: "/lună",
    status: PLAN_STATUS.COMING_SOON,
    commissions: [
      {
        value: "0%",
        label: "comision Artfest pentru comenzile proprii eligibile",
      },
      {
        value: "0%",
        label: `comision Artfest pentru primii ${BUSINESS_PLATFORM_CAP_LABEL} pe lună din vânzările atribuite platformei`,
      },
      {
        value: "5%",
        label: `comision Artfest doar pentru partea din vânzările atribuite platformei care depășește ${BUSINESS_PLATFORM_CAP_LABEL} pe lună`,
      },
    ],
    features: [
      "Magazin standard Artfest",
      "Toate funcționalitățile PRO",
      "Rapoarte financiare și comerciale avansate (planificat)",
      "Automatizări suplimentare (planificat)",
      "Suport prioritar, în condițiile care vor fi stabilite",
    ],
    aiCredits: PROPOSED_AI_CREDITS.business,
  },
];

export const AI_CREDITS_NOTE = "propunere, încă neactivată";

/*
 * Notă afișată sub carduri - clarifică faptul că valorile PRO/BUSINESS
 * sunt viitoare, că plafonul și creditele AI sunt propuneri și că
 * personalizarea e separată.
 */
export const PLANS_FOOTNOTE =
  "Comisioanele PRO și BUSINESS se vor aplica doar după activarea planurilor; " +
  "până atunci, toate comenzile urmează regulile actuale ale planului BASIC. " +
  `Plafonul BUSINESS de ${BUSINESS_PLATFORM_CAP_LABEL}/lună și creditele AI sunt propuneri, încă neactivate. ` +
  "Comisioanele de recomandare ale terților (ex. influenceri) se tratează separat. " +
  "Personalizarea magazinului nu este inclusă în abonamente - este un serviciu separat.";

/*
 * Tabelul „Compară toate beneficiile”. Valori: true (inclus), false
 * (neinclus) sau un text scurt explicit.
 */
export const COMPARISON_GROUPS = [
  {
    title: "Preț și comisioane",
    rows: [
      { label: "Preț lunar", values: ["0 lei", "99 lei", "249 lei"] },
      {
        label: "Comenzi proprii eligibile",
        values: ["5% comision", "0% comision", "0% comision"],
      },
      {
        label: "Comenzi aduse de platformă",
        values: [
          "12% comision",
          "5% comision",
          `0% până la ${BUSINESS_PLATFORM_CAP_LABEL}/lună, 5% peste plafon`,
        ],
      },
    ],
  },
  {
    title: "Magazin pe Artfest",
    rows: [
      { label: "Magazin standard Artfest", values: [true, true, true] },
      { label: "Funcționalitățile gratuite existente", values: [true, true, true] },
      { label: "Produse și magazine nelimitate", values: [true, true, true] },
    ],
  },
  {
    title: "Credite AI (propunere, neactivată)",
    rows: [
      {
        label: "Credite AI pe lună",
        values: [
          `${PROPOSED_AI_CREDITS.basic} credite`,
          `${PROPOSED_AI_CREDITS.pro} credite`,
          `${PROPOSED_AI_CREDITS.business} credite`,
        ],
      },
    ],
  },
  {
    title: "Funcționalități BUSINESS",
    rows: [
      { label: "Rapoarte financiare și comerciale avansate", values: [false, false, "Planificat"] },
      { label: "Automatizări suplimentare", values: [false, false, "Planificat"] },
      { label: "Suport prioritar", values: [false, false, "Condiții în curs de stabilire"] },
    ],
  },
  {
    title: "Personalizare magazin",
    rows: [
      {
        label: "Serviciu separat, cu plată unică",
        values: ["Disponibil separat", "Disponibil separat", "Disponibil separat"],
      },
    ],
  },
];

/*
 * Servicii de personalizare - SEPARATE de abonamente, disponibile pentru
 * toate planurile. Doar prezentate: fără comandă, formular sau plată.
 */
export const CUSTOMIZATION_SERVICES = [
  {
    code: "store",
    name: "Artfest Store Personalizat",
    priceLabel: "500 lei",
    priceNote: "plată unică",
    includes: [
      "Personalizare pornind de la un șablon Artfest",
      "Culori și fonturi",
      "Logo și bannere",
      "Meniu propriu",
      "Organizarea paginii principale și a colecțiilor",
      "Pagină de prezentare a brandului",
      "Optimizarea aspectului pe mobil",
      "O rundă de revizuiri",
      "Conectarea unui domeniu propriu, dacă funcționalitatea va fi implementată",
      "Identitate vizuală proprie, în limitele legale",
    ],
    note:
      "Disponibil pentru toate planurile, inclusiv BASIC. Costul domeniului și " +
      "eventualele servicii recurente vor fi comunicate separat.",
  },
  {
    code: "unique",
    name: "Design Unic",
    priceLabel: "de la 1.499 lei",
    priceNote: "ofertat în funcție de complexitate",
    includes: [
      "Design vizual individual",
      "Structură adaptată identității brandului",
      "Ofertă separată, în funcție de complexitate",
    ],
    note: "Dezvoltările complet personalizate nu sunt incluse automat în acest tarif.",
  },
];

export const CUSTOMIZATION_AVAILABILITY_NOTE =
  "Serviciile de personalizare sunt separate de abonamente și vor fi disponibile " +
  "pentru toate planurile, inclusiv BASIC. Nu pot fi comandate încă.";

/*
 * Cum va decurge serviciul (pagina „Design magazin”) - realizat de echipa
 * Artfest, NU de vânzător într-un editor (editorul nu există).
 */
export const CUSTOMIZATION_STEPS = [
  { title: "Discuție inițială", text: "Ne spui ce vinzi, cui te adresezi și cum vrei să arate magazinul." },
  { title: "Propunere vizuală", text: "Echipa Artfest pregătește aspectul pornind de la un șablon sau de la zero (Design Unic)." },
  { title: "Revizuire", text: "Verifici rezultatul și ceri ajustări, în limita rundelor incluse." },
  { title: "Publicare", text: "Echipa Artfest publică varianta aprobată de tine." },
];

/*
 * Transformă răspunsul real de la GET /api/vendors/me/subscription/status
 * într-o vedere pentru UI. Nu inventează nimic: dacă răspunsul lipsește
 * sau nu are plan, întoarce state "none"/"unknown".
 *
 * - planCode: codul REAL din DB (basic / pro / premium / ...)
 * - matchedCard: codul cardului nou care corespunde planului actual -
 *   doar "basic" poate fi activ azi; vechile pro/premium (inactive) nu
 *   se mapează pe noile PRO/BUSINESS (prețuri și reguli diferite).
 */
export function resolveCurrentPlanView(status) {
  if (!status || typeof status !== "object") {
    return { state: "unknown" };
  }

  if (status.ok === false || !status.plan) {
    return { state: "none" };
  }

  const plan = status.plan;
  const planCode = String(plan.code || "").toLowerCase();
  const commissionBps = Number.isFinite(Number(plan.commissionBps))
    ? Number(plan.commissionBps)
    : null;

  return {
    state: "active",
    planCode,
    planName: plan.name || planCode.toUpperCase(),
    priceCents: Number.isFinite(Number(plan.priceCents)) ? Number(plan.priceCents) : null,
    commissionBps,
    status: status.status || null,
    endAt: status.endAt || null,
    isFree: planCode === "basic" || Number(plan.priceCents) === 0,
    matchedCard: planCode === "basic" ? "basic" : null,
  };
}

export function formatBpsPercent(bps) {
  if (bps === null || bps === undefined || !Number.isFinite(Number(bps))) return "";
  const pct = Number(bps) / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1).replace(".", ",")}%`;
}
