# Sameday – ce blochează activarea în PRODUCȚIE

Stare la 2026-11-04, după auditul API custom documentation v3.6 (28.09.2026) + Swagger
și după separarea DEMO / production (`backend/src/couriers/samedayEnvironment.js`).
Acest document NU activează nimic. Fiecare punct cere decizie / aprobare separată.

Separarea mediilor este implementată (local, necomis): `SAMEDAY_ACTIVE_ENVIRONMENT`
obligatoriu, un cont PLATFORM per mediu, mediul salvat pe fiecare AWB nou și verificat
la recuperare / etichetă / anulare / status-sync, production blocat din DEV / local.
Punctele de mai jos rămân DESCHISE.

## 1. Decontarea costului returului (STANDARD RETURN, service 10) – BLOCANT

- `awbPayment = 1`: Sameday facturează mereu contul Artfest, oricine ar suporta costul.
- `awbCost` se păstrează în `CourierAwb.providerMeta.cost`, dar
  `recordCarrierCost` refuză explicit expedierile RETURN
  (`backend/src/services/shipping/shippingBilling.js`).
- `ReturnRequest.costBearer` (VENDOR / CUSTOMER / ARTFEST / SPLIT) este doar o decizie
  Admin: nu produce înregistrare financiară, reținere din rambursare sau ledger vendor.
- De decis (fără presupuneri fiscale): sursa costului (awbCost vs. factura Sameday),
  efectul fiecărui `costBearer`, documentul justificativ, momentul înregistrării,
  ce se întâmplă la anularea AWB-ului.

## 2. Tracking automat RETURN – BLOCANT

- Evenimentele status-sync ale AWB-urilor de retur se leagă corect de AWB, dar rămân
  doar în timeline (`return_shipment_unmapped`, `couriers/tracking/statusMapping.js`).
- Lipsesc: maparea statusurilor de retur (ridicat de la client, ridicare eșuată /
  client absent, livrat la vendor), tranzițiile `PICKUP_REQUESTED -> în tranzit ->
  primit` pe Shipment RETURN + ReturnRequest, notificările aferente, tratarea
  coletului OUTBOUND aflat în retur (`inReturn = true`).
- Bază: `GET /api/public/status-list` din DEMO (pasul `status-list` al
  `backend/scripts/samedayDemoProbe.mjs`). Fără închidere / refund automat.

## 3. Paginarea și timpul status-sync – BLOCANT

- Paginarea se oprește la `items.length < countPerPage (500)`
  (`couriers/tracking/statusSyncWorker.js`). Dacă Sameday plafonează pagina mai jos,
  se citește doar prima pagină, fără eroare. De înlocuit cu `perPage` din răspuns /
  pagină goală + test pentru pagină plafonată.
- Formatul `startTimestamp` / `endTimestamp` nu e documentat: jobul refuză să
  pornească fără `statusSyncTimestampFormat` (pasul `status-sync-format` în DEMO).
- `statusDate` fără fus orar explicit devine `occurredAt = null` – de confirmat
  fusul orar.
- De confirmat cu Sameday: filtrul ferestrei e pe data statusului sau pe data
  înregistrării (risc de evenimente pierdute cu lag de 2 minute).

## 4. Validarea tarifelor – BLOCANT pentru checkout cu tarif Sameday

- Ramburs: `estimate-cost` se apelează cu `cashOnDelivery = 0`; dacă Sameday taxează
  rambursul, prețul afișat la COD e subestimat (pasul `estimate` compară 0 vs. > 0).
- OOH: Swagger nu listează `oohLastMile` la `estimate-cost`; tariful easybox / PUDO
  se estimează ca livrare la adresa locației – de confirmat că e același.
- `supportedPayment` (ooh-locations) nu e citit: o locație fără plată cu cardul poate
  fi aleasă pentru COD – de confirmat cu Sameday.
- `packageType = 1` pentru orice colet ≤ 1 kg („small package, e.g. envelope”) –
  de confirmat.

## 5. Alte confirmări / pregătiri înainte de producție

- Clasificarea vendorilor PFA / II / IF ca destinatar al returului (persoană fizică /
  juridică) – blocați controlat până la confirmarea Sameday.
- ID-uri explicite `lockerServiceId` / `pudoServiceId` pe contul production
  (recunoașterea după denumire e doar rezervă).
- AWB-uri existente fără mediu: listare read-only cu
  `backend/scripts/listAwbsWithoutEnvironment.mjs`, rezolvare manuală (nu se presupune
  production).
- Migrațiile aplicate doar pe DEV (retururi, checkout Sameday, adrese salvate) –
  aplicare pe producție cu aprobare, înainte de deploy.
- Render production: `SAMEDAY_ACTIVE_ENVIRONMENT=production` + contul PLATFORM cu
  `environment = production` explicit. Fără ele, integrarea Sameday rămâne OPRITĂ
  (checkout-ul COD / CARD funcționează cu tariful de rezervă al vendorului).
