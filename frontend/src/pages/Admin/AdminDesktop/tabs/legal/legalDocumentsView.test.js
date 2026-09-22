// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/legal/legalDocumentsView.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildPublishOptions,
  buildPublishPayload,
  buildReacceptancePayload,
  canPublishRow,
  canRequestRow,
  defaultPublishVersion,
  defaultReacceptanceForm,
  describeRequestResult,
  formatDrafts,
  formatUnregistered,
  pendingOnPublished,
  sortCatalogRows,
  statusLabel,
  statusTone,
  summarizeCatalog,
  validateReacceptanceForm,
} from "./legalDocumentsView.js";

const row = (extra = {}) => ({
  rowId: "TOS#USER",
  catalogId: "TOS",
  label: "Termeni și Condiții",
  audience: "USER",
  published: { version: "1.0.0" },
  manifestVersions: [
    { manifestVersion: 1, policyVersion: "1.0.0", loadable: true, isPublished: true },
    { manifestVersion: 2, policyVersion: "2.0.0", loadable: true, isPublished: false },
  ],
  draftVersions: [{ manifestVersion: 2, policyVersion: "2.0.0", loadable: true }],
  unregisteredFiles: [3],
  stats: { targets: 10, acceptedOnPublished: 7, notOnPublished: 3 },
  actions: { canPublish: true, canRequestReacceptance: true },
  status: "DRAFT_AVAILABLE",
  ...extra,
});

test("statusuri: etichete și tonuri, cu rezervă pentru necunoscute", () => {
  assert.equal(statusLabel("UP_TO_DATE"), "La zi");
  assert.equal(statusLabel("REACCEPTANCE_OVERDUE"), "Reacceptare depășită");
  assert.equal(statusTone("REACCEPTANCE_OVERDUE"), "danger");
  assert.equal(statusTone("???"), "muted");
  assert.equal(statusLabel(undefined), "—");
});

test("draft-uri și fișiere neînregistrate", () => {
  assert.equal(formatDrafts(row()), "v2 (2.0.0)");
  assert.equal(formatDrafts(row({ draftVersions: [] })), "—");
  assert.equal(formatUnregistered(row()), "v3");
  assert.equal(formatUnregistered(row({ unregisteredFiles: [] })), "");
});

test("opțiuni de publicare: doar versiuni încărcabile; implicit primul draft", () => {
  const options = buildPublishOptions(
    row({
      manifestVersions: [
        { manifestVersion: 1, policyVersion: "1.0.0", loadable: true, isPublished: true },
        { manifestVersion: 2, policyVersion: null, loadable: false },
        { manifestVersion: 3, policyVersion: "3.0.0", loadable: true, isPublished: false },
      ],
    })
  );

  assert.deepEqual(options.map((o) => o.value), ["1.0.0", "3.0.0"]);
  assert.match(options[0].label, /publicată acum/);
  assert.equal(defaultPublishVersion(row()), "2.0.0");
  // fără draft: prima versiune nepublicată din manifest; dacă nu există, cea publicată
  assert.equal(defaultPublishVersion(row({ draftVersions: [] })), "2.0.0");
  assert.equal(
    defaultPublishVersion(
      row({ draftVersions: [], manifestVersions: [{ manifestVersion: 1, policyVersion: "1.0.0", loadable: true, isPublished: true }] })
    ),
    "1.0.0"
  );
  assert.equal(defaultPublishVersion(row({ draftVersions: [], manifestVersions: [] })), "");
});

test("acțiuni: publicare doar cu versiuni publicabile; cererea doar după publicare", () => {
  assert.equal(canPublishRow(row()), true);
  assert.equal(canPublishRow(row({ actions: { canPublish: false } })), false);
  assert.equal(canPublishRow(row({ manifestVersions: [] })), false);
  assert.equal(canRequestRow(row()), true);
  assert.equal(canRequestRow(row({ actions: { canRequestReacceptance: false } })), false);
  assert.equal(pendingOnPublished(row()), 3);
});

test("formularul de reacceptare: implicit, validare și payload", () => {
  const form = defaultReacceptanceForm(row());

  assert.equal(form.requiresAction, true);
  assert.equal(form.emailEnabled, true);
  assert.match(form.message, /versiunea 1\.0\.0/);
  assert.deepEqual(validateReacceptanceForm(form), []);

  assert.equal(validateReacceptanceForm({ ...form, title: " " }).length, 1);
  assert.equal(validateReacceptanceForm({ ...form, deadlineAt: "nu-e-data" }).length, 1);
  assert.equal(validateReacceptanceForm({ ...form, deadlineAt: "2001-01-01" }).length, 1);
  assert.equal(validateReacceptanceForm({ ...form, emailSubject: "", emailBody: "" }).length, 2);
  assert.deepEqual(validateReacceptanceForm({ ...form, emailEnabled: false, emailSubject: "" }), []);

  const payload = buildReacceptancePayload(row(), { ...form, deadlineAt: "2099-01-01" });

  assert.equal(payload.catalogId, "TOS");
  assert.equal(payload.audience, "USER");
  assert.equal(payload.version, "1.0.0");
  assert.equal(payload.requiresAction, true);
  assert.equal(payload.deadlineAt, "2099-01-01T00:00:00.000Z");
  assert.equal(payload.email.enabled, true);

  const noEmail = buildReacceptancePayload(row(), { ...form, emailEnabled: false });
  assert.equal(noEmail.email, null);
  assert.equal(noEmail.deadlineAt, null);

  assert.deepEqual(buildPublishPayload(row(), "2.0.0"), { catalogId: "TOS", version: "2.0.0" });
});

test("catalog: cookies la final; rezumat pe statusuri; mesaj după cerere", () => {
  const rows = [
    { catalogId: "COOKIES", informational: true, status: "INFORMATIONAL" },
    row(),
    row({ status: "REACCEPTANCE_REQUESTED" }),
    row({ status: "REACCEPTANCE_OVERDUE" }),
    row({ status: "NOT_PUBLISHED" }),
  ];

  const sorted = sortCatalogRows(rows);
  assert.equal(sorted[sorted.length - 1].catalogId, "COOKIES");

  assert.deepEqual(summarizeCatalog(rows), { open: 2, overdue: 1, drafts: 1, notPublished: 1 });

  assert.match(
    describeRequestResult({ targetCount: 5, createdCount: 5, emailRequested: true }),
    /5 conturi.*tranzacțional/
  );
  assert.equal(describeRequestResult(null), "");
});
