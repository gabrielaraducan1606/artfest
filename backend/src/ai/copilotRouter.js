// backend/src/ai/copilotRouter.js

/*
 * Strat de orchestrare GENERAL, deasupra clasificatorului existent
 * din assistantChatRoutes.js - NU îl înlocuiește. Fluxul:
 *
 *   mesaj
 *   -> conversationContext.activeAction (o acțiune înregistrată
 *      activă - PLATFORM_ACTION, FAZA 6/7) SAU
 *      conversationContext.activeIntent === "SUPPORT_TROUBLESHOOT"
 *      (o problemă de suport în curs de triaj - FAZA 8-10) ->
 *      CONTINUĂ direct, fără reclasificare
 *   -> classifyCopilotMessage (8 categorii generale)
 *   -> PLATFORM_KNOWLEDGE / PLATFORM_ACTION -> tratat AICI (knowledge
 *      retrieval + manifeste / action registry)
 *   -> ACCOUNT_HELP/ORDER_HELP/PAYMENT_HELP/INCIDENT_OR_BUG/
 *      HUMAN_SUPPORT -> tratat AICI, prin
 *      supportEscalationService.js (FAZA 8-10): încearcă să rezolve
 *      cu AI + knowledge, cere max 1-2 clarificări, și DOAR dacă nu
 *      reușește propune un tichet (cu confirmare explicită) -
 *      reutilizează endpoint-ul existent de creare tichet, nu scrie
 *      nimic direct de aici.
 *   -> GENERAL_CONVERSATION / flow existent stabil (product_search,
 *      image_search, quote) -> { handled: false }, apelantul cheamă
 *      mai departe assistantChatRoutes.js, EXACT ca azi.
 *
 * PLATFORM_ACTION reutilizează 100% logica deja existentă din
 * vendorAssistantCommandService.js (Vendor Assistant / Costuri &
 * Profit) prin actionRegistry.js - același whitelist, aceeași
 * rezolvare de ownership, ACELAȘI pendingAction/confirmare, nicio
 * scriere directă în DB de aici.
 */

import { openai } from "../lib/openai.js";
import { getRelevantPlatformKnowledge } from "./knowledgeRetrieval.js";
import { tokenizeSearchText } from "../lib/textRelevance.js";

import {
  isRegisteredAction,
  getActionEntry,
  ACTION_HANDLERS,
} from "./actionRegistry.js";

import { getPlatformManifests } from "./manifests/index.js";

import {
  buildPrompt as buildVendorAssistantPrompt,
  dispatchCommand,
  handleUpdateProduct,
} from "../services/vendorAssistantCommandService.js";

import { resolveVendorByUserId } from "../services/costProfitService.js";

/*
 * BATCH 2 (audit regression Vendor Assistant, 2026-09-06) - "Statistici/
 * performanță" (trafic, vizite, vizualizări de produse, surse de trafic).
 * Serviciu subțire, read-only, care reutilizează EXACT modelele Prisma
 * deja folosite de pagina reală /vendor/visitors (vendorVisitorsRoutes.js)
 * - vezi comentariile din vendorAssistantAnalytics.js.
 */
import { answerVendorVisitorAnalyticsQuestion } from "../services/vendorAssistantAnalytics.js";

/*
 * BATCH 3 (audit regression Vendor Assistant, 2026-09-06) - "Cereri de
 * ofertă / CRM lead status" (câte cereri am, noi/în discuții/ofertă
 * trimisă/rezervate/pierdute). Reutilizează EXACT câmpul Prisma
 * MessageThread.leadStatus deja folosit de PATCH .../meta-advanced și
 * GET /api/inbox/threads?status=... (vendorMessageRoutes.js) - vezi
 * comentariile din vendorAssistantQuoteLeads.js.
 */
import { answerVendorQuoteLeadQuestion } from "../services/vendorAssistantQuoteLeads.js";

/*
 * BATCH 4 (audit regression Vendor Assistant, 2026-09-06) - "Comenzi"
 * (câte comenzi am / noi / în lucru / așteaptă expedierea / livrate /
 * anulate / plătite). Reutilizează EXACT granularitatea de
 * shipment.status deja folosită de PATCH /api/vendor/orders/:id/status
 * (vendorOrdersRoutes.js) - vezi comentariile din
 * vendorAssistantOrders.js.
 */
import { answerVendorOrderLiveQuestion } from "../services/vendorAssistantOrders.js";

/*
 * BATCH D (audit regression Vendor Assistant, 2026-09-07) - "Promovări/
 * campanii" (sunt produsul zilei? / sunt artizanul săptămânii? / ce
 * promovări active am / ce campanii am active). Reutilizează EXACT
 * where-clause-urile deja folosite de GET /api/vendor/homepage-features
 * și GET /api/vendor/campaigns - vezi comentariile din
 * vendorAssistantPromotions.js.
 */
import { answerVendorPromotionsQuestion } from "../services/vendorAssistantPromotions.js";

/*
 * BATCH E (audit regression Vendor Assistant, 2026-09-07) - "câte
 * recenzii am / ratingul meu / câte notificări necitite am".
 * Reutilizează EXACT query-urile din GET /vendors/me/reviews/kpi
 * (reviewsProductRoutes.js) + StoreRatingStats + GET /vendor/
 * notifications/unread-count (vendorNotificationsRoutes.js) - vezi
 * comentariile din vendorAssistantReviews.js.
 */
import { answerVendorReviewsQuestion } from "../services/vendorAssistantReviews.js";

/*
 * BATCH 5 (audit regression Vendor Assistant, 2026-09-06) - "Plăți/
 * facturi/Stripe/comision" (cât am câștigat / ce comision datorez / ce
 * facturi sunt neachitate / ce comision am plătit luna trecută).
 * Reutilizează EXACT modelele VendorEarningEntry/Invoice deja folosite
 * de vendorInvoices.js/adminInvoicesRoutes.js - vezi comentariile din
 * vendorAssistantPayments.js.
 */
import { answerVendorPaymentsQuestion } from "../services/vendorAssistantPayments.js";

/*
 * BATCH 2 (FINAL GAP PASS, 2026-09-07) - 4 domenii noi, exact același
 * pattern subțire/read-only ca cele de mai sus. Vezi comentariile din
 * fiecare fișier pentru sursa de adevăr (query-uri reutilizate, nu
 * duplicate).
 */
import { answerVendorProductQuestion } from "../services/vendorAssistantProducts.js";
import { answerVendorSalesQuestion } from "../services/vendorAssistantSales.js";
import { answerVendorMessagesQuestion } from "../services/vendorAssistantMessages.js";
import { answerVendorSupportQuestion } from "../services/vendorAssistantSupport.js";
import { answerUserMessagesQuestion } from "../services/userAssistantMessages.js";
import { answerUserQuotesQuestion } from "../services/userAssistantQuotes.js";
import { answerUserNotificationsQuestion } from "../services/userAssistantNotifications.js";
import { answerUserSupportQuestion } from "../services/userAssistantSupport.js";
import { answerUserReviewsQuestion } from "../services/userAssistantReviews.js";

import { prisma } from "../db.js";

import {
  cancelOwnOrder,
  computeUiStatus,
} from "../routes/userOrdersRoutes.js";

import {
  SUPPORT_DECISIONS,
  SUPPORT_INTELLIGENCE_CATEGORIES,
  evaluateSupportRequest,
  buildTicketDraft,
  detectYesNo,
  mapEntityTypeToEntities,
} from "./supportEscalationService.js";

import {
  getVendorInsights,
  getInsightItemsList,
} from "./insightsService.js";

/*
 * INFLUENCER (FAZA 2) - reutilizează STRICT funcțiile determinste
 * deja construite în influencerAssistantCommands.js (niciun calcul
 * nou aici) și requireActiveInfluencer din influencerRoutes.js
 * (aceeași verificare de rol/status ca ruta HTTP reală
 * GET /api/influencer/me etc.).
 */
import { requireActiveInfluencer } from "../routes/influencerRoutes.js";

import {
  detectInfluencerQueryScope,
  composeInfluencerAnswer,
  getInfluencerSummary,
  getInfluencerResources,
  getInfluencerOrders,
  getInfluencerEarnings,
  getInfluencerCollections,
  getInfluencerDiscountCodes,
  getInfluencerTodayRecommendations,
} from "../services/influencerAssistantCommands.js";

const ROUTER_MODEL = "gpt-4.1-mini";

export const COPILOT_CATEGORIES = [
  "HELP_OVERVIEW",
  "PLATFORM_KNOWLEDGE",
  "PLATFORM_ACTION",
  "VENDOR_INSIGHTS",
  "ACCOUNT_HELP",
  "ORDER_HELP",
  "PAYMENT_HELP",
  "INCIDENT_OR_BUG",
  "HUMAN_SUPPORT",
  "GENERAL_CONVERSATION",
];

function safeJsonParse(text) {
  let raw = String(text || "").trim();

  raw = raw
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch {
    // încercăm să extragem obiectul JSON
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function buildClassifierPrompt({
  message,
  history,
  audience,
}) {
  return `
Ești routerul general al platformei Artfest (marketplace de produse handmade). Clasifici DOAR - nu răspunzi la întrebare, nu execuți nimic.

Rolul userului curent: ${audience || "USER"}. FOLOSEȘTE-L ACTIV la deciziile de mai jos (vezi în special EXISTING_FLOW și ORDER_HELP) - NU presupune un rol generic, aceleași cuvinte ("comenzile mele", "produsele mele") înseamnă lucruri diferite pentru un VENDOR (magazinul lui) față de un USER/GUEST (cumpărăturile lui).

PASUL 1 - determină ÎNTÂI intentMode-ul mesajului (înainte de orice categorie), pe baza FORMEI propoziției, NU a cuvintelor specifice din ea (nume de produse, integrări, magazine etc. - acelea sunt doar conținut, nu schimbă intentMode):

- EXPLAIN: mesajul e o ÎNTREBARE/formulare explicativă despre CUM funcționează, DACĂ există sau UNDE se găsește ceva. Marcatori tipici (de obicei la ÎNCEPUTUL propoziției): "cum", "cum pot", "cum fac", "cum se", "unde", "unde găsesc", "ce este", "ce înseamnă", "pot să"/"pot" (ca întrebare, nu comandă), "se poate", "există", "care este diferența", "de ce". Un EXPLAIN rămâne EXPLAIN chiar dacă în propoziție apare un verb care ARATĂ ca o comandă ("adaug", "șterg", "schimb") sau un nume propriu de integrare/serviciu extern (Shopify, EasySales, WooCommerce, Etsy etc.) - forma întrebătoare are ÎNTOTDEAUNA prioritate față de cuvintele individuale din ea. Exemple: "Cum adaug produse?", "Cum adaug produse cu Shopify?", "Cum adaug produse cu EasySales?", "Pot importa din WooCommerce?", "Unde import un Excel?", "Cum mut produsele din alt magazin?", "Cum funcționează variantele?", "Cum schimb prețul?", "Cum contactez suportul?", "Cum sincronizez Artfest cu Etsy?".

- EXECUTE: mesajul e o COMANDĂ/cerere directă, la modul imperativ sau cu "vreau să" + acțiune concretă asupra unei entități CONCRETE (chiar dacă lipsește un detaliu, ex. numele produsului) - NU e formulat ca întrebare. Exemple: "Adaugă un produs", "Schimbă prețul produsului X la 50 lei", "Pune stoc 5", "Creează-mi un produs din poza asta", "Șterge produsul", "Marchează comanda ca expediată".

- QUERY_LIVE_DATA: userul cere date REALE, ale contului lui, deja existente (nu întreabă cum funcționează ceva, cere să VADĂ ceva concret). Exemple: "Ce produse am fără stoc?", "Arată-mi produsele fără costing", "Ce comenzi am azi?".

- TROUBLESHOOT: userul RAPORTEAZĂ o problemă/eroare, fără să ceară explicit o explicație sau o acțiune. Exemple: "Nu merge importul Excel.", "Shopify nu funcționează.", "Îmi dă eroare.".

- MARKETPLACE_SEARCH: userul caută/descrie ce vrea să CUMPERE sau să descopere pe platformă - un produs, un cadou, ceva după o fotografie - fără să numească o funcționalitate a platformei și fără să ceară o acțiune asupra propriului magazin. NU contează rolul userului (USER, GUEST sau VENDOR - un vendor rămâne și cumpărător, vezi regula explicită mai jos). Marcatori: "caut", "vreau", "găsește-mi", "idei", numele unui obiect/ocazie/persoană ("cadou", "pentru mama", "pentru nuntă", "pentru botez"), o cerere despre DISPONIBILITATEA unui produs de cumpărat ("gata de livrare", "disponibil rapid", "livrare rapidă", "făcut la comandă", "disponibilitate produs" - astea descriu produsul căutat, NU o comandă existentă, vezi ATENȚIE de la ORDER_HELP), sau o cerere de căutare vizuală ("găsește produse asemănătoare cu poza asta", "unde găsesc ceva ca în imagine"). ATENȚIE: acest intentMode are prioritate față de EXPLAIN și EXECUTE ori de câte ori mesajul e despre a GĂSI/CUMPĂRA ceva concret de pe platformă, nu despre a afla CUM funcționează platforma și nu despre a modifica magazinul PROPRIU al vendorului. Exemple: "caut un cadou pentru mama", "idei cadou mama", "caut cutii pentru cadouri", "vreau ambalaje pentru lumânări", "găsește-mi ceva pentru nuntă", "caut un produs personalizat pentru copil", "găsește produse asemănătoare cu poza asta", "arată-mi produse gata de livrare", "vreau un produs disponibil rapid", "arată-mi produse făcute la comandă", "vreau un cadou până mâine".
  ATENȚIE la o confuzie frecventă cu EXPLAIN: "cum găsesc X" / "unde găsesc X" / "mă ajuți să găsesc X" / "cum caut X", unde X e un OBIECT DE CUMPĂRAT concret (un produs, un tip de produs, un cadou, ceva pentru o ocazie - ex. "mărturii pentru nuntă", "ceva sub 100 lei", "un cadou pentru botez") rămâne MARKETPLACE_SEARCH, NU EXPLAIN, chiar dacă începe cu "cum"/"unde" (marcatori EXPLAIN tipici) - userul vrea să i se arate rezultate, nu o explicație despre motorul de căutare. Diferența față de un EXPLAIN real: acolo X e o FUNCȚIONALITATE a platformei ("cum caut produse pe Artfest" fără să numească niciun obiect anume, "cum funcționează căutarea", "unde găsesc comenzile mele" - "comenzile mele" nu e un obiect de cumpărat) sau lipsește complet obiectul de cumpărat. Exemple MARKETPLACE_SEARCH: "cum găsesc mărturii pentru nuntă?", "unde găsesc invitații de botez?", "mă ajuți să găsesc ceva sub 100 lei?". Exemple EXPLAIN (rămân PLATFORM_KNOWLEDGE): "cum caut un produs pe Artfest?" (întreabă despre mecanismul de căutare în sine, fără niciun obiect concret), "unde găsesc comenzile mele?".
  NU confunda cu VENDOR_INSIGHTS: "recomandă-mi un cadou"/"idei de cadou" (cere SĂ I SE ARATE produse de cumpărat) e MARKETPLACE_SEARCH, dar "ce recomandări ai?"/"ce îmi recomanzi?"/"ai recomandări pentru mine?" (fără obiect de cumpărat, despre STAREA CONTULUI/magazinului vendorului) rămâne ÎNTOTDEAUNA VENDOR_INSIGHTS - vezi definiția și regulile VENDOR_INSIGHTS mai jos, care au prioritate.
  BUGFIX (audit Guest Batch 3, 2026-09-08) - CONTINUARE eliptică a unui subiect PLATFORM_KNOWLEDGE: dacă ultima tură din istoricul conversației a fost PLATFORM_KNOWLEDGE pe un subiect clar (NU MARKETPLACE_SEARCH), și mesajul curent e un follow-up scurt, eliptic, care întregește ACEEAȘI întrebare fără verb de căutare/cumpărare ("Și telefonul?", "Și emailul?", "Și adresa?", "Cât este?", "Și ramburs?" și similare - de regulă începe cu "Și"/"Dar" sau e doar o sintagmă scurtă, fără "vreau"/"caut"/"găsește-mi"/"idei") - NU devine MARKETPLACE_SEARCH doar pentru că substantivul din el (ex. "telefon", "adresă") ar putea fi și un produs de cumpărat în alt context; rămâne PE ACELAȘI subiect ca tura anterioară (de regulă tot PLATFORM_KNOWLEDGE). Diferența față de o căutare reală: un verb explicit de căutare/cumpărare ("Vreau un telefon.", "Caut o adresă de..." - dacă ar exista un asemenea produs) rămâne MARKETPLACE_SEARCH normal, INDIFERENT de istoric - regula asta se aplică STRICT unui follow-up fără verb propriu, care nu are sens de sine stătător ca o căutare nouă.

PASUL 2 - alege categoria pe baza intentMode-ului determinat la pasul 1:
- intentMode MARKETPLACE_SEARCH → ÎNTOTDEAUNA EXISTING_FLOW, cu prioritate față de orice altă regulă din acest pas - inclusiv când mesajul conține "vreau"/un verb care ar putea părea EXECUTE ("vreau ambalaje pentru lumânări" NU e o cerere de a adăuga un cost/produs în magazinul propriu, e o căutare de cumpărător pe marketplace) sau când seamănă cu o întrebare EXPLAIN ("idei cadou" nu întreabă cum funcționează ceva). Diferența față de o cerere de acțiune asupra magazinului propriu: MARKETPLACE_SEARCH nu numește NICIODATĂ o entitate din contul vendorului (propriul produs/comandă/cost) - descrie ce caută userul SĂ CUMPERE, generic.
- intentMode EXPLAIN → aproape întotdeauna PLATFORM_KNOWLEDGE. DOUĂ EXCEPȚII OBLIGATORII, cu prioritate față de orice altă regulă din acest pas:
  1. orice mesaj EXPLAIN despre recomandările/sugestiile/atenția/starea PROPRIE a vendorului ("Ce recomandări ai?", "Ce îmi recomanzi?", "Ai recomandări pentru mine?", "Ce îmi sugerezi?", "Cum merge magazinul meu?", "Ce ar trebui să verific?", "Cum funcționează recomandările [pentru mine]?" și orice altă formulare echivalentă) NU este PLATFORM_KNOWLEDGE, este ÎNTOTDEAUNA VENDOR_INSIGHTS - vezi definiția VENDOR_INSIGHTS și regulile explicite mai jos. Forma de întrebare ("ce", "ai", "cum funcționează") nu schimbă asta - aici userul vrea să i se arate recomandările live, nu o explicație despre mecanism.
  ACEEAȘI excepție #1, pentru un INFLUENCER (starea/recomandările PROPRII ale contului lui de influencer, nu ale unui magazin) - NU este PLATFORM_KNOWLEDGE, este ÎNTOTDEAUNA VENDOR_INSIGHTS: "Ce am de repostat?", "Ce trebuie să repostez?", "Ce produse noi sunt azi?", "Ce vânzători noi sunt azi?", "Ce să postez azi?", "Ce ar trebui să promovez?", "Ce funcționalități n-am mai promovat?", "Ce am de făcut azi?" și orice altă formulare echivalentă despre propriul cont de influencer.
  2. small talk/conversație casuală care conține din întâmplare un cuvânt de întrebare, dar NU întreabă nimic despre platformă ("Ce mai faci?", "Ce faci?", "Cum ești?", "Salut, ce mai e nou?") - acestea NU sunt PLATFORM_KNOWLEDGE, sunt ÎNTOTDEAUNA GENERAL_CONVERSATION. Diferența: dacă întrebarea nu numește NICIUN subiect/funcționalitate concretă a platformei (produs, cont, comandă, plată, vânzător, etc.), e small talk, nu o întrebare despre platformă - chiar dacă începe cu "ce"/"cum".
- intentMode EXECUTE → PLATFORM_ACTION DOAR dacă ținta e explicit o entitate din contul PROPRIU al vendorului (un produs/preț/stoc/comandă/cost/magazin pe care îl deține) sau flow-ul existent relevant (ADD_PRODUCT etc., tratat separat de acest router, vezi mai jos). Un "vreau X"/"adaugă X" fără nicio legătură cu magazinul propriu al vendorului (X e un obiect generic pe care userul vrea să îl găsească/cumpere, nu un produs/cost al LUI) e MARKETPLACE_SEARCH, nu EXECUTE.
  FIX #2 (FINAL E2E FIX PASS, 2026-09-07) - CONTINUARE de căutare marketplace: dacă istoricul conversației arată clar că ultima tură a fost o căutare de tip MARKETPLACE_SEARCH (userul căuta un produs/cadou de cumpărat, ex. "Vreau un cadou.", "Caut ceva pentru nuntă") și mesajul curent e o RAFINARE scurtă a acelei căutări - "mai ieftin"/"mai scump"/"altă variantă"/"altă culoare"/"personalizat"/"sub X lei"/"arată-mi alte opțiuni" și similare, FĂRĂ să numească explicit o entitate din magazinul PROPRIU (nu spune "produsele mele"/"comenzile mele"/"catalogul meu") - rămâne MARKETPLACE_SEARCH (deci EXISTING_FLOW), NICIODATĂ EXECUTE/PLATFORM_ACTION, indiferent de forma imperativă ("Arată-mi variante mai ieftine." pare o comandă, dar continuă căutarea de cumpărător, nu cere o acțiune asupra magazinului vânzătorului). Diferența: "Arată-mi PRODUSELE MELE mai ieftine"/"Arată-mi produsele mele" (menționează explicit magazinul propriu) rămâne EXECUTE/EXISTING_FLOW pe date proprii, ca de obicei - regula de mai sus se aplică STRICT când nu există nicio referire la "al meu"/"propriu"/"magazinul meu".
  EXCEPȚIE pentru INFLUENCER: o formă imperativă despre propriul cont de influencer ("Arată-mi colecțiile.", "Deschide colecțiile mele.", "Arată-mi resursele.", "Arată-mi comenzile.", "Arată-mi promovarea.", "Du-mă la resurse.", "Du-mă la comenzi." și orice altă formulare echivalentă) NU este PLATFORM_ACTION (nu există niciun handler PLATFORM_ACTION pentru un influencer, doar pentru vendor) - rămâne ORDER_HELP dacă e despre comenzi, altfel VENDOR_INSIGHTS (categoria deja folosită pentru datele live proprii ale influencerului, vezi excepția EXPLAIN de mai sus).
- intentMode QUERY_LIVE_DATA → EXISTING_FLOW sau VENDOR_INSIGHTS, NICIODATĂ PLATFORM_KNOWLEDGE (datele live nu vin din manifeste statice).
- intentMode TROUBLESHOOT → INCIDENT_OR_BUG (sau domeniul specific dacă e menționat explicit, vezi regulile de mai jos).

IMPORTANT: un EXPLAIN despre o integrare/metodă de import (Shopify, EasySales, WooCommerce, Excel, CSV, "mut produse din alt magazin", "sincronizare produse" etc.) e ÎNTOTDEAUNA PLATFORM_KNOWLEDGE, NICIODATĂ o comandă de adăugare produs - chiar dacă apare cuvântul "adaug"/"import" în propoziție. NU există o regulă specială doar pentru Shopify - aceeași regulă se aplică oricărei integrări sau metode menționate, cunoscută sau nu.

Categorii posibile:

- HELP_OVERVIEW: userul întreabă, generic, CE poate face asistentul pentru el / cu ce îl poate ajuta - NU despre O funcționalitate anume, ci despre GAMA de capabilități. Exemple: "Ce poți face pentru mine?", "Cu ce mă poți ajuta?", "Ce știi să faci?", "La ce mă poate ajuta asistentul?", "Ce pot face aici?", "Ce funcții ai?". Diferența față de PLATFORM_KNOWLEDGE: acolo userul întreabă despre O funcționalitate/concept anume (are un subiect concret - preț, retur, avans, devenire vânzător); aici userul întreabă despre asistent/platformă în ansamblu, fără subiect concret. Are prioritate față de PLATFORM_KNOWLEDGE - nu încerca să găsești un manifest pentru "ce poți face" per ansamblu, e generat dinamic din capabilitățile reale.
  ROL IPOTETIC: dacă mesajul menționează EXPLICIT un rol diferit de al userului curent - fie ca ipoteză ("dacă sunt client", "ca vizitator", "dacă aș fi vânzător"), fie ca intenție de schimbare de rol ("dacă vreau să devin vendor", "ca viitor vânzător") - extrage acel rol în "mentionedRole" ca unul din: "USER" (client/cumpărător autentificat), "VENDOR" (vânzător), "GUEST" (vizitator neautentificat). Dacă nu se menționează niciun rol explicit, "mentionedRole" e null. Acest rol schimbă DOAR PERSPECTIVA răspunsului (ce i-ai spune cuiva cu acel rol), NU permisiunile reale ale userului curent.

- PLATFORM_KNOWLEDGE: userul întreabă CUM funcționează ceva, ce este disponibil, indisponibil sau planificat pe platformă. Exemple: "Cum schimb prețul unui produs?", "Pot importa din Shopify?", "Cum programez curierul?", "Cum funcționează avansul?", "Cum cer o ofertă?".

- PLATFORM_ACTION: userul CERE explicit efectuarea unei acțiuni concrete, cu parametri identificabili (ce anume, la ce valoare). Exemple: "Schimbă prețul produsului X la 50 lei", "Pune stoc 5 la produsul Y", "Ascunde produsul Z", "Vreau să modific prețul unui produs" (chiar dacă lipsește produsul/valoarea - tot e o cerere de acțiune, doar incompletă). Diferența față de PLATFORM_KNOWLEDGE: aici userul vrea ca ceva să SE ÎNTÂMPLE acum, nu vrea să afle cum se face.

- VENDOR_INSIGHTS: INTENȚIA generală - vânzătorul cere o privire de ansamblu PROACTIVĂ asupra contului său: recomandări, sugestii, ce ar trebui să verifice/facă, ce necesită atenție, cum stă magazinul, ce probleme are - fără să numească un produs/comandă anume și fără să ceară o singură metrică precisă (aceea e EXISTING_FLOW, vezi mai jos). NU te lega de fraze exacte - recunoaște intenția indiferent de formulare: verbe ca "recomanzi"/"sugerezi"/"ar trebui să..." sau substantive ca "recomandări"/"sugestii"/"probleme"/"atenție", combinate cu o întrebare despre STAREA GENERALĂ a contului (nu despre CUM funcționează o funcționalitate anume - acela e PLATFORM_KNOWLEDGE). Exemple din TOATE formulările posibile: "Ce ar trebui să verific azi?", "Am ceva urgent?", "Ce produse au probleme?", "Ce comenzi necesită atenție?", "Cum merge magazinul meu?", "Ce recomandări ai?", "Ce îmi recomanzi?", "Ai recomandări pentru mine?", "Ce îmi sugerezi?", "Am ceva de făcut?", "Ce mai am de rezolvat?". Poate fi și restrânsă la un domeniu, dacă vânzătorul îl menționează ("recomandări pentru produse", "recomandări pentru comenzi", "recomandări pentru costuri") - tot VENDOR_INSIGHTS rămâne, doar cu scop mai îngust. Diferă de EXISTING_FLOW/"Ce produse am sub cost?" (acela e o interogare PRECISĂ, pe UN singur criteriu de profitabilitate deja calculat) - aici userul vrea o privire de ansamblu, peste mai multe domenii (produse, comenzi, cereri de ofertă), nu doar costuri.
  ATENȚIE la o confuzie posibilă: "recomandări"/"recomand" pentru VENDOR_INSIGHTS înseamnă sugestii despre CONTUL propriu al vânzătorului - e un cuvânt DIFERIT de "programul de recomandare"/"cod de recomandare"/"invit alți vânzători" (acela e programul de ambasadori, PLATFORM_KNOWLEDGE, alt subiect complet). Alege PLATFORM_KNOWLEDGE pentru recomandare/ambasadori DOAR dacă mesajul menționează EXPLICIT invitarea altor vânzători, cod/link de recomandare sau programul de ambasadori - altfel, orice "recomandare" despre ce ar trebui să facă VÂNZĂTORUL ÎNSUȘI e VENDOR_INSIGHTS, inclusiv "Cum funcționează recomandările [pentru mine]?" (nu există o pagină statică despre asta, cel mai util e să arăți recomandările reale, nu să explici mecanismul).
  ACELAȘI tipar, pentru un INFLUENCER (privire de ansamblu proactivă asupra propriului cont de influencer, nu al unui magazin) - tot VENDOR_INSIGHTS: "Ce fac azi?", "Ce să postez?", "Ce ar trebui să postez azi?", "Ce am de repostat?", "Ce n-am mai promovat?", "Care este produsul zilei?", "Care este artizanul săptămânii?", "Ce produse noi sunt azi?", "Ce vânzători noi sunt?", "Care este codul meu [de reducere]?", "Care este linkul meu?", "Ce colecții am?", "Cât am câștigat?" (câștigul influencerului, NU comisionul de vânzător).
  EXCEPȚIE explicită de la regula generală "NAVIGARE explicită spre o pagină = PLATFORM_KNOWLEDGE" (vezi mai jos, secțiunea Reguli): "Deschide produsul zilei"/"Deschide artizanul săptămânii" (formă IMPERATIVĂ, nu întrebare) rămân TOT VENDOR_INSIGHTS, la fel ca "Care este produsul zilei?" - userul vrea resursa REALĂ (cu link, dacă există), nu o explicație despre unde e pagina. Nu confunda cu o navigare generică fără subiect ("du-mă la resurse", "deschide comenzile") - acelea rămân PLATFORM_KNOWLEDGE, neschimbat.
  EXTINDERE (audit "recomandări magazin", suplimentar față de exemplele de mai sus, TOT VENDOR_INSIGHTS): "Ce aș putea îmbunătăți?", "Ce ai schimba tu la magazinul meu?", "Ce produse ar trebui să mai adaug?", "Ce produse ar trebui să promovez?", "Cum arată magazinul meu?", "Ce lipsește din profilul meu?", "Ce să fac azi ca să am mai multe șanse de vânzare?" - toate cer o privire proactivă asupra contului, nu un fapt punctual. "Ce lipsește din profilul meu?"/"Ce ar trebui să completez la profil?" (menționează explicit profilul/descrierea/logo-ul magazinului) rămâne VENDOR_INSIGHTS, nu PLATFORM_KNOWLEDGE, chiar dacă "profil" apare și ca navigare generică în altă parte - aici vânzătorul vrea ce lipsește REAL, nu unde e pagina de setări.
  CARVE-OUT explicit: "De ce nu am comenzi?"/"De ce nu vând?"/"De ce nu am vânzări?" (o întrebare CAUZALĂ, "de ce", despre lipsa comenzilor/vânzărilor) este VENDOR_INSIGHTS, NU EXISTING_FLOW, chiar dacă menționează "comenzi" - vânzătorul nu cere o listă/număr de comenzi (acela ar fi "Câte comenzi am?", tot EXISTING_FLOW ca înainte), cere o explicație/recomandare despre STAREA magazinului care ar putea influența vânzările (catalog mic, profil incomplet, listări slabe etc.) - exact ce oferă privirea de ansamblu VENDOR_INSIGHTS, nu un număr brut.

- ACCOUNT_HELP: probleme sau întrebări legate de cont, autentificare, parolă, email de verificare.

- ORDER_HELP: întrebări, probleme SAU cereri de date live despre comenzile PROPRII ale unui cumpărător (rolul curent USER/GUEST) - fie despre O comandă anume deja plasată ("comanda mea nu apare", "unde este comanda mea", "când ajunge coletul meu", "comanda mea a fost livrată", "AWB-ul comenzii"), fie despre lista comenzilor proprii ("ce comenzi am", "câte comenzi am plasat"). Rămâne ORDER_HELP indiferent dacă e o problemă (intentMode TROUBLESHOOT) sau o cerere simplă de date (intentMode QUERY_LIVE_DATA) - diferența dintre ele o face intentMode, nu categoria.
  ATENȚIE (BUGFIX audit Guest, 2026-09-08) la o confuzie frecventă cu MARKETPLACE_SEARCH: cuvântul "livrare"/"disponibil" SINGUR, fără referire la O COMANDĂ/COLET AL USERULUI, NU declanșează ORDER_HELP. "Gata de livrare"/"disponibil rapid"/"livrare rapidă"/"făcut la comandă"/"disponibilitate produs" descriu disponibilitatea unui PRODUS DE CUMPĂRAT (căutare pe marketplace, MARKETPLACE_SEARCH), nu statusul unei comenzi existente. ORDER_HELP cere o referire explicită și clară la o comandă/colet AL USERULUI - "comanda mea", "coletul meu", "comanda a fost livrată", un număr/ID de comandă, sau echivalent - fără o asemenea referire explicită, rămâne MARKETPLACE_SEARCH.
  Pentru un INFLUENCER, "comenzile mele"/"ce comenzi am adus"/"ce comenzi am generat" înseamnă comenzile ATRIBUITE prin promovarea lui (link/cod), nu comenzi de cumpărător - rămâne tot ORDER_HELP (aceeași formă de întrebare, doar sursa datelor diferă după rol).
  STRICT NU pentru rolul VENDOR - "comenzile mele"/"ce comenzi am" de la un VÂNZĂTOR înseamnă mereu comenzile primite în magazinul lui, categorie EXISTING_FLOW (vezi definiția de mai sus și regula explicită din secțiunea Reguli) - vânzătorul rămâne teoretic și cumpărător pe platformă, dar formularea neutră, fără alt context, se referă mereu la magazinul lui.

- PAYMENT_HELP: PROBLEME/incidente reale despre plată, facturare, comision, rambursare - ceva NU merge sau pare greșit ("nu îmi merge plata", "am fost taxat greșit", "nu am primit banii", "vreau un refund", "eroare Stripe", "problemă de încasare", "de ce nu apare comisionul corect"). NU include o întrebare GENERICĂ, informativă, despre CÂT/CUM funcționează plata/comisionul, fără nicio problemă raportată ("Cât e comisionul?", "Ce comision ia Artfest?", "Cât oprește Artfest?", "Ce procent ia platforma?", "Cât plătesc pe o comandă?") - acelea sunt EXPLAIN normal, deci PLATFORM_KNOWLEDGE (vezi definiția de mai sus și regula explicită din secțiunea Reguli).

- INCIDENT_OR_BUG: userul RAPORTEAZĂ o eroare/problemă tehnică, fără să fie neapărat clar ce domeniu ("nu merge", "îmi dă eroare", "nu pot", "s-a blocat", "nu apare").

- HUMAN_SUPPORT: userul cere EXPLICIT să vorbească cu un om/suport uman, sau să deschidă un tichet.

- GENERAL_CONVERSATION: conversație generală (salut, mulțumesc, small talk) sau orice nu se potrivește clar cu categoriile de mai sus.

- EXISTING_FLOW: mesajul se potrivește mai bine cu un flow deja existent și stabil al platformei, NU cu categoriile de mai sus:
  - căutare de produse (după text sau imagine), recomandări cadou, căutare după buget, cerere de ofertă personalizată (quote) formulată ca o cerere nouă de căutare/recomandare - ORICE mesaj cu intentMode MARKETPLACE_SEARCH (vezi PASUL 1/2) intră aici, INDIFERENT de rolul userului. Un vendor rămâne și cumpărător - "caut un cadou pentru mama"/"idei cadou mama"/"vreau ambalaje pentru lumânări" sunt EXISTING_FLOW și pentru un vendor autentificat, NU PLATFORM_KNOWLEDGE (nu există manifest de răspuns pentru asta) și NU PLATFORM_ACTION (nu e o cerere despre magazinul propriu);
  - ORICE întrebare despre DATELE PROPRII deja existente ale unui VÂNZĂTOR (rolul curent = VENDOR), despre gestiunea magazinului lui, care NU cere o schimbare explicită - acoperă TOATE domeniile lui de date live (BATCH 1, FINAL GAP PASS, 2026-09-07 - extins de la strict Costuri & Profit, care era singurul domeniu menționat aici când au fost adăugate celelalte 6 domenii live în copilotRouter.js, fără să se actualizeze și acest prompt - risc real de rutare greșită, corectat acum):
    - produse/costuri/profit: "Ce produse am sub cost?", "Cât mă costă produsul X?", "Ce profit am la produsul Y?", "Ce am în biblioteca de costuri?", "Recalculează produsele care folosesc X", "Recalculează toate produsele cu costuri neactualizate".
    - comenzi PRIMITE în magazinul lui: "Câte comenzi am?", "Ce comenzi noi am?", "Ce comenzi sunt livrate/anulate/plătite?", "Câte comenzi am avut luna asta?", "Ce comenzi mi-au adus câștig?".
    - trafic/vizite ale magazinului: "Câți oameni mi-au văzut magazinul?", "Ce produse sunt cele mai văzute?", "De unde vin vizitatorii?", "Câte vizite am avut azi?".
    - cereri de ofertă primite: "Câte cereri de ofertă am?", "Ce cereri sunt noi/în discuții/pierdute/cu ofertă trimisă?".
    - plăți/comision/facturi proprii: "Cât am câștigat luna asta?", "Cât comision datorez?", "Ce facturi sunt neachitate?", "Ce comision am plătit luna trecută?".
    - promovări/campanii proprii: "Sunt produsul zilei?", "Sunt artizanul săptămânii?", "Ce campanii am active?", "Ce promovări active am?".
    - recenzii/notificări proprii: "Câte recenzii am?", "Care este ratingul meu?", "Câte notificări necitite am?".
    Toate acestea sunt interogări/comenzi de date pentru domeniul magazinului VÂNZĂTORULUI, nu întrebări generale despre platformă, și au deja flow-uri dedicate funcționale (STRICT pentru rolul VENDOR - vezi regula explicită de mai jos despre diferența față de un cumpărător).
  NU alege asta pentru întrebări despre CUM funcționează platforma în general (acelea sunt PLATFORM_KNOWLEDGE) sau pentru cereri de modificare a UNUI produs/cost anume, cu valoare nouă specificată sau cerută (acelea sunt PLATFORM_ACTION).
  NU alege asta pentru "recalculează-l"/"recalculează produsul ăsta"/"recalculează-i costingul" - o comandă despre UN SINGUR produs, referit prin pronume sau implicit, fără nume și fără criteriu de filtrare (acelea sunt PLATFORM_ACTION - serverul rezolvă produsul din pagina curentă, vezi currentEntity).

Reguli:
- Alege O SINGURĂ categorie, cea mai potrivită.
- "Cum schimb prețul unui produs?" = PLATFORM_KNOWLEDGE (întreabă cum, generic).
- "Schimbă prețul produsului X la 50 lei" = PLATFORM_ACTION (cere să se facă, pentru un produs anume).
- "Ce produse am sub cost?" / "Cât mă costă produsul X?" = EXISTING_FLOW (interogare de date proprii, nu o întrebare generală și nu o cerere de schimbare).
- "Recalculează produsele care folosesc X" = EXISTING_FLOW (mai multe produse, după criteriu) DAR "Recalculează-l" / "Recalculează produsul ăsta" = PLATFORM_ACTION (un singur produs, referit prin pronume/context).
- "caut un cadou pentru mama" / "idei cadou mama" / "vreau ambalaje pentru lumânări" / "găsește-mi ceva pentru nuntă" = EXISTING_FLOW (MARKETPLACE_SEARCH) ÎNTOTDEAUNA, inclusiv pentru un vendor autentificat - vendorul rămâne și cumpărător, nu confunda "vreau X"/"caut X" (obiect generic, de cumpărat) cu o cerere despre magazinul PROPRIU al vendorului (aceea ar numi explicit un produs/cost/comandă deținut de el).
- "Ce comenzi am?" / "Câte comenzi am plasat?" / "Unde este comanda mea?" - DEPINDE STRICT de rolul curent (BATCH 1, FINAL GAP PASS: regulă corectată - varianta veche era necondiționată de rol și contrazicea EXISTING_FLOW pentru un VENDOR):
  - rolul curent USER/GUEST/INFLUENCER (cumpărător) = ORDER_HELP ÎNTOTDEAUNA (NICIODATĂ EXISTING_FLOW) - "comenzile mele" sunt comenzile PLASATE de el ca cumpărător.
  - rolul curent VENDOR (vânzător) = EXISTING_FLOW ÎNTOTDEAUNA (NICIODATĂ ORDER_HELP) - "comenzile mele" înseamnă comenzile PRIMITE în magazinul lui, date live de gestiune (vezi definiția EXISTING_FLOW mai sus) - un vânzător rămâne și el, teoretic, cumpărător pe platformă, dar "Câte comenzi am?" fără alt context înseamnă mereu magazinul lui, niciodată propriile achiziții.
- "Creează o campanie" / "Fă-mi o campanie" - deși e formulat imperativ (EXECUTE), NU e PLATFORM_ACTION - nu există niciun handler conversațional pentru creare de campanie (are mai multe câmpuri: nume, reducere, produse incluse - se face din interfață, nu conversațional). Rămâne PLATFORM_KNOWLEDGE, care explică UNDE se creează.
- "Ce recomandări ai?" / "Ce îmi recomanzi?" / "Cum funcționează recomandările [pentru mine]?" = VENDOR_INSIGHTS ÎNTOTDEAUNA (inclusiv formularea "cum funcționează", care altfel ar trage spre PLATFORM_KNOWLEDGE) - "recomandare" aici înseamnă sugestie despre contul propriu, NU programul de ambasadori. NUMAI "Cum funcționează programul de ambasadori?" / "Cum invit alți vânzători?" / "Ce e codul meu de recomandare?" (menționează EXPLICIT ambasadori/invitat/cod-link) = PLATFORM_KNOWLEDGE.
- Dacă mesajul e ambiguu între INCIDENT_OR_BUG și un domeniu specific (ORDER_HELP/PAYMENT_HELP/ACCOUNT_HELP), alege domeniul specific dacă e menționat explicit (ex. "nu îmi merge plata" = PAYMENT_HELP, nu INCIDENT_OR_BUG generic).
- NAVIGARE explicită spre o pagină ("du-mă la comenzi", "deschide comenzile", "arată-mi comenzile", "du-mă la produsele mele", "deschide profilul magazinului") = PLATFORM_KNOWLEDGE (nu PLATFORM_ACTION - nu există parametri de modificat, userul vrea doar să ajungă undeva). Diferența față de o întrebare EXPLAIN obișnuită: aici userul NU întreabă cum funcționează ceva, doar cere direct locația - răspunsul poate fi foarte scurt (unde se găsește pagina), fără explicații suplimentare nesolicitate.
- O întrebare EXPLICATIVĂ care conține cuvântul "personalizare"/"personalizat" ("Care e diferența dintre variantă și personalizare?", "Cum funcționează personalizarea?", "Ce înseamnă produs personalizat?") rămâne PLATFORM_KNOWLEDGE - NU este o cerere de ofertă/quote doar pentru că apare cuvântul "personalizare". O cerere REALĂ de ofertă cere explicit o ofertă/preț PENTRU UN PRODUS ANUME al vânzătorului ("vreau o ofertă pentru...", "cât ar costa personalizat...") - o întrebare despre CUM funcționează conceptul de personalizare nu e niciodată o cerere de ofertă.
- Întrebări despre COMISIONUL vânzătorului legat de campanie, chiar dacă menționează "alt produs"/"alte produse"/"două produse"/"produsul cumpărat" ("Dacă intră prin campania mea și cumpără alt produs de-al meu, ce comision am?") = PLATFORM_KNOWLEDGE ÎNTOTDEAUNA, NICIODATĂ MARKETPLACE_SEARCH - vânzătorul întreabă despre propriul mecanism de comision/atribuire, nu caută să cumpere ceva. Cuvântul "produs" izolat, într-o întrebare despre COMISION/ATRIBUIRE/CONTUL PROPRIU, nu declanșează niciodată MARKETPLACE_SEARCH.
- O întrebare GENERICĂ, informativă, despre cât/cum e comisionul sau plata - "Cât e comisionul?", "Ce comision ia Artfest?", "Cât oprește Artfest?", "Ce procent ia platforma?", "Cât plătesc pe o comandă?" și orice formulare echivalentă - este ÎNTOTDEAUNA PLATFORM_KNOWLEDGE (e o întrebare EXPLAIN despre cum funcționează platforma), NICIODATĂ PAYMENT_HELP - nu conține nicio problemă/incident raportat(ă). Rămâne PAYMENT_HELP DOAR când userul semnalează că ceva NU merge sau pare greșit: "nu îmi merge plata", "am fost taxat greșit", "nu am primit banii", "vreau un refund"/"vreau bani înapoi", "eroare Stripe", "problemă de încasare" și echivalente - acolo e o problemă reală, nu o întrebare informativă.

Istoric conversație:
${JSON.stringify(history || [], null, 2)}

Mesaj curent:
${message}

Returnează EXCLUSIV JSON valid:
{
  "intentMode": "EXPLAIN",
  "category": "PLATFORM_KNOWLEDGE",
  "mentionedRole": null,
  "confidence": 0.9
}
`;
}

const COPILOT_INTENT_MODES = [
  "EXPLAIN",
  "EXECUTE",
  "QUERY_LIVE_DATA",
  "TROUBLESHOOT",
  "MARKETPLACE_SEARCH",
];

const KNOWN_AUDIENCE_ROLES = ["USER", "VENDOR", "GUEST"];

export async function classifyCopilotMessage({
  message,
  history = [],
  audience = "USER",
}) {
  const response = await openai.responses.create({
    model: ROUTER_MODEL,

    text: { format: { type: "json_object" } },

    input: [
      {
        role: "user",

        content: [
          {
            type: "input_text",

            text: buildClassifierPrompt({
              message,
              history,
              audience,
            }),
          },
        ],
      },
    ],
  });

  const parsed = safeJsonParse(response.output_text);

  const category =
    parsed?.category &&
    (COPILOT_CATEGORIES.includes(parsed.category) ||
      parsed.category === "EXISTING_FLOW")
      ? parsed.category
      : "GENERAL_CONVERSATION";

  const confidence = Number.isFinite(
    Number(parsed?.confidence)
  )
    ? Math.max(0, Math.min(1, Number(parsed.confidence)))
    : null;

  const intentMode = COPILOT_INTENT_MODES.includes(
    parsed?.intentMode
  )
    ? parsed.intentMode
    : null;

  const mentionedRole = KNOWN_AUDIENCE_ROLES.includes(
    parsed?.mentionedRole
  )
    ? parsed.mentionedRole
    : null;

  return { category, confidence, intentMode, mentionedRole };
}

/*
 * Răspuns pe bază de knowledge, DOAR din manifestele relevante
 * (nu toate) - reutilizează convenția de răspuns deja folosită de
 * assistantVendorPlatformRoutes.js (message/topic/route/steps/
 * suggestions), generalizată la orice audiență, nu doar VENDOR.
 * resultType:"answer" - ca frontend-ul să poată trata rezultatul
 * cu ACELAȘI cod care afișează deja răspunsuri simple din
 * vendorAssistantCommandService.js (vezi processCostingCommandResult).
 */
async function buildKnowledgeAnswer({
  message,
  history,
  audience,
  manifests,
}) {
  if (!manifests.length) {
    return {
      resultType: "answer",

      message:
        "Nu găsesc o informație sigură despre asta în datele Artfest disponibile. Pot deschide un tichet către suport.",

      topic: "general",
      route: null,
      steps: [],
      suggestions: [],
      confidence: 0,
      manifestIds: [],
    };
  }

  const response = await openai.responses.create({
    model: "gpt-4.1",

    text: { format: { type: "json_object" } },

    input: [
      {
        role: "user",

        content: [
          {
            type: "input_text",

            text: `
Ești asistentul general Artfest. Utilizatorul are rolul: ${audience}.

Răspunde întrebării folosind EXCLUSIV informațiile din manifestele de mai jos - sunt sursa de adevăr despre ce e disponibil, indisponibil sau planificat.

Reguli:
- Nu inventa funcționalități sau endpointuri.
- Dacă manifestul spune available=false sau status=PLANNED pentru ce se întreabă, spune clar că nu este disponibil / este planificat, nu confirma disponibilitatea.
- Nu afișa endpointuri tehnice decât dacă utilizatorul e ADMIN sau cere explicit detalii tehnice.
- Dacă informația nu e suficient de sigură în manifestele de mai jos, spune EXACT: "Nu găsesc o informație sigură despre asta în datele Artfest disponibile. Pot deschide un tichet către suport." - NICIODATĂ cuvintele "manifest"/"context intern"/"knowledge base"/"model" în răspuns (sunt termeni tehnici interni, utilizatorul nu trebuie să știe cum funcționează asistentul pe dinăuntru) - nici în acest fallback, nici în restul răspunsului.
- Răspunde în română, practic și simplu, direct la obiect - pentru o întrebare cu un răspuns cuantificabil (procent, sumă, termen), începe răspunsul CU acel răspuns direct, apoi adaugă nuanțele relevante (nu invers).
- IMPORTANT - separă CITIREA de EXECUTAREA: un manifest poate fi vizibil unui rol care nu poate folosi el însuși capabilitatea descrisă (ex. un USER/GUEST poate întreba despre Costuri & Profit sau despre onboarding de vânzător, deși acelea sunt unelte pentru VENDOR). Verifică audience-ul REAL al utilizatorului (${audience}) față de audience-ul cerut de capabilities/endpoints din manifest:
  - dacă utilizatorul NU are audience-ul cerut de acea capabilitate: explică CONCEPTUL/cum funcționează, la persoana a treia sau condițional ("vânzătorii au acces la...", "după ce devii vânzător, vei putea să..."), NU la persoana a doua ca și cum ar fi deja disponibil lui ("poți face X" e greșit dacă X e vendor-only și el nu e vendor). Nu-l invita să apese butoane/pagini la care nu are acces.
  - dacă întrebarea e despre CUM DEVINE utilizatorul eligibil pentru acel rol (ex. "cum devin vânzător?"), explică pasul de eligibilitate folosind informația din manifest, apoi poți descrie pe scurt ce urmează să poată face.
  - dacă utilizatorul CHIAR are audience-ul cerut, răspunde normal, la persoana a doua, ca disponibil.
- NICIODATĂ nu scrie literal cuvintele "USER"/"VENDOR"/"GUEST"/"ADMIN" în răspuns (sunt etichete tehnice interne, nu vocabular pentru utilizator) - folosește formulări naturale: "vizitator"/"cumpărător"/"client" (nu USER/GUEST), "vânzător" (nu VENDOR), "echipa Artfest" (nu ADMIN).
- FIX #5 (FINAL E2E FIX PASS, 2026-09-07) - manifestele de mai jos sunt ordonate DESCRESCĂTOR după scor de relevanță pentru mesajul curent: PRIMUL manifest din listă e candidatul DOMINANT (cel mai relevant, inclusiv atunci când relevanța vine din faptul că e subiectul turei anterioare de conversație). Manifestele următoare (al 2-lea, al 3-lea) sunt STRICT context suplimentar, folosit DOAR dacă adaugă detalii relevante pentru ACELAȘI subiect ca primul manifest. NU folosi un manifest secundar ca să schimbi subiectul răspunsului către alt domeniu, complet diferit de primul - confirmat prin audit ca eroare reală (întrebarea "Unde o văd?" despre o factură a primit, greșit, un răspuns despre cereri de ofertă, pentru că manifestul secundar "quotes" era prezent alături de cel corect "checkout-payments"). Dacă niciun manifest secundar nu se leagă de subiectul primului, IGNORĂ-l complet.

Manifeste relevante (ordonate descrescător după relevanță - primul e dominant):
${JSON.stringify(manifests, null, 2)}

Istoric conversație:
${JSON.stringify(history || [], null, 2)}

Mesaj curent:
${message}

Returnează EXCLUSIV JSON valid:
{
  "message": "",
  "topic": "general",
  "steps": [],
  "suggestions": [],
  "confidence": 0
}
`,
          },
        ],
      },
    ],
  });

  const parsed = safeJsonParse(response.output_text) || {};

  return {
    resultType: "answer",

    message:
      String(parsed.message || "").trim() ||
      "Nu găsesc o informație sigură despre asta în datele Artfest disponibile. Pot deschide un tichet către suport.",

    topic: String(parsed.topic || "general").slice(0, 80),
    route: null,

    steps: Array.isArray(parsed.steps)
      ? parsed.steps.slice(0, 10)
      : [],

    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.slice(0, 5)
      : [],

    confidence: Number.isFinite(Number(parsed.confidence))
      ? Math.max(0, Math.min(1, Number(parsed.confidence)))
      : null,

    manifestIds: manifests.map((m) => m.id),
  };
}

/*
 * conversationContext generic (FAZA 7) -> pendingContext specific
 * folosit de buildPrompt/dispatchCommand din
 * vendorAssistantCommandService.js. DOUĂ forme posibile, EXACT ca
 * în vendorAssistantCommandsRoutes.js:
 * 1. awaitingField === "product" -> nume de produs încă necunoscut;
 * 2. entityId cunoscut + awaitingField (nume de câmp) -> valoare
 *    de câmp încă necunoscută.
 */
function toVendorAssistantPendingContext(
  conversationContext
) {
  if (!conversationContext?.activeAction) {
    return null;
  }

  const commandType = conversationContext.activeAction;

  if (conversationContext.awaitingField === "product") {
    return {
      commandType,
      awaitingField: "product",

      missingUpdateField:
        conversationContext.collectedParams
          ?.missingUpdateField || null,

      productUpdate:
        conversationContext.collectedParams
          ?.productUpdate || null,
    };
  }

  if (
    conversationContext.entityId &&
    conversationContext.awaitingField
  ) {
    return {
      commandType,
      productId: conversationContext.entityId,
      missingField: conversationContext.awaitingField,
    };
  }

  return null;
}

/*
 * HARDENING: ieșire determinist dintr-un flow de colectare de câmp
 * ("Care e noul preț?" / "Pentru ce produs?") - fără asta, un răspuns
 * ca "de fapt lasă, anulează" era trimis mai departe la LLM ca și
 * cum ar fi valoarea cerută, care fie inventa un commandType greșit,
 * fie re-întreba aceeași întrebare la nesfârșit. Verificat STRICT
 * ca token întreg (nu substring) - un preț tastat literal "anulat"
 * sau un nume de produs care conține "stop" nu trebuie confundat cu
 * intenția de anulare (foarte puțin probabil, dar whole-word evită
 * chiar și acel risc).
 */
/*
 * Forme STEMUITE (vezi tokenizeSearchText din textRelevance.js) -
 * "anulează"/"anuleaza" -> "anuleaz", "lasă"/"las-o" -> "las",
 * "renunț"/"renunta" -> "renunt" - verificate direct, nu ghicite,
 * ca să nu rateze cazul din cauza unei stem-uiri diferite de ce
 * am presupus manual.
 */
/*
 * Deliberat FĂRĂ "nu" simplu - prea comun/ambiguu într-un flow de
 * colectare valoare ("nu 50, ci 60" corectează valoarea, nu
 * anulează). Doar cuvinte cu intenție de anulare clară, greu de
 * confundat cu o valoare sau o corecție.
 */
/*
 * "gata" (stem "gat") NU e inclus deliberat, deși poate exprima
 * renunțare - "gat"/"gât" apare frecvent în descrieri de bijuterii
 * ("lanț de gât"), iar detectCancelIntent verifică orice TOKEN din
 * mesaj, nu propoziția întreagă - un fals-pozitiv aici ar întrerupe
 * silențios o valoare validă introdusă de vânzător.
 */
const CANCEL_WORDS = new Set([
  "anuleaz",
  "renunt",
  "stop",
  "las",
  "opr",
]);

function detectCancelIntent(message) {
  const tokens = tokenizeSearchText(message);
  return tokens.some((token) => CANCEL_WORDS.has(token));
}

/*
 * SCHIMBARE DE SUBIECT (audit) - mecanism GENERAL, nu hardcodat pe
 * fraze: cât timp un flow determinist așteaptă un răspuns simplu
 * (nume de produs, valoare de câmp, continuarea unui triaj de
 * suport), un mesaj complet NELEGAT de acel flow ("Cum fac retur?"
 * în timp ce se aștepta numele unui produs) nu trebuie interpretat
 * literal ca fiind chiar răspunsul așteptat - ar corupe datele
 * (numele produsului ar deveni literalmente "Cum fac retur?") sau
 * ar da un răspuns confuz ("nu am găsit un produs...").
 *
 * Semnalul e SEMANTIC, din același clasificator LLM folosit peste
 * tot (classifyCopilotMessage), nu o listă de fraze: dacă mesajul
 * se clasifică NATURAL într-o categorie clar diferită de
 * PLATFORM_ACTION, cu încredere mare, e un subiect nou - indiferent
 * de formulare exactă. Prag conservator (0.75): sub asta, preferăm
 * să continuăm flow-ul curent (fals-negativ, mai sigur) decât să
 * abandonăm o clarificare validă doar pentru că mesajul e ambiguu.
 */
const TOPIC_CHANGE_CONFIDENCE_THRESHOLD = 0.75;

function isTopicChange(classification) {
  return (
    classification.category !== "PLATFORM_ACTION" &&
    Number.isFinite(classification.confidence) &&
    classification.confidence >= TOPIC_CHANGE_CONFIDENCE_THRESHOLD
  );
}

/*
 * PLATFORM_ACTION - reutilizează 100% pipeline-ul existent de
 * clasificare+extragere+dispatch din vendorAssistantCommandService.js
 * (buildPrompt, dispatchCommand), EXACT cum face
 * vendorAssistantCommandsRoutes.js - doar orchestrat de aici, ca
 * intrarea generală (product_update etc. rămân disponibile și prin
 * vechea rută, neschimbate).
 */
async function handlePlatformAction({
  message,
  history,
  audience,
  userSub,
  conversationContext,
  currentEntity,
}) {
  if (audience !== "VENDOR" && audience !== "ADMIN") {
    return {
      resultType: "answer",

      message:
        "Acest tip de acțiune este disponibil momentan doar pentru vânzători, din contul lor.",
    };
  }

  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru această acțiune.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const pendingContext = toVendorAssistantPendingContext(
    conversationContext
  );

  /*
   * HARDENING: ieșire determinist din flow-ul de colectare de câmp
   * ÎNAINTE de orice apel LLM - verificată DOAR când chiar suntem
   * mid-flow (pendingContext truthy), ca să nu confundăm un mesaj
   * nou și independent ("anulează comanda X" - cu totul altă
   * intenție) cu o cerere de ieșire din flow-ul curent.
   */
  if (pendingContext && detectCancelIntent(message)) {
    return {
      resultType: "answer",
      message: "Am renunțat, nu modific nimic.",
      cancelled: true,
    };
  }

  /*
   * Bypass determinist al LLM-ului când așteptăm STRICT numele
   * produsului (awaitingField: "product") - identic cu motivul din
   * vendorAssistantCommandsRoutes.js: un mesaj-ecou izolat ca
   * "odorizant" e ușor clasificat greșit dacă trece din nou prin
   * LLM ca mesaj independent.
   */
  if (pendingContext?.awaitingField === "product") {
    const result = await handleUpdateProduct(vendor.id, {
      productName: message,
      productUpdate: pendingContext.productUpdate,
      missingUpdateField: pendingContext.missingUpdateField,
      knownProductId: null,
      rawMessage: message,
    });

    return { commandType: "UPDATE_PRODUCT", ...result };
  }

  const response = await openai.responses.create({
    model: "gpt-4.1",

    text: { format: { type: "json_object" } },

    input: [
      {
        role: "user",

        content: [
          {
            type: "input_text",

            text: buildVendorAssistantPrompt({
              message,
              history,
              pendingContext,
            }),
          },
        ],
      },
    ],
  });

  const parsed = safeJsonParse(response.output_text);

  if (!parsed) {
    return {
      resultType: "answer",

      message:
        "Modelul AI nu a returnat un răspuns valid pentru această acțiune.",
    };
  }

  /*
   * Dacă LLM-ul (din promptul complet, care poate clasifica orice
   * commandType din Costuri & Profit, nu doar cele 5 din registry)
   * a extras un commandType care NU e o acțiune înregistrată -
   * ex. o întrebare de citire (READ_PROFITABILITY) strecurată aici
   * - o tratăm tot ca răspuns valid (dispatchCommand știe să
   * răspundă corect la orice commandType), doar că nu mai verificăm
   * separat "e o acțiune cunoscută" - dispatchCommand e sursa de
   * adevăr, actionRegistry.js e doar un filtru declarativ pentru
   * routing, nu o restricție dublă.
   */
  const result = await dispatchCommand(vendor.id, parsed, {
    pendingContext,
    message,
    currentEntity,
  });

  return { commandType: parsed.commandType, ...result };
}

/*
 * PROACTIVE COPILOT - insight-uri calculate LIVE (insightsService.js),
 * NU din manifeste statice. Răspunsul e compus DETERMINIST (nu de
 * un LLM) direct din array-ul de insight-uri - modelul nu inventează
 * nimic aici, doar clasifică mesajul ca aparținând acestei categorii.
 */
/*
 * "azi"/"astăzi" NU mai înseamnă "urgent" - extras separat mai jos
 * (TODAY_HINT_RE) pentru scope-ul "today" (plan de azi), distinct
 * de "urgent"/"acum"/"imediat" (filtrare STRICT după severitate
 * IMPORTANT). Înainte, "Ce să fac azi?" pentru un magazin fără
 * nimic IMPORTANT primea "nu ai nimic urgent" - inutil pentru un
 * vânzător care chiar vrea un plan, nu doar urgențele.
 */
const URGENT_HINT_RE = /urgent|acum|imediat/i;
const TODAY_HINT_RE = /\bazi\b|\bastăzi\b/i;
const COSTS_DOMAIN_HINT_RE = /cost|profit/i;
const PRODUCT_DOMAIN_HINT_RE = /produs/i;
const ORDER_DOMAIN_HINT_RE = /comand|comenz|cerer|ofert/i;

/*
 * Extindere audit "recomandări magazin" - profilul magazinului
 * (logo/copertă/descriere/social) și promovarea (colecții/coduri
 * de reducere), câte un scop dedicat fiecare, ca vânzătorul să
 * poată întreba țintit ("ce lipsește din profilul meu?", "ce
 * produse ar trebui să promovez?") fără să primească tot amestecat.
 */
const STORE_PROFILE_DOMAIN_HINT_RE =
  /profil(ul)?\s*(magazin|meu)|logo|copert|banner|despre\s+magazin/i;

const PROMOTION_DOMAIN_HINT_RE =
  /promov|colec[țt]i|cod(uri)?\s*(de\s*)?reducere/i;

const INSIGHT_SCOPE_DOMAINS = {
  urgent: null,
  today: null,

  costs: ["costs-profit"],
  products: ["products", "costs-profit", "homepage-features"],
  orders: ["orders", "quotes"],
  profile: ["store-profile"],
  promotion: ["promotion", "homepage-features"],

  all: null,
};

/*
 * O SINGURĂ sursă de adevăr pentru "ce domeniu a cerut vânzătorul" -
 * folosită ATÂT la interogarea inițială (handleVendorInsightsQuery)
 * CÂT ȘI la reluarea ei ("arată-mi toate" - handleInsightFollowUp),
 * ca să nu diveargă. "costuri"/"profit" verificat ÎNAINTEA
 * "produse" generic, pentru că e mai specific (recomandări pentru
 * costuri NU trebuie să includă și lipsa de stoc, de exemplu).
 */
/*
 * BUGFIX (audit): "urgent"/"azi"/"acum"/"imediat" era verificat
 * ÎNAINTEA domeniilor specifice - orice întrebare care combina un
 * cuvânt de urgență cu un domeniu ("Ce probleme am cu produsele
 * ACUM?", "Ce ar trebui să verific AZI la costuri?") pierdea
 * domeniul cerut și primea filtrarea generică "urgent" (doar
 * IMPORTANT, din toate domeniile), nu insight-urile din domeniul
 * menționat explicit. Domeniul specific are prioritate - "urgent"
 * rămâne doar fallback-ul pentru când NU e menționat niciun domeniu.
 */
/*
 * "De ce nu am comenzi?"/"De ce nu vând?" - deși menționează
 * "comenzi"/"vând" (ar nimeri altfel scope-ul îngust "orders", care
 * ar răspunde doar cu insight-uri din domeniul comenzi/oferte - de
 * regulă gol, deci un răspuns inutil "nu am nimic de semnalat la
 * comenzi"), întrebarea CAUZALĂ vrea explicația mai largă (catalog
 * mic, profil incomplet, listări slabe) - verificată ÎNAINTEA
 * oricărui alt scope de domeniu.
 */
const WHY_NO_ORDERS_RE =
  /de\s*ce\s*nu\s*(am|vand|vând|primesc)/i;

function detectInsightScope(message) {
  if (WHY_NO_ORDERS_RE.test(message)) return "all";

  if (COSTS_DOMAIN_HINT_RE.test(message)) return "costs";

  const wantsOrders =
    ORDER_DOMAIN_HINT_RE.test(message) &&
    !PRODUCT_DOMAIN_HINT_RE.test(message);

  if (wantsOrders) return "orders";
  if (PRODUCT_DOMAIN_HINT_RE.test(message)) return "products";

  if (STORE_PROFILE_DOMAIN_HINT_RE.test(message)) return "profile";
  if (PROMOTION_DOMAIN_HINT_RE.test(message)) return "promotion";

  /*
   * "today" ÎNAINTEA "urgent" - "Ce să fac azi?" fără alt domeniu
   * numit vrea un plan (vezi composeTodayPlanAnswer), nu doar
   * filtrarea severă IMPORTANT-only a lui "urgent".
   */
  if (TODAY_HINT_RE.test(message)) return "today";
  if (URGENT_HINT_RE.test(message)) return "urgent";

  return "all";
}

/*
 * FINAL E2E FIX PASS (2026-09-07) - fix #1 (E2E#3 confirmat 100%
 * reproductibil): "Poate AI-ul să îmi spună ce produse nu au stoc?"
 * și variante clasifică EXISTING_FLOW + QUERY_LIVE_DATA (cerere de
 * date proprii precisă, NU o cerere de "recomandări"/"probleme" -
 * promptul clasificatorului nu are niciun cuvânt-declanșator
 * VENDOR_INSIGHTS aici), dar datele cerute (stoc/ascunse/inactive/
 * incomplete) există STRICT în insightsService.js, accesibil altfel
 * doar din categoria VENDOR_INSIGHTS. Poartă STRICTĂ, verificată
 * DUPĂ toate cele 10 tool-uri live existente (dacă vreunul răspunde
 * deja, nu ajunge niciodată aici) - reutilizează EXACT
 * handleVendorInsightsQuery, zero duplicare de query.
 */
const CATALOG_HEALTH_FALLBACK_RE =
  /stoc|ascun|inactiv|problem|incomplet|imbunatat|îmbunătăț/i;

function isCatalogHealthQuestion(message) {
  const t = String(message || "");
  return PRODUCT_DOMAIN_HINT_RE.test(t) && CATALOG_HEALTH_FALLBACK_RE.test(t);
}

function scopeInsights(insights, scope) {
  if (scope === "urgent") {
    return insights.filter((i) => i.severity === "IMPORTANT");
  }

  const domains = INSIGHT_SCOPE_DOMAINS[scope];

  if (!domains) return insights;

  return insights.filter((i) => domains.includes(i.domain));
}

const SCOPE_EMPTY_MESSAGE = {
  urgent: "Nu ai nimic urgent chiar acum.",
  today: "Magazinul tău arată bine momentan - nu am niciun punct concret de adăugat la planul de azi.",
  costs: "Nu am nimic de semnalat la costuri/profit chiar acum.",
  products: "Nu am nimic de semnalat la produse chiar acum.",
  orders: "Nu am nimic de semnalat la comenzi chiar acum.",
  profile: "Profilul magazinului tău arată complet - logo, copertă, descriere și social sunt completate.",
  promotion: "Ai deja cel puțin o colecție și un cod de reducere active - nu am nimic de semnalat aici.",
  all: "Momentan nu văd nimic important care să necesite atenția ta.",
};

const INSIGHTS_SHOWN_CAP = 3;

/*
 * Format conversațional, NU o listă seacă - "Am N recomandări...
 * Cele mai importante acum sunt: 1... 2... 3... Vrei să le vedem pe
 * toate?" (doar dacă mai sunt și altele peste cele arătate).
 */
function composeInsightsAnswer(scope, scoped) {
  if (!scoped.length) {
    return SCOPE_EMPTY_MESSAGE[scope] || SCOPE_EMPTY_MESSAGE.all;
  }

  const shown = scoped.slice(0, INSIGHTS_SHOWN_CAP);

  const lines = shown.map(
    (insight, index) =>
      `${index + 1}. ${insight.title} - ${insight.message}`
  );

  const intro =
    scoped.length === 1
      ? "Am o recomandare pentru magazinul tău:"
      : `Am ${scoped.length} recomandări pentru magazinul tău. Cele mai importante acum sunt:`;

  const outro =
    scoped.length > shown.length
      ? "\n\nVrei să le vedem pe toate?"
      : "";

  return `${intro}\n\n${lines.join("\n")}${outro}`;
}

/*
 * "Ce să fac azi?" - plan scurt, numerotat, imperativ, DIN aceleași
 * insight-uri reale (nicio sursă de date nouă) - doar altă formă,
 * potrivită unui mini-plan în loc de o listă de probleme. Fiecare
 * insight are un `actionPhrase` scurt, imperativ (setat explicit la
 * insight-urile noi din insightsService.js); pentru cele mai vechi,
 * fără actionPhrase, cădem pe title (tot un fapt real, doar mai puțin
 * imperativ formulat).
 */
const TODAY_PLAN_CAP = 4;

function composeTodayPlanAnswer(scoped) {
  if (!scoped.length) {
    return SCOPE_EMPTY_MESSAGE.today;
  }

  const shown = scoped.slice(0, TODAY_PLAN_CAP);

  const lines = shown.map(
    (insight, index) =>
      `${index + 1}. ${insight.actionPhrase || insight.title}`
  );

  return `Azi aș face:\n\n${lines.join("\n")}`;
}

/*
 * activeInsight expus în conversationContext (frontend-ul îl
 * setează după ce afișează un insight, exact ca supportContext la
 * FAZA 8-10). Ține DOAR identificatori ușori (scope + tipul/acțiunea
 * celui mai sever) - NU array-ul complet de insight-uri, ca să nu
 * ajungem să afișăm date vechi: la orice reluare (confirmare sau
 * "arată-mi toate"), insight-urile se re-calculează live din nou
 * (vezi handleInsightFollowUp - getVendorInsights apelat din nou).
 */
/*
 * BUGFIX (audit): composeInsightsAnswer arată până la 3 insight-uri
 * numerotate, dar suggestedAction/actionParams erau luate mereu
 * doar din primul, indiferent câte din cele 3 AFIȘATE aveau propria
 * lor acțiune automată. Dacă vânzătorul răspundea "da" gândindu-se
 * la recomandarea #2 sau #3 (nu #1), sistemul executa acțiunea
 * GREȘITĂ - o confirmare reală, dar pentru altceva decât a înțeles
 * vânzătorul (încalcă "dacă nu ești sigur, nu ghici"). Fix: dacă
 * mai mult de UNA dintre insight-urile AFIȘATE are o acțiune
 * proprie, nu o alegem automat pe a primei - lăsăm suggestedAction
 * gol, iar handleInsightFollowUp cere explicit la care se referă.
 */
function buildActiveInsightContext(scope, scopedInsights, shownInsights) {
  const top = scopedInsights[0];

  if (!top) return null;

  const shown = shownInsights || scopedInsights.slice(0, INSIGHTS_SHOWN_CAP);
  const actionable = shown.filter((i) => i.suggestedAction);
  const unambiguousAction = actionable.length === 1 ? actionable[0] : null;

  return {
    type: top.type,
    domain: top.domain,
    title: top.title,
    suggestedAction: unambiguousAction?.suggestedAction || null,
    actionParams: unambiguousAction?.actionParams || null,
    scope,
  };
}

/*
 * HELP_OVERVIEW ("Ce poți face pentru mine?") - GENERAT dinamic din
 * sursele reale de capabilități, nu o listă scrisă de mână care s-ar
 * învechi la orice funcționalitate nouă:
 * - knowledge: getPlatformManifests() (aceleași manifeste ca
 *   knowledgeRetrieval.js), filtrate după knowledgeAudience/audience
 *   ca la orice altă întrebare de knowledge - orice manifest nou,
 *   cu knowledgeAudience corect, apare AUTOMAT aici, fără nicio
 *   modificare de cod;
 * - acțiuni vendor: ACTION_HANDLERS din actionRegistry.js (ACEEAȘI
 *   sursă folosită de PLATFORM_ACTION) - un action nou înregistrat
 *   acolo apare automat aici;
 * - marketplace/suport: rezumate scurte, stabile (execuția reală
 *   trăiește în alt strat - client-side pentru marketplace,
 *   supportEscalationService.js pentru suport - nu se schimbă des).
 */
const HELP_OVERVIEW_STATUS_ALLOWED = new Set(["ACTIVE", "PARTIAL"]);
const HELP_OVERVIEW_MAX_KNOWLEDGE_TOPICS = 9;

const MARKETPLACE_HELP_SUMMARY =
  "caut produse și idei de cadouri, recomandări după persoană/ocazie/buget, căutare după o fotografie";

const SUPPORT_HELP_SUMMARY =
  "ajutor pentru cont (autentificare, parolă), comenzi și plăți - încerc întâi să rezolv direct, iar dacă nu reușesc, propun un tichet către echipa de suport";

const ACTION_ENTITY_TYPE_LABELS = {
  product: "administrare produse (preț, stoc, descriere, disponibilitate)",
  costItem: "biblioteca de costuri",
  store: "profilul magazinului",
  order: "statusul comenzilor",
};

/*
 * BUGFIX (audit) - "Cu ce mă poți ajuta dacă sunt client?": userul
 * poate întreba din perspectiva unui rol IPOTETIC, diferit de
 * sesiunea lui reală (ex. un VENDOR întreabă "dacă sunt client").
 * `perspectiveAudience` (extras semantic de classifyCopilotMessage,
 * NU dintr-o listă de fraze - vezi mentionedRole) decide CE
 * capabilități se afișează; `realAudience` rămâne doar pentru nota
 * de clarificare - NU schimbă nimic despre ce poate EXECUTA userul
 * (acțiunile rămân gated separat, la nivel de cod, de audience-ul
 * real al sesiunii).
 */
const ROLE_LABELS = {
  USER: "cumpărător",
  VENDOR: "vânzător",
  GUEST: "vizitator neautentificat",
  ADMIN: "admin",
  INFLUENCER: "influencer",
};

function buildHelpOverviewAnswer(
  perspectiveAudience,
  realAudience = perspectiveAudience
) {
  const audience = perspectiveAudience;
  const isVendor = audience === "VENDOR" || audience === "ADMIN";
  const isHypotheticalRole = perspectiveAudience !== realAudience;

  const knowledgeTopics = getPlatformManifests()
    .filter((manifest) => {
      const knowledgeAudience = Array.isArray(
        manifest.knowledgeAudience
      )
        ? manifest.knowledgeAudience
        : manifest.audience;

      return (
        Array.isArray(knowledgeAudience) &&
        knowledgeAudience.includes(audience) &&
        HELP_OVERVIEW_STATUS_ALLOWED.has(manifest.status) &&
        manifest.available !== false
      );
    })
    .map((manifest) => manifest.title)
    .filter(Boolean);

  const uniqueTopics = [
    ...new Set(knowledgeTopics),
  ].slice(0, HELP_OVERVIEW_MAX_KNOWLEDGE_TOPICS);

  const lines = isHypotheticalRole
    ? [
        `Ca ${ROLE_LABELS[audience] || audience.toLowerCase()}, te-aș putea ajuta cu:`,
        "",
      ]
    : ["Te pot ajuta cu:", ""];

  lines.push(`- Cumpărături: ${MARKETPLACE_HELP_SUMMARY}.`);

  if (uniqueTopics.length) {
    lines.push(
      `- Informații despre platformă: ${uniqueTopics.join(", ")}.`
    );
  }

  lines.push(`- Contul tău: ${SUPPORT_HELP_SUMMARY}.`);

  if (isVendor) {
    const entityTypes = [
      ...new Set(
        Object.values(ACTION_HANDLERS)
          .filter(
            (entry) =>
              Array.isArray(entry.audience) &&
              entry.audience.includes("VENDOR")
          )
          .map((entry) => entry.entityType)
      ),
    ];

    const vendorActionLabels = entityTypes.map(
      (entityType) =>
        ACTION_ENTITY_TYPE_LABELS[entityType] || entityType
    );

    if (vendorActionLabels.length) {
      lines.push(
        `- Magazinul tău, conversațional (cu confirmare înainte de orice modificare): ${vendorActionLabels.join(", ")}.`
      );
    }

    lines.push(
      `- Costuri & Profit: calculator de preț, analiză foto pentru identificarea materialelor, recalculare în masă.`
    );

    lines.push(
      `- Recomandări live pentru magazinul tău (produse fără costing/video, catalog mic, profil de magazin incomplet, fără colecții/coduri de reducere, comenzi care așteaptă acțiune) - întreabă "ce îmi recomanzi?" sau "ce ar trebui să fac azi?".`
    );
  }

  lines.push("");

  if (isHypotheticalRole) {
    lines.push(
      `Contul tău actual rămâne neschimbat (${ROLE_LABELS[realAudience] || realAudience.toLowerCase()}) - astea sunt doar informații despre ce presupune rolul de ${ROLE_LABELS[audience] || audience.toLowerCase()}.`
    );
  } else {
    lines.push("Spune-mi direct ce ai nevoie.");
  }

  return lines.join("\n");
}

/*
 * ANULARE COMANDĂ (cumpărător) - reutilizează EXACT cancelOwnOrder/
 * computeUiStatus din userOrdersRoutes.js (aceeași logică ca ruta
 * HTTP reală /api/user/orders/:id/cancel, extrasă ca funcție - vezi
 * acolo), nicio reimplementare, nicio scriere nouă în DB. Aceeași
 * disciplină de confirmare ca oriunde altundeva în router: NIMIC nu
 * se anulează fără un "da" explicit pe o comandă deja identificată
 * și afișată userului.
 *
 * Semnal de intenție determinist (nu o listă de fraze rigidă, un
 * tipar pe rădăcina cuvântului - "anulez"/"anulare"/"anulați" etc.
 * + contextul de comandă, ca "las-o"/"renunț" din alte fluxuri).
 *
 * BUGFIX (audit, verificare independentă): varianta inițială
 * ("\banulea") rata "anulez"/"anulezi"/"anulăm" (persoana I/II, un
 * radical DIFERIT de "anuleaz-" folosit la persoana III) și
 * "renunț" (cu ț diacritic, literal diferit de "t" simplu - regexul
 * testa direct textul brut, fără normalizare). Normalizăm întâi
 * (fără diacritice), apoi verificăm radicalul comun "anul" + o
 * vocală (e/a - acoperă toate conjugările după normalizare) sau
 * "renunt", ambele urmate de "comand" la mică distanță.
 */
function normalizeForCancelDetection(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const ORDER_CANCEL_INTENT_RE =
  /\banul[ea]\w*.{0,20}\bcomand|\brenunt\w*.{0,20}\bcomand/;

function detectOrderCancelIntent(message) {
  return ORDER_CANCEL_INTENT_RE.test(
    normalizeForCancelDetection(message)
  );
}

const USER_ORDER_CANCEL_STATUS_ALLOWED = new Set([
  "PENDING",
  "PROCESSING",
]);

function formatOrderShortLabel(order) {
  const shortId = String(order.id || "")
    .slice(-6)
    .toUpperCase();

  const total = Number(order.total || 0).toFixed(2);
  const currency = order.currency || "RON";

  return `#${shortId} (${total} ${currency})`;
}

async function handleUserOrderCancelFlow({
  message,
  userSub,
  conversationContext,
  currentEntity,
}) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat pentru asta - conectează-te la contul tău.",
    };
  }

  const collectedParams =
    conversationContext?.collectedParams || {};

  const currentFlow =
    conversationContext?.currentFlow || null;

  /*
   * Etapa de CONFIRMARE - o comandă a fost deja identificată și
   * arătată userului, așteptăm "da"/"nu".
   */
  if (currentFlow === "confirming" && collectedParams.orderId) {
    if (detectCancelIntent(message)) {
      return {
        resultType: "answer",
        message: "Am înțeles, nu anulez comanda.",
      };
    }

    const yesNo = detectYesNo(message);

    if (yesNo === "yes") {
      const result = await cancelOwnOrder({
        userId: userSub,
        orderId: collectedParams.orderId,
      });

      if (!result.ok) {
        return {
          resultType: "answer",
          message: result.message,
        };
      }

      return {
        resultType: "answer",

        message:
          result.refund?.status === "REFUNDED"
            ? "Am anulat comanda, iar plata cu cardul a fost rambursată. Vei primi un email de confirmare."
            : result.refund?.status === "PENDING"
            ? "Am anulat comanda. Rambursarea plății cu cardul nu s-a putut finaliza automat; echipa Artfest o va procesa manual. Vei primi un email de confirmare."
            : "Am anulat comanda. Vei primi un email de confirmare.",
      };
    }

    if (yesNo === "no") {
      return {
        resultType: "answer",
        message: "Am înțeles, nu anulez comanda.",
      };
    }

    return {
      resultType: "answer",

      message: `Vrei să anulez comanda ${formatOrderShortLabel(
        { id: collectedParams.orderId, total: 0, currency: "RON" }
      )}? Răspunde cu "da" sau "nu".`,

      supportContext: {
        activeIntent: "USER_ORDER_CANCEL",
        currentFlow: "confirming",
        collectedParams,
      },
    };
  }

  /*
   * Etapa de IDENTIFICARE a comenzii - din currentEntity (userul e
   * pe pagina comenzii), din răspunsul la o clarificare anterioară,
   * sau cerem explicit.
   */
  let orderId = collectedParams.orderId || null;

  if (!orderId && currentEntity?.type === "ORDER" && currentEntity?.id) {
    orderId = currentEntity.id;
  }

  if (!orderId && currentFlow === "clarifying") {
    orderId = String(message || "").trim();
  }

  if (!orderId) {
    return {
      resultType: "answer",

      message:
        "Ce comandă vrei să anulezi? Dă-mi numărul comenzii (îl găsești în „Comenzile mele”) sau deschide comanda respectivă înainte să-mi ceri asta.",

      supportContext: {
        activeIntent: "USER_ORDER_CANCEL",
        currentFlow: "clarifying",
        collectedParams: {},
      },
    };
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: userSub },
    include: { shipments: true },
  });

  if (!order) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit nicio comandă de-a ta cu acest identificator.",
    };
  }

  const uiStatus = computeUiStatus(order, order.shipments);

  if (!USER_ORDER_CANCEL_STATUS_ALLOWED.has(uiStatus)) {
    return {
      resultType: "answer",

      message:
        "Această comandă nu mai poate fi anulată în etapa curentă - a avansat deja spre pregătire sau livrare. Contactează suportul dacă ai nevoie de ajutor.",
    };
  }

  return {
    resultType: "answer",

    message: `Vrei să anulez comanda ${formatOrderShortLabel(
      order
    )}? Răspunde cu "da" sau "nu".`,

    supportContext: {
      activeIntent: "USER_ORDER_CANCEL",
      currentFlow: "confirming",
      collectedParams: { orderId: order.id },
    },
  };
}

/*
 * "Ce comenzi am?" (cumpărător autentificat) - live data REALĂ,
 * citire directă, read-only, scoped strict pe userSub - NU
 * marketplace search, NU date de vânzător (vezi distincția
 * ORDER_HELP vs EXISTING_FLOW din classifier).
 */
const USER_ORDERS_LIST_LIMIT = 5;
const USER_ORDERS_QUERY_LIMIT = 100;

/*
 * BATCH 2 (audit USER, 2026-09-08) - extins de la un simplu "listă
 * ultimele 5 comenzi" la detectare de subiect (topic), mirror exact al
 * tiparului din vendorAssistantOrders.js (detectOrderLiveTopic +
 * shipmentStatusFilterFor), dar adaptat la statusul UI de CUMPĂRĂTOR
 * (computeUiStatus - PENDING/PROCESSING/SHIPPED/DELIVERED/CANCELED/
 * RETURNED), NU la statusul intern de shipment al vânzătorului (alt
 * vocabular, altă granularitate). NU duplică business logic - statusul
 * e calculat STRICT cu computeUiStatus, deja importat din
 * userOrdersRoutes.js (aceeași funcție folosită de ruta reală a
 * userului). Ownership: where:{userId: userSub}, niciodată vendorId.
 */
const USER_ORDER_UI_STATUS_LABEL = {
  PENDING: "în așteptare",
  PROCESSING: "în procesare",
  SHIPPED: "expediate",
  DELIVERED: "livrate",
  CANCELED: "anulate",
  RETURNED: "returnate",
};

function detectUserOrderTopic(message, { lastCategory } = {}) {
  const t = normalizeForCancelDetection(message);

  /*
   * BUGFIX (audit USER Batch 2, 2026-09-08) - această funcție e apelată
   * STRICT din interiorul ramurii ORDER_HELP + QUERY_LIVE_DATA (deja
   * confirmată de clasificator că e despre comenzi) - NU mai are nevoie
   * de propria "poartă" de intrare, doar de sub-clasificare pe topic.
   * O poartă suplimentară pe regex ("\bcomand\b") era greșită și bloca
   * silențios "comenzi" (plural) - "comenzi" NU se potrivea, doar
   * "comandă"/"comenzii" - orice întrebare cu plural pica pe TOTAL.
   */
  if (/ultima|ultimul/.test(t)) return "LAST";
  if (/activ/.test(t)) return "ACTIVE";
  if (/procesar/.test(t)) return "PROCESSING";
  if (/exped|trimis/.test(t)) return "SHIPPED";
  if (/livrat/.test(t)) return "DELIVERED";
  if (/anulat/.test(t)) return "CANCELED";
  if (/returnat/.test(t)) return "RETURNED";
  if (/avans/.test(t)) return "DEPOSIT";
  if (/platit|de plata|metoda de plata|statusul comenzii/.test(t))
    return "LAST";
  if (/vanzator|de la cine/.test(t)) return "LAST";

  return "TOTAL";
}

function resolveUserOrderDateRange(t) {
  const now = new Date();

  if (/luna\s*trecut/.test(t)) {
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
    );
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from, to, label: "luna trecută" };
  }

  if (/luna\s*asta|luna\s*aceasta/.test(t)) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );
    return { from, to, label: "luna asta" };
  }

  return null;
}

async function handleUserOrdersLiveQuery({ userSub, message = "", lastCategory = null }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat pentru asta - conectează-te la contul tău.",
    };
  }

  const t = normalizeForCancelDetection(message);
  const topic = detectUserOrderTopic(message, { lastCategory }) || "TOTAL";
  const dateRange = resolveUserOrderDateRange(t);

  const orders = await prisma.order.findMany({
    where: {
      userId: userSub,
      ...(dateRange
        ? { createdAt: { gte: dateRange.from, lt: dateRange.to } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: USER_ORDERS_QUERY_LIMIT,
    include: {
      shipments: {
        include: {
          vendor: { select: { displayName: true } },
        },
      },
    },
  });

  const withStatus = orders.map((order) => ({
    order,
    uiStatus: computeUiStatus(order, order.shipments),
  }));

  const periodSuffix = dateRange ? ` ${dateRange.label}` : "";

  if (topic === "LAST") {
    if (!withStatus.length) {
      return {
        resultType: "answer",
        topicId: "orders",
        message: `Nu am găsit nicio comandă în contul tău${periodSuffix}.`,
      };
    }

    const { order, uiStatus } = withStatus[0];
    const vendorNames = Array.from(
      new Set(
        (order.shipments || [])
          .map((s) => s.vendor?.displayName)
          .filter(Boolean)
      )
    );
    const deposit = (order.shipments || [])
      .map((s) => ({
        status: s.depositStatus,
        requested: s.depositRequestedAmount,
        paid: s.depositPaidAmount,
      }))
      .find((d) => d.status && d.status !== "NOT_REQUESTED");

    const statusLabel =
      USER_ORDER_UI_STATUS_LABEL[uiStatus] || uiStatus.toLowerCase();
    const paymentLabel =
      order.paymentMethod === "CARD" ? "card" : "ramburs (COD)";
    const paidLabel =
      order.paymentMethod === "CARD"
        ? order.paidAt || order.status === "PAID"
          ? "plătită"
          : "neplătită încă"
        : "se achită la livrare (ramburs)";

    const depositLine = deposit
      ? `\nAvans: ${
          deposit.status === "PAID"
            ? `plătit (${Number(deposit.paid || 0).toFixed(2)} RON)`
            : deposit.status === "PENDING"
              ? `solicitat, neplătit încă (${Number(deposit.requested || 0).toFixed(2)} RON)`
              : deposit.status.toLowerCase()
        }`
      : "";

    return {
      resultType: "answer",
      topicId: "orders",

      message:
        `Ultima ta comandă: ${formatOrderShortLabel(order)} - ${statusLabel}.\n` +
        `Vânzător: ${vendorNames.join(", ") || "necunoscut"}\n` +
        `Metodă de plată: ${paymentLabel} (${paidLabel})${depositLine}\n\n` +
        `Spune-mi numărul comenzii dacă vrei să o anulezi sau alte detalii.`,
    };
  }

  if (topic === "DEPOSIT") {
    const withDeposit = withStatus.filter(({ order }) =>
      (order.shipments || []).some(
        (s) => s.depositStatus && s.depositStatus !== "NOT_REQUESTED"
      )
    );

    if (!withDeposit.length) {
      return {
        resultType: "answer",
        topicId: "orders",
        message: "Nu ai nicio comandă cu avans solicitat momentan.",
      };
    }

    const lines = withDeposit
      .slice(0, 5)
      .map(
        ({ order }, i) => `${i + 1}. ${formatOrderShortLabel(order)}`
      );

    return {
      resultType: "answer",
      topicId: "orders",
      message: `Ai ${withDeposit.length === 1 ? "1 comandă" : `${withDeposit.length} comenzi`} cu avans solicitat:\n\n${lines.join("\n")}`,
    };
  }

  const filtered =
    topic === "TOTAL"
      ? withStatus
      : topic === "ACTIVE"
        ? withStatus.filter(
            ({ uiStatus }) =>
              uiStatus === "PENDING" || uiStatus === "PROCESSING" || uiStatus === "SHIPPED"
          )
        : withStatus.filter(({ uiStatus }) => uiStatus === topic);

  if (!filtered.length) {
    return {
      resultType: "answer",
      topicId: "orders",

      message:
        topic === "TOTAL"
          ? `Nu ai avut nicio comandă${periodSuffix || " momentan"}.`
          : `Momentan nu ai comenzi ${USER_ORDER_UI_STATUS_LABEL[topic] || topic.toLowerCase()}${periodSuffix}.`,
    };
  }

  const lines = filtered
    .slice(0, 5)
    .map(({ order, uiStatus }, index) => {
      const label = USER_ORDER_UI_STATUS_LABEL[uiStatus] || uiStatus.toLowerCase();
      return `${index + 1}. ${formatOrderShortLabel(order)} - ${label}`;
    });

  const countPhrase =
    filtered.length === 1 ? "1 comandă" : `${filtered.length} comenzi`;

  const heading =
    topic === "TOTAL"
      ? `Ai ${countPhrase}${periodSuffix || " în total"}.`
      : `Ai ${countPhrase} ${USER_ORDER_UI_STATUS_LABEL[topic] || topic.toLowerCase()}${periodSuffix}.`;

  return {
    resultType: "answer",
    topicId: "orders",

    message: `${heading}\n\nCele mai recente:\n\n${lines.join(
      "\n"
    )}\n\nSpune-mi numărul unei comenzi dacă vrei detalii sau vrei s-o anulezi.`,
  };
}

const ORDER_UI_STATUS_LABELS = {
  PENDING: "în așteptare",
  PROCESSING: "în procesare",
  PREPARING: "în pregătire",
  READY_FOR_PICKUP: "gata de ridicare",
  IN_TRANSIT: "în livrare",
  DELIVERED: "livrată",
  FULFILLED: "finalizată",
  CANCELED: "anulată",
  RETURNED: "returnată",
};

async function handleVendorInsightsQuery({
  audience,
  userSub,
  message,
}) {
  if (audience !== "VENDOR") {
    return {
      resultType: "answer",

      message:
        "Această funcție este disponibilă doar pentru conturi de vânzător.",
    };
  }

  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  /*
   * LIVE DATA - recalculat de fiecare dată, niciodată din istoricul
   * conversației (vezi și handleInsightFollowUp, care re-apelează
   * la fel de fiecare dată). Reset-ul conversației nu afectează
   * deloc capacitatea de a regenera - insight-urile nu depind de
   * conversationContext pentru a fi CALCULATE, doar pentru a fi
   * REGĂSITE dacă vânzătorul continuă discuția despre ele.
   */
  const insights = await getVendorInsights(vendor.id);
  const scope = detectInsightScope(message);
  const scoped = scopeInsights(insights, scope);

  /*
   * ACTIONABLE RECOMMENDATIONS - `insights` trimis către client
   * trebuie să fie EXACT ce apare în text (ca butoanele de sub
   * mesaj să corespundă 1:1 cu recomandările numerotate), nu tot
   * scope-ul complet - de-aia tăiem aici la același cap folosit de
   * formatter (today: TODAY_PLAN_CAP, altfel: INSIGHTS_SHOWN_CAP).
   */
  const shown = scoped.slice(
    0,
    scope === "today" ? TODAY_PLAN_CAP : INSIGHTS_SHOWN_CAP
  );

  return {
    resultType: "answer",

    message:
      scope === "today"
        ? composeTodayPlanAnswer(scoped)
        : composeInsightsAnswer(scope, scoped),

    insights: shown,

    insightContext: buildActiveInsightContext(scope, scoped, shown),
  };
}

/*
 * BATCH 2 (audit regression Vendor Assistant, 2026-09-06) - mirror al
 * lui handleVendorInsightsQuery de mai sus, dar pentru domeniul
 * trafic/vizite/vizualizări (nu "insight-uri" acționabile). Întoarce
 * `null` dacă mesajul nu ține de acest domeniu (vezi
 * detectVisitorAnalyticsTopic din vendorAssistantAnalytics.js) - în
 * acest caz apelantul (mai jos, în EXISTING_FLOW) cade pe
 * comportamentul existent, NESCHIMBAT, pentru comenzi/câștiguri/stoc.
 */
async function handleVendorVisitorAnalyticsQuery({ userSub, message }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const analytics = await answerVendorVisitorAnalyticsQuestion({
    vendorId: vendor.id,
    message,
  });

  if (!analytics) return null;

  return {
    resultType: "answer",
    message: analytics.message,
  };
}

/*
 * BATCH 3 (audit regression Vendor Assistant, 2026-09-06) - mirror al
 * lui handleVendorVisitorAnalyticsQuery de mai sus, dar pentru
 * "câte cereri de ofertă am / noi / în discuții / ofertă trimisă /
 * rezervate / pierdute". Întoarce `null` dacă mesajul nu ține de acest
 * domeniu (vezi detectQuoteLeadTopic din vendorAssistantQuoteLeads.js).
 */
async function handleVendorQuoteLeadQuery({ userSub, message }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const leads = await answerVendorQuoteLeadQuestion({
    vendorId: vendor.id,
    message,
  });

  if (!leads) return null;

  return {
    resultType: "answer",
    message: leads.message,
  };
}

/*
 * BATCH 4 (audit regression Vendor Assistant, 2026-09-06) - mirror al
 * lui handleVendorQuoteLeadQuery de mai sus, dar pentru "câte comenzi
 * am / noi / în lucru / așteaptă expedierea / livrate / anulate /
 * plătite". Întoarce `null` dacă mesajul nu ține de acest domeniu (vezi
 * detectOrderLiveTopic din vendorAssistantOrders.js).
 */
async function handleVendorOrderLiveQuery({ userSub, message, lastCategory }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const orders = await answerVendorOrderLiveQuestion({
    vendorId: vendor.id,
    message,
    lastCategory,
  });

  if (!orders) return null;

  return {
    resultType: "answer",
    message: orders.message,
  };
}

/*
 * BATCH 5 (audit regression Vendor Assistant, 2026-09-06) - mirror al
 * lui handleVendorOrderLiveQuery de mai sus, dar pentru "cât am câștigat
 * / ce comision datorez / ce facturi sunt neachitate / ce comision am
 * plătit luna trecută". Întoarce `null` dacă mesajul nu ține de acest
 * domeniu (vezi detectPaymentsLiveTopic din vendorAssistantPayments.js).
 */
async function handleVendorPaymentsLiveQuery({ userSub, message }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const payments = await answerVendorPaymentsQuestion({
    vendorId: vendor.id,
    message,
  });

  if (!payments) return null;

  return {
    resultType: "answer",
    message: payments.message,
  };
}

/*
 * BATCH D (audit regression Vendor Assistant, 2026-09-07) - mirror al
 * lui handleVendorPaymentsLiveQuery de mai sus, dar pentru "sunt produsul
 * zilei? / sunt artizanul săptămânii? / ce promovări active am / ce
 * campanii am active". Întoarce `null` dacă mesajul nu ține de acest
 * domeniu (vezi detectPromotionsLiveTopic din vendorAssistantPromotions.js).
 */
async function handleVendorPromotionsLiveQuery({ userSub, message }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const promotions = await answerVendorPromotionsQuestion({
    vendorId: vendor.id,
    message,
  });

  if (!promotions) return null;

  return {
    resultType: "answer",
    message: promotions.message,
  };
}

/*
 * BATCH E (audit regression Vendor Assistant, 2026-09-07) - mirror al
 * lui handleVendorPromotionsLiveQuery de mai sus, dar pentru "câte
 * recenzii am / ratingul meu / câte notificări necitite am". Întoarce
 * `null` dacă mesajul nu ține de acest domeniu (vezi
 * detectReviewsLiveTopic din vendorAssistantReviews.js).
 */
async function handleVendorReviewsLiveQuery({ userSub, message }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const reviews = await answerVendorReviewsQuestion({
    vendorId: vendor.id,
    message,
  });

  if (!reviews) return null;

  return {
    resultType: "answer",
    message: reviews.message,
  };
}

/*
 * BATCH 2 (FINAL GAP PASS, 2026-09-07) - mirror al lui
 * handleVendorReviewsLiveQuery de mai sus, dar pentru "câte produse
 * am". Întoarce `null` dacă mesajul nu ține de acest domeniu (vezi
 * detectProductLiveTopic din vendorAssistantProducts.js).
 */
async function handleVendorProductLiveQuery({ userSub, message }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const products = await answerVendorProductQuestion({
    vendorId: vendor.id,
    message,
  });

  if (!products) return null;

  return {
    resultType: "answer",
    message: products.message,
  };
}

/*
 * BATCH 2 (FINAL GAP PASS, 2026-09-07) - mirror al lui
 * handleVendorProductLiveQuery de mai sus, dar pentru "cât am vândut /
 * cele mai vândute produse / produse nevândute". Întoarce `null` dacă
 * mesajul nu ține de acest domeniu (vezi detectSalesLiveTopic din
 * vendorAssistantSales.js).
 */
async function handleVendorSalesLiveQuery({ userSub, message }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const sales = await answerVendorSalesQuestion({
    vendorId: vendor.id,
    message,
  });

  if (!sales) return null;

  return {
    resultType: "answer",
    message: sales.message,
  };
}

/*
 * BATCH 2 (FINAL GAP PASS, 2026-09-07) - mirror al lui
 * handleVendorSalesLiveQuery de mai sus, dar pentru "câte mesaje
 * necitite am / ce conversații am necitite / cine mi-a scris ultima
 * dată / ce conversații nu au răspuns". Întoarce `null` dacă mesajul
 * nu ține de acest domeniu (vezi detectMessagesLiveTopic din
 * vendorAssistantMessages.js).
 */
async function handleVendorMessagesLiveQuery({ userSub, message }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const messages = await answerVendorMessagesQuestion({
    vendorId: vendor.id,
    message,
  });

  if (!messages) return null;

  return {
    resultType: "answer",
    message: messages.message,
  };
}

/*
 * BATCH 2 (FINAL GAP PASS, 2026-09-07) - mirror al lui
 * handleVendorMessagesLiveQuery de mai sus, dar pentru domeniul
 * "tichete de suport" ("a răspuns cineva la tichet / ce tichete sunt
 * deschise/rezolvate / deschide ultimul tichet"). Întoarce `null` dacă
 * mesajul nu ține de acest domeniu (vezi detectSupportLiveTopic din
 * vendorAssistantSupport.js).
 *
 * OWNERSHIP: SupportTicket.requesterId e User.id (userSub), NU
 * Vendor.id - verificăm totuși că userSub e într-adevăr un vendor
 * (`resolveVendorByUserId`), pentru consistență cu restul domeniilor
 * live, dar interogarea reală de tichete folosește userSub direct
 * (vezi comentariul din vendorAssistantSupport.js).
 */
async function handleVendorSupportLiveQuery({ userSub, message }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const support = await answerVendorSupportQuestion({
    userSub,
    message,
  });

  if (!support) return null;

  return {
    resultType: "answer",
    message: support.message,
  };
}

/*
 * INFLUENCER - "privire de ansamblu" (FAZA 2). Mirror EXACT al
 * handleVendorInsightsQuery de mai sus (aceeași categorie
 * VENDOR_INSIGHTS, reutilizată), dar cu propriul sub-router
 * determinist (detectInfluencerQueryScope) în loc de
 * detectInsightScope/scopeInsights, pentru că influencerul are mai
 * multe "domenii" posibile (rezurse/câștiguri/coduri/colecții) decât
 * simplele domenii ale insight-urilor de vânzător.
 *
 * LIVE DATA - recalculat de fiecare dată, nimic din
 * conversationContext (aceeași disciplină ca la vendor).
 */
async function handleInfluencerLiveQuery({ userSub, message }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca influencer pentru asta.",
    };
  }

  const auth = await requireActiveInfluencer(userSub);

  if (auth.error) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un cont de influencer activ asociat contului tău.",
    };
  }

  const { influencerId } = auth;
  const scope = detectInfluencerQueryScope(message);

  let data;

  switch (scope) {
    case "TODAY":
      data = await getInfluencerTodayRecommendations({ influencerId });
      break;

    case "REPOST":
      data = await getInfluencerResources({
        influencerId,
        category: "all",
        activity: "toRepost",
      });
      break;

    case "PRODUCT_OF_DAY":
      data = await getInfluencerResources({
        influencerId,
        category: "PRODUCT_OF_DAY",
        activity: "all",
      });
      break;

    case "ARTISAN_OF_WEEK":
      data = await getInfluencerResources({
        influencerId,
        category: "ARTISAN_OF_WEEK",
        activity: "all",
      });
      break;

    case "NEW_PRODUCTS":
      data = await getInfluencerResources({
        influencerId,
        category: "new_products",
      });
      break;

    case "NEW_VENDORS":
      data = await getInfluencerResources({
        influencerId,
        category: "new_vendors",
      });
      break;

    case "DISCOUNT_CODES":
      data = await getInfluencerDiscountCodes({ influencerId });
      break;

    case "EARNINGS":
      data = await getInfluencerEarnings({ influencerId });
      break;

    case "COLLECTIONS":
      data = await getInfluencerCollections({ influencerId });
      break;

    case "RESOURCES":
      data = await getInfluencerResources({
        influencerId,
        category: "all",
        activity: "all",
      });
      break;

    default:
      data = await getInfluencerSummary({ influencerId });
      break;
  }

  return {
    resultType: "answer",
    message: composeInfluencerAnswer(scope, data),
    influencerScope: scope,
    data,
  };
}

/*
 * INFLUENCER - comenzi atribuite (FAZA 2). Mirror EXACT al
 * handleUserOrdersLiveQuery de mai jos, pentru un cumpărător - vezi
 * ramura "audience === INFLUENCER" din routeCopilotMessage, alături
 * de ramura existentă "audience === USER" pentru ORDER_HELP.
 */
async function handleInfluencerOrdersLiveQuery({ userSub }) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca influencer pentru asta.",
    };
  }

  const auth = await requireActiveInfluencer(userSub);

  if (auth.error) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un cont de influencer activ asociat contului tău.",
    };
  }

  const result = await getInfluencerOrders({
    influencerId: auth.influencerId,
  });

  if (!result.items.length) {
    return {
      resultType: "answer",

      message:
        "Nu ai încă nicio comandă atribuită prin promovarea ta.",

      orders: result.items,
      target: result.target,
    };
  }

  const lines = result.items
    .slice(0, 5)
    .map(
      (order, index) =>
        `${index + 1}. Comanda ${order.orderNumber || "—"} - ${
          order.status
        } - ${order.earningStatus}`
    );

  return {
    resultType: "answer",

    message: `Ultimele tale comenzi atribuite:\n\n${lines.join(
      "\n"
    )}`,

    orders: result.items,
    target: result.target,
  };
}

/*
 * Continuarea unei conversații ancorate de un insight
 * (conversationContext.activeInsight) - DOAR două forme suportate,
 * determinist, fără LLM:
 * 1. confirmare ("da"/"recalculează-le") -> execută suggestedAction
 *    prin ACELAȘI dispatchCommand/action registry ca orice
 *    PLATFORM_ACTION obișnuit (niciun cod de scriere nou aici);
 * 2. cerere de detaliu ("arată-mi produsele") -> listă scurtă,
 *    determinist din insightsService.js, NU navigare/UI nouă.
 */
const SHOW_DETAIL_RE = /arat|vezi|listă|listeaz/i;

/*
 * "toate"/"tot" - vânzătorul vrea TOATE recomandările din scope-ul
 * ultimei întrebări (ex. "Vrei să le vedem pe toate?" -> "da,
 * arată-mi toate"), NU detaliul din spatele UNUI singur insight
 * (acela rămâne SHOW_DETAIL_RE, ex. "arată-mi produsele" - listează
 * produsele individuale din spatele insight-ului cel mai sever).
 * Verificat ÎNAINTEA lui SHOW_DETAIL_RE mai jos.
 */
const SHOW_ALL_RE = /\btoate\b|\btot\b/i;

async function handleInsightFollowUp({
  activeInsight,
  message,
  userSub,
}) {
  if (!userSub) {
    return {
      resultType: "answer",

      message:
        "Trebuie să fii autentificat ca vânzător pentru asta.",
    };
  }

  const vendor = await resolveVendorByUserId(userSub);

  if (!vendor) {
    return {
      resultType: "answer",

      message:
        "Nu am găsit un magazin de vânzător asociat contului tău.",
    };
  }

  const yesNo = detectYesNo(message);

  if (yesNo === "yes" && activeInsight.suggestedAction) {
    const entry = getActionEntry(activeInsight.suggestedAction);

    if (!entry) {
      return {
        resultType: "answer",

        message:
          "Nu mai știu exact la ce te refereai - poți reformula?",
      };
    }

    let parsed = null;

    if (entry.commandType === "RECALCULATE_BATCH") {
      parsed = {
        commandType: "RECALCULATE_BATCH",
        recalculateTarget: null,
        costItemNameForRecalc: null,
      };
    } else if (entry.commandType === "APPLY_RECOMMENDED_PRICE") {
      parsed = {
        commandType: "APPLY_RECOMMENDED_PRICE",
        productName: null,
      };
    }

    if (!parsed) {
      return {
        resultType: "answer",

        message:
          "Nu pot executa automat acest tip de acțiune încă - spune-mi concret ce vrei să schimb.",
      };
    }

    const productId = activeInsight.actionParams?.productId || null;

    const result = await dispatchCommand(vendor.id, parsed, {
      currentEntity: productId
        ? { type: "PRODUCT", id: productId }
        : null,
    });

    return { commandType: entry.commandType, ...result };
  }

  /*
   * "da" dar fără o acțiune neambiguă în activeInsight - fie
   * niciuna dintre recomandările arătate nu are acțiune automată,
   * fie sunt mai multe (vezi buildActiveInsightContext) și nu știm
   * la care se referă vânzătorul. Recalculăm live și explicăm,
   * fără să executăm nimic la nimereală.
   */
  if (yesNo === "yes" && activeInsight.scope) {
    const freshInsights = await getVendorInsights(vendor.id);
    const scoped = scopeInsights(freshInsights, activeInsight.scope);
    const shown = scoped.slice(0, INSIGHTS_SHOWN_CAP);
    const actionable = shown.filter((i) => i.suggestedAction);

    if (actionable.length > 1) {
      const list = shown
        .map(
          (insight, index) =>
            `${index + 1}. ${insight.title}${
              insight.suggestedAction ? " (are acțiune automată)" : ""
            }`
        )
        .join("\n");

      return {
        resultType: "answer",

        message: `La care recomandare te referi?\n\n${list}`,

        insightContext: buildActiveInsightContext(
          activeInsight.scope,
          scoped,
          shown
        ),
      };
    }

    return {
      resultType: "answer",

      message:
        "Niciuna dintre recomandările astea nu are o acțiune automată încă - spune-mi concret ce vrei să schimb.",
    };
  }

  if (yesNo === "no") {
    return {
      resultType: "answer",
      message: "Am înțeles, nu fac nimic acum.",
      insightContext: null,
    };
  }

  if (SHOW_ALL_RE.test(message) && activeInsight.scope) {
    /*
     * LIVE DATA - re-apelăm getVendorInsights din nou (nu refolosim
     * un array vechi ținut în conversationContext), apoi re-aplicăm
     * EXACT același scope ca la întrebarea inițială (vezi
     * detectInsightScope/scopeInsights, aceleași funcții folosite
     * și la handleVendorInsightsQuery) - "toate" înseamnă toate
     * insight-urile din acel scope, calculate ACUM, nu cele arătate
     * ultima dată.
     */
    const freshInsights = await getVendorInsights(vendor.id);
    const scoped = scopeInsights(freshInsights, activeInsight.scope);

    if (!scoped.length) {
      return {
        resultType: "answer",

        message:
          "Nu mai găsesc nimic acum - probabil s-a rezolvat între timp.",

        insightContext: null,
      };
    }

    const list = scoped
      .map(
        (insight, index) =>
          `${index + 1}. ${insight.title} - ${insight.message}`
      )
      .join("\n");

    return {
      resultType: "answer",
      message: list,

      /*
       * ACTIONABLE RECOMMENDATIONS - la fel ca la interogarea
       * inițială, trimitem lista completă ca să poată apărea câte
       * un CTA sub fiecare recomandare afișată.
       */
      insights: scoped,

      /*
       * "arată-mi toate" arată lista COMPLETĂ (scoped), nu doar
       * top-3 - shownInsights trebuie să fie scoped întreg aici,
       * altfel ambiguitatea de acțiune s-ar verifica greșit doar pe
       * primele 3, deși vânzătorul a văzut mai multe.
       */
      insightContext: buildActiveInsightContext(
        activeInsight.scope,
        scoped,
        scoped
      ),
    };
  }

  if (SHOW_DETAIL_RE.test(message)) {
    const items = await getInsightItemsList(
      vendor.id,
      activeInsight.type
    );

    if (!items.length) {
      return {
        resultType: "answer",

        message:
          "Nu mai găsesc detalii pentru asta chiar acum - probabil s-a rezolvat între timp.",

        insightContext: null,
      };
    }

    const list = items
      .map((item, index) => `${index + 1}. ${item.title}`)
      .join("\n");

    return {
      resultType: "answer",
      message: list,
      insightContext: activeInsight,
    };
  }

  return { handled: false };
}

/*
 * FAZA 8-10: triaj de suport - încearcă să rezolve cu AI +
 * knowledge, cere max 1-2 clarificări, propune ticket DOAR dacă
 * nu reușește. NU scrie niciodată ticketul de aici - construiește
 * un draft (buildTicketDraft) afișat ca pendingAction; scrierea
 * reală se face de FRONTEND, prin createSupportTicket() deja
 * existent (POST /api/assistant/support/tickets, neschimbat).
 */
function formatStepsList(steps) {
  return steps.length
    ? `\n\n${steps
        .map((step, index) => `${index + 1}. ${step}`)
        .join("\n")}`
    : "";
}

function buildTicketPendingAction(ticketDraft) {
  return {
    kind: "CREATE_SUPPORT_TICKET",
    ...ticketDraft,

    summary: `${ticketDraft.subject} (prioritate ${ticketDraft.priority})`,
  };
}

async function handleSupportIntelligence({
  category,
  message,
  history,
  audience,
  currentPage,
  currentEntity,
  conversationContext,
}) {
  const isContinuation =
    conversationContext?.activeIntent ===
    "SUPPORT_TROUBLESHOOT";

  const collected =
    conversationContext?.collectedParams || {};

  /*
   * Sub-stare 1: așteptăm STRICT confirmarea "trimit către suport?"
   * - determinist, fără LLM. Calea PRINCIPALĂ e click pe butonul
   * Confirmă/Renunță al pendingAction-ului (nu ajunge aici deloc -
   * frontend-ul execută direct); asta e doar plasa de siguranță
   * pentru un răspuns TASTAT ("da"/"nu") în loc de click.
   */
  if (
    isContinuation &&
    conversationContext.currentFlow ===
      "awaiting_ticket_confirmation"
  ) {
    const ticketDraft = collected.ticketDraft;
    const yesNo = detectYesNo(message);

    if (yesNo === "yes" && ticketDraft) {
      return {
        resultType: "pending_action",

        message:
          "Trimit solicitarea către suport...",

        pendingAction:
          buildTicketPendingAction(ticketDraft),

        autoConfirm: true,
        supportContext: null,
      };
    }

    if (yesNo === "no") {
      return {
        resultType: "answer",

        message:
          "Am înțeles, nu trimit solicitarea către suport. Dacă te răzgândești, scrie-mi din nou.",

        supportContext: null,
      };
    }

    return {
      resultType: "pending_action",

      message:
        "Nu am înțeles răspunsul - vrei să trimit solicitarea către suport?",

      pendingAction: ticketDraft
        ? buildTicketPendingAction(ticketDraft)
        : null,

      supportContext: conversationContext,
    };
  }

  /*
   * Sub-stare 2 (sau tură nouă): evaluăm/reevaluăm problema.
   */
  const effectiveCategory = isContinuation
    ? collected.category || "INCIDENT_OR_BUG"
    : category;

  const clarificationRound = isContinuation
    ? Number(collected.clarificationRound) || 0
    : 0;

  const priorSteps = isContinuation
    ? collected.stepsAttempted || []
    : [];

  /*
   * Răspunsul curent, dacă suntem în continuare, ESTE răspunsul
   * la clarificarea anterioară - îl adăugăm ca pas încercat.
   */
  const stepsAttempted = isContinuation
    ? [...priorSteps, message]
    : priorSteps;

  const manifests = await getRelevantPlatformKnowledge({
    query: message,
    audience,
    currentPage,
    currentEntity,
    conversationContext,
  });

  const evaluation = await evaluateSupportRequest({
    category: effectiveCategory,
    message,
    history,
    audience,
    manifests,
    clarificationRound,
    stepsAttempted,
  });

  if (
    evaluation.decision ===
    SUPPORT_DECISIONS.RESOLVE_WITH_AI
  ) {
    return {
      resultType: "answer",

      message:
        evaluation.message +
        formatStepsList(evaluation.steps),

      supportContext: null,
    };
  }

  if (
    evaluation.decision ===
    SUPPORT_DECISIONS.ASK_CLARIFICATION
  ) {
    return {
      resultType: "answer",
      message: evaluation.message,

      supportContext: {
        activeIntent: "SUPPORT_TROUBLESHOOT",
        currentFlow: "clarifying",

        collectedParams: {
          category: effectiveCategory,
          domain: evaluation.domain,
          clarificationRound: clarificationRound + 1,
          stepsAttempted,
        },
      },
    };
  }

  /*
   * OFFER_TICKET / HIGH_PRIORITY_ESCALATION - propunem, NU creăm.
   *
   * FAZA 3 (bugfix audit): `currentEntity` e parametrul care CHIAR
   * primește entitatea curentă de la frontend (entityFromUrl /
   * resolvedCurrentEntity - vezi derivePageContext.js/
   * CurrentEntityContext.jsx) - `conversationContext?.entityType` de
   * mai jos, dinainte, NU era populat NICIODATĂ de niciun apelant
   * (conversationContext trimis de AiAssistant.jsx/VendorAssistant.jsx
   * conține doar lastCategory/topicChangeStreak/starea de triaj, fără
   * entityType/entityId) - "Entitate legată" nu apărea de fapt
   * NICIODATĂ într-un tichet real, deși parametrul corect exista deja.
   */
  const ticketDraft = buildTicketDraft({
    category: effectiveCategory,
    ticketCategory: evaluation.ticketCategory,
    priority: evaluation.priority,
    audience,
    currentPage,
    message,
    stepsAttempted,
    summary: evaluation.summary,
    domain: evaluation.domain,
    entities: mapEntityTypeToEntities(
      currentEntity?.type,
      currentEntity?.id
    ),
  });

  return {
    resultType: "pending_action",

    message: `${evaluation.message} Nu am reușit să rezolv problema automat. Vrei să o trimit către suport?`,

    pendingAction:
      buildTicketPendingAction(ticketDraft),

    supportContext: {
      activeIntent: "SUPPORT_TROUBLESHOOT",
      currentFlow: "awaiting_ticket_confirmation",

      collectedParams: {
        ticketDraft,
        category: effectiveCategory,
      },
    },
  };
}

/**
 * Punctul de intrare al orchestrării generale. NU înlocuiește
 * assistantChatRoutes.js - dacă mesajul aparține unui flow
 * existent stabil (sau unei categorii încă nemigrate în noua
 * arhitectură), întoarce { handled: false } și apelantul continuă
 * cu fluxul actual, neschimbat.
 */
export async function routeCopilotMessage({
  message,
  history = [],
  audience = "USER",
  userSub = null,
  currentPage = null,
  currentEntity = null,
  conversationContext = null,
}) {
  const safeMessage = String(message || "").trim();

  if (!safeMessage) {
    return { handled: false, reason: "empty_message" };
  }

  /*
   * FAZA 7: contextul activ are PRIORITATE față de reclasificare -
   * dacă o acțiune înregistrată e activă (awaitingField setat de o
   * tură anterioară), continuăm DIRECT în arhitectura nouă, fără
   * să mai chemăm classifyCopilotMessage.
   *
   * BUGFIX (audit) - SCHIMBARE DE SUBIECT: excepția e un mesaj care
   * clar NU mai ține de acțiunea în curs (vezi isTopicChange mai
   * sus) - în acest caz NU tratăm mesajul ca fiind chiar valoarea/
   * numele așteptat. Resetul e sigur aici: câtă vreme suntem în
   * faza de COLECTARE (awaitingField setat), nu există încă nicio
   * scriere pregătită - confirmarea unei acțiuni complete (cardul
   * "Vrei să actualizez...?") e ținută separat, în starea locală a
   * widget-ului (pendingCostingAction), nu în conversationContext -
   * deci nu riscăm să pierdem o scriere în așteptare printr-un
   * reset automat aici.
   */
  let effectiveConversationContext = conversationContext;
  let precomputedClassification = null;

  if (
    conversationContext?.activeAction &&
    isRegisteredAction(conversationContext.activeAction)
  ) {
    if (!detectCancelIntent(safeMessage)) {
      const topicCheck = await classifyCopilotMessage({
        message: safeMessage,
        history,
        audience,
      });

      if (isTopicChange(topicCheck)) {
        /*
         * BUGFIX (audit) - SCHIMBARE DE SUBIECT: aceeași nuanță ca la
         * SUPPORT_TROUBLESHOOT/USER_ORDER_CANCEL mai jos. Cât timp
         * awaitingField e SETAT, suntem încă în COLECTARE (numele
         * produsului, valoarea unui câmp) - nicio scriere nu e încă
         * pregătită, resetul automat e sigur. Dacă awaitingField
         * lipsește dar activeAction e tot setat, colectarea s-a
         * încheiat și un pendingAction (cardul "Vrei să actualizez...?")
         * a fost deja arătat - nu-l abandonăm tăcut, cerem confirmare
         * înainte să trecem la subiectul nou.
         */
        const hasPendingConfirmation =
          !conversationContext.awaitingField;

        if (hasPendingConfirmation) {
          return {
            handled: true,
            category: "PLATFORM_ACTION",
            confidence: null,

            resultType: "answer",

            message:
              "Ai o acțiune în așteptare. Renunț la ea și trecem la subiectul nou?",

            awaitingTopicChangeConfirmation: true,
          };
        }

        effectiveConversationContext = null;
        precomputedClassification = topicCheck;
      }
    }

    if (!precomputedClassification) {
      const result = await handlePlatformAction({
        message: safeMessage,
        history,
        audience,
        userSub,
        conversationContext,
        currentEntity,
      });

      return {
        handled: true,
        category: "PLATFORM_ACTION",
        confidence: null,
        ...result,
      };
    }
  }

  /*
   * PROACTIVE COPILOT: un insight afișat anterior are prioritate
   * față de reclasificare, DAR doar dacă mesajul curent chiar
   * continuă discuția despre el (yes/no sau "arată-mi") -
   * handleInsightFollowUp întoarce { handled: false } dacă mesajul
   * nu se potrivește cu niciuna din formele suportate, caz în care
   * continuăm normal mai jos (nu blocăm conversația pe insight
   * dacă vânzătorul schimbă subiectul).
   */
  if (effectiveConversationContext?.activeInsight) {
    const followUp = await handleInsightFollowUp({
      activeInsight: effectiveConversationContext.activeInsight,
      message: safeMessage,
      userSub,
    });

    if (followUp.handled !== false) {
      return {
        handled: true,
        category: "VENDOR_INSIGHTS",
        confidence: null,
        ...followUp,
      };
    }
  }

  /*
   * FAZA 8-10: la fel, un triaj de suport activ (clarificare sau
   * confirmare de ticket în curs) are prioritate față de
   * reclasificare.
   *
   * BUGFIX (audit) - SCHIMBARE DE SUBIECT: la fel ca la PLATFORM_
   * ACTION mai sus, dar cu o nuanță - dacă există deja un
   * ticketDraft pregătit (vezi collectedParams.ticketDraft),
   * userul a investit deja timp explicând problema, iar un ticket
   * e pe cale să fie propus/confirmat - aici NU resetăm automat,
   * cerem o confirmare scurtă în loc să pierdem tăcut acel context.
   * Dacă suntem încă doar în clarificare (fără draft), resetul
   * automat e sigur, la fel ca la PLATFORM_ACTION.
   */
  if (
    effectiveConversationContext?.activeIntent ===
    "SUPPORT_TROUBLESHOOT"
  ) {
    if (!detectCancelIntent(safeMessage)) {
      const topicCheck = await classifyCopilotMessage({
        message: safeMessage,
        history,
        audience,
      });

      if (isTopicChange(topicCheck)) {
        const hasTicketDraft = Boolean(
          effectiveConversationContext?.collectedParams
            ?.ticketDraft
        );

        if (hasTicketDraft) {
          return {
            handled: true,
            category: "SUPPORT_TROUBLESHOOT",
            confidence: null,

            resultType: "answer",

            message:
              "Ai o problemă de suport în curs de rezolvare. Renunț la ea și trecem la subiectul nou?",

            awaitingTopicChangeConfirmation: true,
          };
        }

        effectiveConversationContext = null;
        precomputedClassification = topicCheck;
      }
    }

    if (!precomputedClassification) {
      const result = await handleSupportIntelligence({
        category: null,
        message: safeMessage,
        history,
        audience,
        currentPage,
        currentEntity,
        conversationContext: effectiveConversationContext,
      });

      return {
        handled: true,
        category: "SUPPORT_TROUBLESHOOT",
        confidence: null,
        ...result,
      };
    }
  }

  /*
   * BUGFIX (audit) - anulare comandă (cumpărător) în curs: aceeași
   * logică de schimbare de subiect ca mai sus - dacă o comandă e
   * deja identificată și în așteptare de confirmare ("da"/"nu"), nu
   * resetăm automat (ar fi ca și cum ai pierde propunerea de
   * anulare deja arătată); dacă suntem doar la clarificare (fără
   * comandă identificată încă), reset automat e sigur.
   */
  if (
    effectiveConversationContext?.activeIntent ===
    "USER_ORDER_CANCEL"
  ) {
    if (!detectCancelIntent(safeMessage)) {
      const topicCheck = await classifyCopilotMessage({
        message: safeMessage,
        history,
        audience,
      });

      if (isTopicChange(topicCheck)) {
        const hasOrderPendingConfirm =
          effectiveConversationContext?.currentFlow ===
            "confirming" &&
          Boolean(
            effectiveConversationContext?.collectedParams
              ?.orderId
          );

        if (hasOrderPendingConfirm) {
          return {
            handled: true,
            category: "PLATFORM_ACTION",
            confidence: null,

            resultType: "answer",

            message:
              "Ai o anulare de comandă în așteptare de confirmare. Renunț la ea și trecem la subiectul nou?",

            awaitingTopicChangeConfirmation: true,
          };
        }

        effectiveConversationContext = null;
        precomputedClassification = topicCheck;
      }
    }

    if (!precomputedClassification) {
      const result = await handleUserOrderCancelFlow({
        message: safeMessage,
        userSub,
        conversationContext: effectiveConversationContext,
        currentEntity,
      });

      return {
        handled: true,
        category: "PLATFORM_ACTION",
        confidence: null,
        ...result,
      };
    }
  }

  /*
   * FINAL E2E FIX PASS (2026-09-07) - fix #3/#4: "Sunt produsul
   * zilei?"/"A răspuns cineva la tichet?" (și restul topicurilor din
   * vendorAssistantPromotions.js/vendorAssistantSupport.js) sunt date
   * LIVE despre contul PROPRIU al vânzătorului - NU trebuie să
   * depindă de interpretarea stocastică a clasificatorului LLM.
   * Confirmat prin testare repetată (E2E): aceleași mesaje, exact
   * identice, au produs 3 categorii diferite ("Sunt produsul zilei?")
   * sau au fost "furate" de triajul generic de suport în ~2/3 din
   * cazuri ("A răspuns cineva la tichet?").
   *
   * Verificăm STRICT aceleași porți deterministe deja scrise și
   * testate în Batch 2 (handleVendorPromotionsLiveQuery/
   * handleVendorSupportLiveQuery, care la rândul lor apelează
   * detectPromotionsLiveTopic/detectSupportLiveTopic - NEMODIFICATE)
   * - dacă mesajul NU se potrivește STRICT unui topic determinist,
   * funcțiile întorc `null` și continuăm normal mai jos, prin
   * clasificare, EXACT ca înainte. Verificat explicit în audit că
   * aceste porți NU prind formulări generice ("Am o problemă cu
   * pagina" nu conține niciun cuvânt din porțile de status tichet).
   */
  if (audience === "VENDOR" && userSub) {
    const earlyPromotionsResult = await handleVendorPromotionsLiveQuery({
      userSub,
      message: safeMessage,
    });

    if (earlyPromotionsResult) {
      return {
        handled: true,
        category: "EXISTING_FLOW",
        confidence: null,
        intentMode: "QUERY_LIVE_DATA",
        ...earlyPromotionsResult,
      };
    }

    const earlySupportResult = await handleVendorSupportLiveQuery({
      userSub,
      message: safeMessage,
    });

    if (earlySupportResult) {
      return {
        handled: true,
        category: "EXISTING_FLOW",
        confidence: null,
        intentMode: "QUERY_LIVE_DATA",
        ...earlySupportResult,
      };
    }
  }

  /*
   * BUGFIX (audit USER, aprobat 2026-09-08) - "A răspuns cineva la
   * tichetul meu de suport?" / "Care este ultimul meu tichet?" erau
   * misclasificate ORDER_HELP de clasificatorul LLM în 4 din 5
   * încercări (variație de eșantionare, nu determinist - vezi raportul
   * USER BATCH 2), întorcând date despre COMENZI la o întrebare despre
   * TICHETE. Fix determinist, ÎNAINTE de clasificator, mirror EXACT al
   * porții VENDOR de mai sus (aceeași structură, aceeași garanție:
   * detectUserSupportTopic e STRICT - o mențiune goală a cuvântului
   * "tichet" fără status/listare explicit întoarce null și cade
   * neschimbat pe clasificare normală, vezi comentariile din
   * userAssistantSupport.js).
   */
  if (audience === "USER" && userSub) {
    const earlyUserSupportResult = await answerUserSupportQuestion({
      userSub,
      message: safeMessage,
      lastCategory: effectiveConversationContext?.lastCategory,
    });

    if (earlyUserSupportResult) {
      return {
        handled: true,
        category: "EXISTING_FLOW",
        confidence: null,
        intentMode: "QUERY_LIVE_DATA",
        ...earlyUserSupportResult,
      };
    }
  }

  const { category, confidence, intentMode, mentionedRole } =
    precomputedClassification ||
    (await classifyCopilotMessage({
      message: safeMessage,
      history,
      audience,
    }));

  if (category === "HELP_OVERVIEW") {
    return {
      handled: true,
      category,
      confidence,
      intentMode,

      resultType: "answer",
      message: buildHelpOverviewAnswer(
        mentionedRole || audience,
        audience
      ),
    };
  }

  if (category === "PLATFORM_KNOWLEDGE") {
    /*
     * BATCH 2 (FINAL GAP PASS, 2026-09-07) - "Deschide ultimul tichet."
     * e o formă imperativă de NAVIGARE fără parametru de modificat -
     * per regula deja existentă a clasificatorului ("NAVIGARE explicită
     * spre o pagină = PLATFORM_KNOWLEDGE", vezi buildClassifierPrompt),
     * ajunge cel mai probabil AICI, nu în lanțul EXISTING_FLOW - nu
     * putea fi rezolvat din knowledge retrieval (nu există id de tichet
     * într-un manifest static). Interceptăm STRICT acest caz, înainte
     * de retrieval, pentru un VENDOR autentificat - restul PLATFORM_
     * KNOWLEDGE rămâne complet neschimbat.
     */
    if (audience === "VENDOR" && userSub) {
      const supportResult = await handleVendorSupportLiveQuery({
        userSub,
        message: safeMessage,
      });

      if (supportResult) {
        return {
          handled: true,
          category,
          confidence,
          intentMode,
          ...supportResult,
        };
      }
    }

    const manifests = await getRelevantPlatformKnowledge(
      {
        query: safeMessage,
        audience,
        currentPage,
        currentEntity,
        conversationContext: effectiveConversationContext,
      }
    );

    const answer = await buildKnowledgeAnswer({
      message: safeMessage,
      history,
      audience,
      manifests,
    });

    return {
      handled: true,
      category,
      confidence,
      intentMode,

      /*
       * Semnal mai fin decât `category` (aici mereu
       * PLATFORM_KNOWLEDGE) pentru sugestia discretă de schimbare
       * de subiect (vezi computeTopicSuggestion,
       * assistantCopilotRoutes.js) - manifestul cel mai relevant
       * distinge "campanii" de "import produse" de "ce este
       * Artfest", lucru pe care category singur nu-l poate.
       */
      topicId: manifests?.[0]?.id || null,

      ...answer,
    };
  }

  if (category === "PLATFORM_ACTION") {
    /*
     * BUGFIX (audit) - "Anulează comanda" pentru un cumpărător: are
     * un handler user-safe REAL (cancelOwnOrder, aceeași rută HTTP
     * ca /api/user/orders/:id/cancel) - nu mai blocăm orbește orice
     * PLATFORM_ACTION pentru non-vendor. Pentru orice ALTĂ acțiune
     * cerută de un USER/GUEST (fără handler safe încă), rămâne
     * răspunsul existent din handlePlatformAction, care explică ce
     * poate face în loc să execute ceva.
     */
    if (
      audience === "USER" &&
      detectOrderCancelIntent(safeMessage)
    ) {
      const result = await handleUserOrderCancelFlow({
        message: safeMessage,
        userSub,
        conversationContext: null,
        currentEntity,
      });

      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...result,
      };
    }

    const result = await handlePlatformAction({
      message: safeMessage,
      history,
      audience,
      userSub,
      conversationContext: effectiveConversationContext,
      currentEntity,
    });

    return {
      handled: true,
      category,
      confidence,
      intentMode,
      ...result,
    };
  }

  if (category === "VENDOR_INSIGHTS") {
    /*
     * INFLUENCER (FAZA 2) - aceeași categorie (VENDOR_INSIGHTS,
     * reutilizată - "privire de ansamblu asupra propriului cont"),
     * dar cu handler-ul dedicat influencerului, care își are propriul
     * sub-router determinist (detectInfluencerQueryScope), nu
     * detectInsightScope (specific vendor).
     */
    if (audience === "INFLUENCER") {
      const result = await handleInfluencerLiveQuery({
        userSub,
        message: safeMessage,
      });

      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...result,
      };
    }

    const result = await handleVendorInsightsQuery({
      audience,
      userSub,
      message: safeMessage,
    });

    return {
      handled: true,
      category,
      confidence,
      intentMode,
      ...result,
    };
  }

  if (SUPPORT_INTELLIGENCE_CATEGORIES.has(category)) {
    /*
     * BUGFIX (audit) - "Ce comenzi am?" (ORDER_HELP + intentMode
     * QUERY_LIVE_DATA, cumpărător autentificat) - date LIVE reale,
     * nu triajul AI generic de suport (care doar întreabă
     * clarificări, nu citește comenzile). Pentru orice altă formă
     * de ORDER_HELP (o problemă, o comandă anume fără id cunoscut),
     * rămâne triajul existent, neschimbat.
     */
    if (
      category === "ORDER_HELP" &&
      intentMode === "QUERY_LIVE_DATA" &&
      audience === "USER" &&
      userSub
    ) {
      const result = await handleUserOrdersLiveQuery({
        userSub,
        message: safeMessage,
        lastCategory: effectiveConversationContext?.lastCategory,
      });

      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...result,
      };
    }

    /*
     * INFLUENCER (FAZA 2) - "comenzile mele" înseamnă comenzile
     * ATRIBUITE prin promovare, nu comenzi de cumpărător - mirror
     * exact al ramurii USER de mai sus, propriul handler.
     */
    if (
      category === "ORDER_HELP" &&
      intentMode === "QUERY_LIVE_DATA" &&
      audience === "INFLUENCER" &&
      userSub
    ) {
      const result = await handleInfluencerOrdersLiveQuery({
        userSub,
      });

      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...result,
      };
    }

    const result = await handleSupportIntelligence({
      category,
      message: safeMessage,
      history,
      audience,
      currentPage,
      currentEntity,
      conversationContext: null,
    });

    return {
      handled: true,
      category,
      confidence,
      intentMode,
      ...result,
    };
  }

  /*
   * GENERAL_CONVERSATION / EXISTING_FLOW - rămân neschimbate,
   * gestionate de assistantChatRoutes.js și de fluxurile locale
   * existente. Fără regresii.
   *
   * BUGFIX (audit) - EXISTING_FLOW cu intentMode QUERY_LIVE_DATA
   * (NU MARKETPLACE_SEARCH) înseamnă mereu date PROPRII de
   * gestiune magazin (produse/costuri/comenzi ale vendorului - vezi
   * definiția QUERY_LIVE_DATA și distincția din categoria
   * EXISTING_FLOW mai sus) - nu are niciun handler pentru un
   * USER/GUEST (nu există "produsele mele" pentru un cumpărător).
   * Fără verificarea asta, mesajul cădea aici cu handled:false, iar
   * widget-ul de client nu are niciun flow care să răspundă -
   * userul rămânea fără niciun răspuns. Semnalul e SEMANTIC
   * (intentMode, calculat deja de classifyCopilotMessage), nu o
   * listă de fraze.
   */
  /*
   * BATCH 2 (audit regression Vendor Assistant, 2026-09-06) - trafic/
   * vizite/vizualizări de produse/surse de trafic, pentru un vendor
   * autentificat. Interceptează STRICT întrebările din acest domeniu
   * (detectVisitorAnalyticsTopic) - orice altă întrebare EXISTING_FLOW/
   * QUERY_LIVE_DATA pentru VENDOR (comenzi, câștiguri, stoc) întoarce
   * `null` de aici și cade neschimbat pe comportamentul de mai jos.
   */
  if (
    category === "EXISTING_FLOW" &&
    intentMode === "QUERY_LIVE_DATA" &&
    audience === "VENDOR"
  ) {
    const analyticsResult = await handleVendorVisitorAnalyticsQuery({
      userSub,
      message: safeMessage,
    });

    if (analyticsResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...analyticsResult,
      };
    }

    /*
     * BATCH 3 - încercăm și domeniul "cereri de ofertă/CRM" înainte de
     * a cădea pe comportamentul existent (comenzi/câștiguri/stoc rămân
     * neatinse, deliberat).
     */
    const quoteLeadResult = await handleVendorQuoteLeadQuery({
      userSub,
      message: safeMessage,
    });

    if (quoteLeadResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...quoteLeadResult,
      };
    }

    /*
     * BATCH 1 (FINAL GAP PASS, 2026-09-07) - ORDINE INVERSATĂ față de
     * varianta inițială (plăți ÎNAINTE de comenzi): coliziune reală,
     * confirmată prin rulare directă pe DB - "Ce comenzi mi-au adus
     * câștig?" trecea de poarta largă a lui detectOrderLiveTopic
     * ("ce comenzi ..."), care rula PRIMUL, și niciodată nu ajungea la
     * detectPaymentsLiveTopic (EARNING_ORDERS, poartă STRICT mai
     * specifică: "comenzi" + "castig" împreună) - întorcea numărul
     * total de comenzi, nu lista comenzilor cu câștig. Verificat că
     * inversarea NU introduce coliziunea inversă: niciun pattern din
     * detectPaymentsLiveTopic nu se declanșează pe un "ce comenzi ..."
     * simplu, fără cuvintele de plată/comision proprii (comision,
     * factura, suma, castigat) - vezi vendorAssistantPayments.js.
     *
     * BATCH 5 - domeniul "plăți/facturi/comision".
     */
    const paymentsLiveResult = await handleVendorPaymentsLiveQuery({
      userSub,
      message: safeMessage,
    });

    if (paymentsLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...paymentsLiveResult,
      };
    }

    /*
     * BATCH 4 - încercăm și domeniul "comenzi" înainte de a cădea pe
     * comportamentul existent (stoc rămâne neatins, deliberat, alt
     * batch).
     */
    const orderLiveResult = await handleVendorOrderLiveQuery({
      userSub,
      message: safeMessage,
      lastCategory: effectiveConversationContext?.lastCategory,
    });

    if (orderLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...orderLiveResult,
      };
    }

    /*
     * BATCH D - încercăm și domeniul "promovări/campanii" înainte de a
     * cădea pe comportamentul existent (stoc rămâne neatins, deliberat,
     * alt batch).
     */
    const promotionsLiveResult = await handleVendorPromotionsLiveQuery({
      userSub,
      message: safeMessage,
    });

    if (promotionsLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...promotionsLiveResult,
      };
    }

    /*
     * BATCH E - încercăm și domeniul "recenzii/notificări" înainte de
     * a cădea pe comportamentul existent.
     */
    const reviewsLiveResult = await handleVendorReviewsLiveQuery({
      userSub,
      message: safeMessage,
    });

    if (reviewsLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...reviewsLiveResult,
      };
    }

    /*
     * BATCH 2 (FINAL GAP PASS, 2026-09-07) - 4 domenii noi. Gate-urile
     * proprii (produse/vânzări/mesaje/tichete) nu se suprapun cu nimic
     * din cele 6 de mai sus - verificat explicit în fiecare detect*
     * function (ex. vendorAssistantProducts.js exclude "vandut"/"stoc"
     * ca să nu fure de la vendorAssistantSales.js/insightsService.js).
     */
    const productLiveResult = await handleVendorProductLiveQuery({
      userSub,
      message: safeMessage,
    });

    if (productLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...productLiveResult,
      };
    }

    const salesLiveResult = await handleVendorSalesLiveQuery({
      userSub,
      message: safeMessage,
    });

    if (salesLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...salesLiveResult,
      };
    }

    const messagesLiveResult = await handleVendorMessagesLiveQuery({
      userSub,
      message: safeMessage,
    });

    if (messagesLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...messagesLiveResult,
      };
    }

    const supportLiveResult = await handleVendorSupportLiveQuery({
      userSub,
      message: safeMessage,
    });

    if (supportLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...supportLiveResult,
      };
    }

    /*
     * FIX #1 (vezi isCatalogHealthQuestion mai sus) - ULTIMA încercare
     * din acest lanț, DOAR dacă niciun tool determinist de mai sus
     * (produse/vânzări/mesaje/suport/comenzi/plăți/promovări/recenzii/
     * trafic/cereri) n-a răspuns deja ȘI mesajul e clar despre
     * sănătatea catalogului (stoc/ascuns/inactiv/probleme/incomplet/
     * de îmbunătățit) - cade pe EXACT același handler ca categoria
     * VENDOR_INSIGHTS, fără duplicare de query.
     */
    if (isCatalogHealthQuestion(safeMessage)) {
      const insightsFallbackResult = await handleVendorInsightsQuery({
        audience,
        userSub,
        message: safeMessage,
      });

      if (insightsFallbackResult) {
        return {
          handled: true,
          category,
          confidence,
          intentMode,
          ...insightsFallbackResult,
        };
      }
    }
  }

  /*
   * BUGFIX (audit USER, 2026-09-08) - CORECTAT: acest fallback
   * afirma orbește "disponibil doar pentru vânzători" pentru
   * ORICE non-VENDOR/ADMIN care ajunge aici cu QUERY_LIVE_DATA -
   * FALS pentru un USER care întreabă despre propriile mesaje/
   * cereri de ofertă/notificări/tichete (funcții reale de
   * cumpărător, doar fără live tool dedicat încă, vezi
   * handleUserOrdersLiveQuery - singurul domeniu USER implementat
   * momentan). Confirmat reproductibil (4/4): "Câte mesaje
   * necitite am?"/"Câte cereri de ofertă am?"/"Câte notificări
   * necitite am?"/"Câte tichete am?" primeau toate acest răspuns
   * fals. NU construim live tools noi aici (scop STRICT minim,
   * aprobat) - doar oprim dezinformarea, cădem pe ACELAȘI fallback
   * de knowledge retrieval+sinteză ca FIX #6 de mai jos (EXISTING_
   * FLOW+EXPLAIN) - dacă există cunoștință relevantă (ex.
   * messages.manifest.js spune deja onest "e calculat live, nu am
   * o valoare statică"), o folosește; altfel buildKnowledgeAnswer
   * cade singur pe fallback-ul standard "Nu găsesc o informație
   * sigură despre asta..." (audit 2026-09-24), niciodată pe
   * afirmația falsă de rol.
   */
  /*
   * USER BATCH 2 (audit USER, 2026-09-08) - Messages Live: interceptează
   * STRICT întrebările reale despre propriile mesaje/conversații
   * ("câte mesaje necitite am", "ce conversații nu au răspuns" etc.)
   * pentru un USER autentificat, ÎNAINTE de fallback-ul generic de mai
   * jos. Ownership identic cu userMessagesRoutes.js (where: { userId }).
   * Dacă mesajul nu e despre mesaje (answerUserMessagesQuestion
   * întoarce null), cade neschimbat pe fallback-ul de knowledge.
   */
  if (
    category === "EXISTING_FLOW" &&
    intentMode === "QUERY_LIVE_DATA" &&
    audience === "USER" &&
    userSub
  ) {
    const messagesLiveResult = await answerUserMessagesQuestion({
      userSub,
      message: safeMessage,
      lastCategory: effectiveConversationContext?.lastCategory,
    });

    if (messagesLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...messagesLiveResult,
      };
    }

    const quotesLiveResult = await answerUserQuotesQuestion({
      userSub,
      message: safeMessage,
      lastCategory: effectiveConversationContext?.lastCategory,
    });

    if (quotesLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...quotesLiveResult,
      };
    }

    const notificationsLiveResult = await answerUserNotificationsQuestion({
      userSub,
      message: safeMessage,
      lastCategory: effectiveConversationContext?.lastCategory,
    });

    if (notificationsLiveResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...notificationsLiveResult,
      };
    }

    const supportLiveUserResult = await answerUserSupportQuestion({
      userSub,
      message: safeMessage,
      lastCategory: effectiveConversationContext?.lastCategory,
    });

    if (supportLiveUserResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...supportLiveUserResult,
      };
    }

    const reviewsLiveUserResult = await answerUserReviewsQuestion({
      userSub,
      message: safeMessage,
      lastCategory: effectiveConversationContext?.lastCategory,
    });

    if (reviewsLiveUserResult) {
      return {
        handled: true,
        category,
        confidence,
        intentMode,
        ...reviewsLiveUserResult,
      };
    }
  }

  if (
    category === "EXISTING_FLOW" &&
    intentMode === "QUERY_LIVE_DATA" &&
    audience !== "VENDOR" &&
    audience !== "ADMIN"
  ) {
    const manifests = await getRelevantPlatformKnowledge({
      query: safeMessage,
      audience,
      currentPage,
      currentEntity,
      conversationContext: effectiveConversationContext,
    });

    const answer = await buildKnowledgeAnswer({
      message: safeMessage,
      history,
      audience,
      manifests,
    });

    return {
      handled: true,
      category,
      confidence,
      intentMode,
      topicId: manifests?.[0]?.id || null,
      ...answer,
    };
  }

  /*
   * FIX #6 (FINAL E2E FIX PASS, 2026-09-07) - "EXISTING_FLOW +
   * EXPLAIN" e o combinație pe care clasificatorul n-ar trebui s-o
   * producă (regula PASUL 2 spune explicit "intentMode EXPLAIN →
   * aproape întotdeauna PLATFORM_KNOWLEDGE"), dar a fost confirmată,
   * ocazional, prin testare E2E repetată ("Unde văd comenzile?" ->
   * handled:false, mesaj gol, o dată din 4 încercări identice -
   * variație de eșantionare LLM, nu bug determinist). Indiferent de
   * cauză, un mesaj EXPLAIN nu trebuie NICIODATĂ să rămână fără
   * răspuns - fallback sigur, robust în ROUTER (nu în classifier):
   * tratăm exact ca PLATFORM_KNOWLEDGE, aceeași retrieval + sinteză.
   * Nu schimbă nimic pentru cazul normal (EXISTING_FLOW + EXPLAIN
   * apare STRICT ca eroare de clasificare, nu ca flux valid - toate
   * EXISTING_FLOW valide sunt QUERY_LIVE_DATA sau MARKETPLACE_SEARCH,
   * tratate deja mai sus).
   */
  if (category === "EXISTING_FLOW" && intentMode === "EXPLAIN") {
    const manifests = await getRelevantPlatformKnowledge({
      query: safeMessage,
      audience,
      currentPage,
      currentEntity,
      conversationContext: effectiveConversationContext,
    });

    const answer = await buildKnowledgeAnswer({
      message: safeMessage,
      history,
      audience,
      manifests,
    });

    return {
      handled: true,
      category,
      confidence,
      intentMode,
      topicId: manifests?.[0]?.id || null,
      ...answer,
    };
  }

  return {
    handled: false,
    category,
    confidence,
    intentMode,
    delegateTo: "assistantChatRoutes",
  };
}

export { getActionEntry };
