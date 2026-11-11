# Sincronizarea stocului după comenzile Artfest — ce rămâne de implementat

Stare (2026-10-28): importul WooCommerce și motorul de sincronizare există,
dar **nimic nu e conectat la comenzi** și nimic nu rulează automat.

- `stockSync.recordArtfestStockChanges(tx, movements)` există, testat, dar
  **nu e apelat** nicăieri.
- Workerul (`syncQueue.runWorkerOnce` + `syncHandlers`) nu e pornit:
  `EXTERNAL_SYNC_WORKER_ENABLED` e oprit, nu există cron / proces.
- Webhook-urile (`webhooks.ingestWebhook`) nu sunt montate pe nicio rută.
- Interfața afișează „Sincronizare automată: Neactivată”.

Până la pașii de mai jos, un produs importat are stocul **înghețat** la
valoarea din momentul importului, iar o vânzare pe Artfest NU scade stocul
din WooCommerce (risc de supravânzare dacă produsul se vinde în ambele
locuri).

## 1. Legarea mișcărilor de stoc Artfest de coadă

Punctele unice prin care trec toate comenzile și anulările:

| Eveniment | Funcție | Fișier |
|---|---|---|
| comandă plasată (coș, invitat, campanie) | `recordOrderMovements` | `services/inventory/inventoryService.js` |
| anulare client / vânzător / Admin, retur | `restoreOrderItemsStock` | același |
| expirarea plății CARD | `restoreOrderItemsStock` (prin `cardPaymentExpiry`) | `services/cardPaymentExpiry.js` |

De făcut:

1. În ambele funcții, după inserarea mișcărilor, apelează
   `recordArtfestStockChanges(tx, mișcăriInserate)` **în aceeași tranzacție**
   (scrierea `pendingOutboundDelta` + jobul `PUSH_STOCK` se confirmă sau se
   anulează împreună cu comanda).
2. **Idempotență:** `createMany({ skipDuplicates: true })` întoarce doar
   numărul. La o reîncercare (aceeași cheie `idempotencyKey`), mișcările
   sărite NU trebuie trimise din nou, altfel `pendingOutboundDelta` se
   dublează. Varianta corectă: `createManyAndReturn` (doar rândurile
   inserate efectiv), sau citirea după `idempotencyKey` a rândurilor create
   în tranzacție.
3. Calea veche `restoreProductStock` (comenzi fără mișcări, dinainte de
   migrație) nu are mișcări: pentru produsele legate trebuie generate
   mișcări `ORDER_CANCELLED` sau tratată explicit (altfel anularea nu ajunge
   în magazin).
4. Teste: comandă / anulare / expirare pe produs legat → exact un job
   `PUSH_STOCK` (dedupe pe unitatea de stoc), delta corectă; reîncercarea
   aceleiași comenzi nu dublează; produs nelegat / conexiune deconectată /
   `syncStock=false` → nimic.

**Regulă:** checkout-ul nu așteaptă niciodată magazinul extern. Doar scrie în
coadă, în tranzacție; trimiterea o face workerul.

## 2. Stocul modificat manual în Artfest

Editorul de produs (vânzător și Admin) schimbă `readyQty`, `stockQty` și
`variantPoolQty` **fără** mișcare de stoc. Motivul `MANUAL_ADJUST` există în
schemă, dar nu îl scrie nimic. Pentru produsele legate:

- `stockMaster = ARTFEST`: modificarea manuală trebuie să genereze
  `MANUAL_ADJUST` + `PUSH_STOCK` (magazinul primește valoarea absolută);
- `stockMaster = EXTERNAL`: modificarea manuală va fi suprascrisă la
  următoarea citire din magazin; editorul trebuie să o spună clar (sau să
  blocheze câmpul de stoc pentru produsele legate).

## 3. Workerul

- Proces separat sau interval în `server.js`, pornit doar cu
  `EXTERNAL_SYNC_WORKER_ENABLED=true`. Pe Render, atenție la mai multe
  instanțe: `claimJobs` folosește `FOR UPDATE SKIP LOCKED`, deci e sigur cu
  mai mulți workeri.
- La fiecare tură: `recoverStaleJobs`, apoi `runWorkerOnce` cu handlerele
  `PUSH_STOCK`, `PULL_STOCK`, `PROCESS_WEBHOOK`, `RECONCILE`.
- Conexiunile cu `isPaused=true` sunt deja excluse la `claimJobs`.
- Joburile `DEAD` (după 8 încercări) apar în „Starea conexiunii”. Trebuie
  stabilit cine e alertat (vânzătorul, Admin).
- După pornire, interfața trebuie să afișeze „activă” doar dacă workerul a
  rulat recent (de exemplu un `lastSyncAt` recent), nu doar dacă flag-ul e
  pornit. `status.automaticSync` din `vendorIntegrationsRoutes.js` trebuie
  legat de această stare reală.

## 4. Webhook-urile WooCommerce (magazin → Artfest)

- Rută publică `POST /api/integrations/webhooks/woocommerce/:connectionId`,
  cu corpul **brut** (semnătura HMAC se calculează pe octeții primiți),
  montată înainte de `express.json()`.
- Secretul webhook-ului e generat deja la conectare
  (`connectionStore.newWebhookSecret`, criptat). Lipsește crearea
  webhook-urilor în magazin (`product.updated`) prin API și ștergerea lor la
  deconectare.
- `ingestWebhook` salvează evenimentul și pune `PROCESS_WEBHOOK` în coadă;
  răspunsul către WooCommerce trebuie să fie rapid (2xx), fără procesare
  sincronă.
- Rezervă: reconcilierea periodică (`RECONCILE`, de exemplu la 6 ore)
  recuperează webhook-urile pierdute.

## 5. Cazuri de decis înainte de activare

- **Supravânzare simultană** (vândut pe Artfest și în magazin în aceeași
  secundă): Artfest scade atomic, iar magazinul primește delta. Dacă
  magazinul ajunge sub 0, `pushStock` raportează `oversold`. Trebuie decis
  cine e anunțat și ce se face cu comanda.
- **Produse la Târg:** sunt sărite (`fairProductLock`). Trebuie confirmat că
  la ieșirea din Târg stocul online se reconciliază.
- **Rezerva de siguranță** se aplică doar când `stockMaster = EXTERNAL` (la
  citire). Pentru `ARTFEST` trebuie decis dacă se scade și la trimitere.
- **Variante „parent”** (stoc comun în WooCommerce): delta merge pe
  legătura produsului (`externalVariantId = ""`). Testat simulat; de
  verificat pe un magazin real.
- **Limitări WooCommerce la scriere:** vezi comentariul din
  `adapters/woocommerce/adapter.js` (fără tranzacții, scriere relativă prin
  citire + scriere, posibile coliziuni cu modificări manuale în WP-admin).

## 6. Ordinea recomandată de activare

1. Pasul 1 (legarea comenzilor) + teste, cu workerul încă oprit: joburile
   doar se acumulează. Se verifică pe DEV ce s-ar trimite.
2. Workerul pornit pe DEV, cu un magazin de test, doar `PUSH_STOCK`.
3. Webhook-urile + reconcilierea pe DEV.
4. Producție: întâi un singur vânzător pilot, cu `safetyBufferQty > 0`.
