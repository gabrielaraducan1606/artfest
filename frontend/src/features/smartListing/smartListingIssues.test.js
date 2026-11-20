// node --test src/features/smartListing/smartListingIssues.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildDraftForm, buildOptionsSchema, evaluatePublishGate } from "./smartListingConfig.js";
import { buildPublishIssues, issuesForStep, messagesByAnchor, serverIssues } from "./smartListingIssues.js";
import { readServerValidation } from "./smartListingServerErrors.js";

const FIELD_ANCHORS = { title: "sl-title", description: "sl-description", category: "sl-category" };

const check = (...codes) => ({
  errors: codes.map(([code, message, anchors]) => ({ code, message, target: { step: "x", anchors: anchors || [] } })),
  recommendations: [],
});

test("ordinea formularului: fotografii -> detalii -> preț și opțiuni -> publicare, indiferent de ordinea verificărilor", () => {
  const gate = evaluatePublishGate({
    check: check(
      ["PRICE_INVALID", "Completează prețul produsului."],
      ["CATEGORY_MISSING", "Alege o categorie pentru produs."],
      ["TITLE_MISSING", "Completează titlul produsului."]
    ),
    extraBlockers: [
      { code: "GPSR_DECLARATION", message: "Bifează confirmarea privind siguranța produselor (GPSR).", step: "review" },
      { code: "PHOTOS_FAILED", message: "Unele fotografii nu s-au încărcat.", step: "photos" },
    ],
  });
  const issues = buildPublishIssues(gate.blockers, { fieldAnchors: FIELD_ANCHORS });
  assert.deepEqual(
    issues.map((i) => [i.step, i.anchor]),
    [
      ["photos", "sl-photos"],
      ["details", "sl-title"],
      ["details", "sl-category"],
      ["sell", "sl-price"],
      ["review", "sl-gpsr-confirm"],
    ]
  );
  // texte scurte și concrete în sumar, explicația completă sub câmp
  assert.equal(issues.find((i) => i.anchor === "sl-price").summary, "Completează prețul");
  assert.equal(issues.find((i) => i.anchor === "sl-category").summary, "Alege categoria");
  assert.equal(issues.find((i) => i.anchor === "sl-title").message, "Completează titlul produsului.");
  assert.ok(issues.every((i) => !/[{}]|_[A-Z]|GPSR_|cod:/.test(i.summary)));
});

test("variante: fiecare eroare duce la elementul exact (nume, valoare, sumă, valoare nouă)", () => {
  const variants = [
    { id: "v1", label: "", values: [] },
    {
      id: "v2",
      label: "Aromă",
      values: [
        { id: "a", label: "lavandă", deltaLei: "" },
        { id: "b", label: "", deltaLei: "" },
        { id: "c", label: "Lavandă", deltaLei: "" },
        { id: "d", label: "trandafir", deltaLei: "abc" },
      ],
    },
    { id: "v3", label: "Mărime", values: [] },
  ];
  const built = buildOptionsSchema(variants);
  // textele existente rămân neschimbate (aceleași erori ca înainte)
  assert.deepEqual(built.errors, built.issues.map((i) => i.message));
  assert.deepEqual(
    built.issues.map((i) => i.anchor),
    ["v1-label", "b-value", "c-value", "d-delta", "v3-new-value"]
  );
  assert.equal(built.variantIdByKey.aroma, "v2");
});

test("fără dubluri: verificarea comună și formularul semnalează aceeași variantă o singură dată", () => {
  const draft = buildDraftForm({
    details: { title: "Lumânare", category: "x" },
    commerce: { saleType: "WITH_OPTIONS", price: "30", leadTimeDays: "3" },
    variants: [{ id: "v3", label: "Mărime", values: [] }],
  });
  const blockers = [
    ...draft.issues.map((item) => ({ code: "OPTION_CONFIG", message: item.message, step: "sell", anchor: item.anchor })),
    // productPublishCheck: aceeași problemă, cu ancora ei (option-values-<cheie>)
    { code: "VARIANT_NO_VALUES", message: "Varianta „Mărime” nu are valori.", issue: { target: { anchors: ["option-values-marime"] } } },
  ];
  const issues = buildPublishIssues(blockers, { variantIdByKey: draft.variantIdByKey });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].anchor, "v3-new-value");
  assert.equal(issues[0].step, "sell");

  // același text pentru aceeași țintă => o singură intrare
  const twice = buildPublishIssues([
    { code: "OPTIONS_UNANSWERED", message: "Răspunde.", step: "sell" },
    { code: "OPTIONS_UNANSWERED", message: "Răspunde.", step: "sell" },
  ]);
  assert.equal(twice.length, 1);
});

test("propunere AI neconfirmată -> câmpul ei; producător incomplet -> fereastra producătorului", () => {
  const gate = evaluatePublishGate({
    check: check(["GPSR_vendorGpsrManufacturer", "Siguranța produsului (GPSR): completează datele publice ale producătorului."]),
    pendingConfirmations: [{ field: "description", label: "Descriere" }],
    extraBlockers: [{ code: "PRODUCER_PROFILE", message: "Datele producătorului „X” sunt incomplete - verifică-le.", step: "review" }],
  });
  const issues = buildPublishIssues(gate.blockers, { fieldAnchors: FIELD_ANCHORS });
  const ai = issues.find((i) => i.code === "AI_UNCONFIRMED");
  assert.equal(ai.anchor, "sl-description");
  assert.equal(ai.summary, "Verifică propunerea AI pentru „Descriere”");
  // cele două semnalări ale producătorului = o singură intrare, cu deschiderea ferestrei
  const producer = issues.filter((i) => i.anchor === "sl-producer");
  assert.equal(producer.length, 1);
  assert.equal(producer[0].action, "producer");
  assert.equal(producer[0].summary, "Completează datele producătorului");
});

test("„Continuă” verifică doar pasul curent; mesajele de sub câmp sunt grupate pe element", () => {
  const issues = buildPublishIssues(
    [
      { code: "TITLE_MISSING", message: "Completează titlul produsului." },
      { code: "PRICE_INVALID", message: "Completează prețul produsului." },
    ],
    {}
  );
  assert.deepEqual(issuesForStep(issues, "details").map((i) => i.anchor), ["sl-title"]);
  assert.deepEqual(issuesForStep(issues, "photos"), []);
  assert.deepEqual(messagesByAnchor(issues), {
    "sl-title": ["Completează titlul produsului."],
    "sl-price": ["Completează prețul produsului."],
  });
});

test("erorile serverului cu câmp: în sumar și lângă câmp; fără câmp: nicio țintă aleasă la întâmplare", () => {
  const withField = readServerValidation({ status: 400, data: { error: "invalid_price", field: "price", message: "Prețul nu este valid." } });
  const items = serverIssues(withField.fieldErrors);
  assert.deepEqual(items.map((i) => [i.step, i.anchor, i.summary]), [["sell", "sl-price", "Prețul nu este valid"]]);

  const noField = readServerValidation({ status: 400, data: { error: "ceva_nou" } });
  assert.deepEqual(serverIssues(noField.fieldErrors), []);
  assert.equal(noField.anchor, null);
});
