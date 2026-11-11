// backend/scripts/samedayDemoProbe.mjs
//
// Verificări Sameday DEMO, UN PAS PE RULARE, fiecare cu aprobare explicită.
// NU folosește baza de date și NU scrie nimic în Artfest. Rulează doar dacă
// garda (src/couriers/samedayDemoGuard.js) acceptă: SAMEDAY_ACTIVE_ENVIRONMENT=demo,
// NODE_ENV != production, URL-ul rezolvat = exact https://sameday-api.demo.zitec.com,
// credentiale DEMO separate. Fetch-ul procesului e restrâns la originea DEMO.
//
// Pași de CITIRE (--i-approve-demo-requests):
//   services            serviciile active (7 / 10 / 15 / 24 / 57 prezente?)
//   pickup-points       punctele de ridicare + id-urile persoanelor de contact
//   status-list         statusurile Sameday (bază pentru statusMap)
//   status-sync-format  aceeași fereastră de 2h în cele 3 formate candidate
//                       (unix_seconds / unix_ms / iso8601) + forma brută statusDate
// Pași de SCRIERE în DEMO (în plus --i-approve-demo-writes; AWB: COURIER_AWB_LIVE_ENABLED=true):
//   estimate            estimate-cost 24H cu ramburs 0 și cu ramburs > 0
//   awb-outbound        AWB service SAMEDAY_DEMO_SERVICE_ID + etichete A6 / A4
//   awb-return          AWB Retur standard (service 10) + etichetă A6
//   recovery            AWB cu răspunsul pierdut intenționat -> GET /api/client/awb/{ref}
//   cancel              --awb <număr>: anulare + a doua anulare (codul de răspuns)
//
// Variabile: SAMEDAY_DEMO_API_USERNAME / SAMEDAY_DEMO_API_PASSWORD (obligatorii);
// pentru scriere: SAMEDAY_DEMO_PICKUP_POINT_ID, SAMEDAY_DEMO_SERVICE_ID (din pașii
// de citire), opțional SAMEDAY_DEMO_CONTACT_PERSON_ID, SAMEDAY_DEMO_COUNTY_ID /
// SAMEDAY_DEMO_CITY_ID (ID-uri DEMO pentru adresele fictive de test).
//
// Exemplu (după aprobare):
//   SAMEDAY_ACTIVE_ENVIRONMENT=demo node --env-file=.env.sameday-demo \
//     scripts/samedayDemoProbe.mjs --step services --i-approve-demo-requests
//
// Ieșirea nu conține token / parolă; datele de test sunt fictive.

import { assertDemoProbeAllowed, demoOnlyFetch, DemoProbeRefused } from "../src/couriers/samedayDemoGuard.js";

let guard;
try {
  guard = assertDemoProbeAllowed({ env: process.env, argv: process.argv });
} catch (e) {
  console.error(e instanceof DemoProbeRefused ? e.message : "Oprit.");
  process.exit(1);
}

// fetch restrâns la DEMO ÎNAINTE de a încărca orice cod care ar putea face cereri
const hooks = {};
globalThis.fetch = demoOnlyFetch(globalThis.fetch.bind(globalThis), hooks);

const { samedayProvider: provider } = await import("../src/couriers/providers/sameday/index.js");
const { serializeSyncTimestamp, SYNC_TIMESTAMP_FORMATS, MAX_SYNC_WINDOW_MS } = await import("../src/couriers/tracking/statusSyncTime.js");

const env = (k) => String(process.env[k] ?? "").trim();
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const ctx = { accountId: "sameday-demo-probe", credentials: guard.credentials, publicConfig: { environment: "demo" } };
const errInfo = (e) => ({ error: e?.code || e?.name || "error", providerStatus: e?.providerStatus ?? null, fields: e?.fields || [] });
const out = (label, value) => console.log(label, JSON.stringify(value));
const ref = (suffix) => `ARTFEST-DEMO-${Date.now()}-${suffix}`;

// adrese FICTIVE de test (DEMO)
const place = () => ({
  county: "Bucuresti",
  city: "Sectorul 1",
  countyId: env("SAMEDAY_DEMO_COUNTY_ID") || null,
  cityId: env("SAMEDAY_DEMO_CITY_ID") || null,
  postalCode: null,
});
const vendorParty = () => ({ name: "Artfest Test Vendor", phone: "0700000001", email: "vendor.demo@example.com", address: "Strada Test 1", personType: 0, company: null, ...place() });
const customerParty = () => ({ name: "Artfest Test Client", phone: "0700000002", email: "client.demo@example.com", address: "Strada Test 2", personType: 0, company: null, ...place() });

function writeConfig() {
  const pickupPointId = env("SAMEDAY_DEMO_PICKUP_POINT_ID");
  const serviceId = env("SAMEDAY_DEMO_SERVICE_ID");
  if (!pickupPointId || !serviceId) {
    throw new DemoProbeRefused("Lipsesc SAMEDAY_DEMO_PICKUP_POINT_ID / SAMEDAY_DEMO_SERVICE_ID (din pașii pickup-points / services). Nicio cerere de scriere nu a fost trimisă.");
  }
  return { pickupPointId, serviceId, contactPersonId: env("SAMEDAY_DEMO_CONTACT_PERSON_ID") || null };
}

function outboundInput({ clientReference, codAmount = 0 }) {
  const cfg = writeConfig();
  return {
    clientReference,
    serviceId: cfg.serviceId,
    pickupPointId: cfg.pickupPointId,
    contactPersonId: cfg.contactPersonId,
    parcels: [{ weightKg: 1.5, lengthCm: 30, widthCm: 20, heightCm: 10 }],
    codAmount,
    declaredValue: 0,
    recipient: customerParty(),
    thirdParty: vendorParty(),
    oohLastMile: null,
    observation: "Test DEMO Artfest",
  };
}

async function labels(awbNumber, formats) {
  for (const format of formats) {
    try {
      const l = await provider.getLabel(ctx, awbNumber, { format });
      out(`Etichetă ${format}:`, { bytes: l.buffer.length, pdf: l.buffer.subarray(0, 5).toString("latin1") === "%PDF-" });
    } catch (e) {
      out(`Etichetă ${format} eșuată:`, errInfo(e));
    }
  }
}

const created = [];

try {
  console.log(`Pas: ${guard.step} | URL: ${guard.baseUrl}`);
  switch (guard.step) {
    case "services": {
      const services = await provider.listServices(ctx);
      out("Servicii active:", services);
      const ids = new Set(services.map((s) => String(s.id)));
      out("Prezente:", Object.fromEntries(["7", "10", "15", "24", "57"].map((id) => [id, ids.has(id)])));
      break;
    }
    case "pickup-points":
      out("Puncte de ridicare:", await provider.listPickupPoints(ctx));
      break;
    case "status-list": {
      const list = await provider.fetchStatusList(ctx);
      out("Total:", { total: list.total, pages: list.pages });
      out("Statusuri:", list.items.map((s) => ({ id: s.id, label: s.label, reasons: s.reasons.length })));
      break;
    }
    case "status-sync-format": {
      const endArg = env("SAMEDAY_DEMO_SYNC_END");
      const end = endArg ? new Date(endArg) : new Date(Date.now() - 5 * 60 * 1000);
      if (!Number.isFinite(end.getTime())) throw new DemoProbeRefused("SAMEDAY_DEMO_SYNC_END nu e o dată validă.");
      const start = new Date(end.getTime() - MAX_SYNC_WINDOW_MS);
      for (const format of SYNC_TIMESTAMP_FORMATS) {
        const params = { startTimestamp: serializeSyncTimestamp(start, format), endTimestamp: serializeSyncTimestamp(end, format), page: 1, countPerPage: 100 };
        try {
          const res = await provider.fetchStatusSync(ctx, params);
          out(`Format ${format}:`, {
            ok: true,
            sent: { startTimestamp: params.startTimestamp, endTimestamp: params.endTimestamp },
            currentPage: res.currentPage,
            perPage: res.perPage,
            items: res.items.length,
            statusDateSamples: res.items.slice(0, 3).map((i) => i.statusDate),
          });
        } catch (e) {
          out(`Format ${format}:`, { ok: false, ...errInfo(e) });
        }
      }
      break;
    }
    case "estimate": {
      for (const codAmount of [0, 150]) {
        try {
          out(`Estimare (ramburs ${codAmount}):`, await provider.estimateCost(ctx, outboundInput({ clientReference: "estimate", codAmount })));
        } catch (e) {
          out(`Estimare (ramburs ${codAmount}) eșuată:`, errInfo(e));
        }
      }
      break;
    }
    case "awb-outbound": {
      const r = await provider.createShipment(ctx, outboundInput({ clientReference: ref("OUT") }));
      created.push(r.awbNumber);
      out("AWB OUTBOUND:", r);
      await labels(r.awbNumber, ["A6", "A4"]);
      break;
    }
    case "awb-return": {
      const services = await provider.listServices(ctx);
      if (!services.some((s) => String(s.id) === "10")) throw new DemoProbeRefused("Serviciul 10 (Retur standard) nu este activ pe contul DEMO. Nimic creat.");
      const base = outboundInput({ clientReference: ref("RET") });
      // Retur standard (PDF v3.6): thirdParty = clientul (ridicare), awbRecipient = vendorul
      const r = await provider.createShipment(ctx, { ...base, serviceId: "10", codAmount: 0, thirdParty: customerParty(), recipient: vendorParty(), observation: "Retur test DEMO Artfest" });
      created.push(r.awbNumber);
      out("AWB RETUR:", r);
      await labels(r.awbNumber, ["A6"]);
      break;
    }
    case "recovery": {
      const clientReference = ref("REC");
      // răspunsul la POST /api/awb e pierdut INTENȚIONAT, după ce Sameday l-a procesat
      let dropped = false;
      hooks.afterResponse = async (url, init) => {
        if (!dropped && init?.method === "POST" && /\/api\/awb$/.test(new URL(url).pathname)) {
          dropped = true;
          throw Object.assign(new Error("răspuns pierdut (simulat)"), { name: "AbortError" });
        }
      };
      try {
        await provider.createShipment(ctx, outboundInput({ clientReference }));
        out("Neașteptat: răspunsul nu a fost pierdut", {});
      } catch (e) {
        out("Creare cu răspuns pierdut ->", errInfo(e));
      }
      hooks.afterResponse = null;
      const found = await provider.findShipmentByReference(ctx, clientReference);
      if (found) created.push(found.awbNumber);
      out("Recuperat după referință:", { clientReference, found });
      break;
    }
    case "cancel": {
      const awb = String(arg("awb") || "").trim();
      if (!/^[A-Za-z0-9]{4,40}$/.test(awb)) throw new DemoProbeRefused("Lipsește --awb <număr AWB DEMO>. Nimic anulat.");
      for (const attempt of ["prima anulare", "a doua anulare"]) {
        try {
          out(`${attempt}:`, await provider.cancelShipment(ctx, awb));
        } catch (e) {
          out(`${attempt} ->`, errInfo(e));
        }
      }
      break;
    }
    default:
      throw new DemoProbeRefused("Pas necunoscut.");
  }
} catch (e) {
  console.error("Pas oprit:", e instanceof DemoProbeRefused ? e.message : JSON.stringify(errInfo(e)));
  process.exitCode = 1;
} finally {
  if (created.length) out("AWB-uri DEMO create (de anulat cu --step cancel):", created);
}
