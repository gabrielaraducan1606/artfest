// Coada de moderare AI (services/productModerationQueue.js): regulile de aplicare,
// reîncercările și configurarea. Fără rețea și fără bază de date reală: Prisma și
// clientul OpenAI sunt simulate în memorie. SQL-ul (preluare SKIP LOCKED, ON CONFLICT)
// e verificat separat pe o bază izolată.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isAsyncModerationRequested,
  isModerationWorkerRequested,
  moderationContentHash,
  moderationStatusSnapshot,
  processModerationJob,
  recoverStaleModerationJobs,
  sameStatusSnapshot,
  withoutSdkRetries,
} from "./productModerationQueue.js";

const ENV = { PRODUCT_AI_MODERATION: "on", PRODUCT_AI_MODERATION_TIMEOUT_MS: "1000" };

function approveClient({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    responses: {
      async create(body) {
        calls.push(body);
        if (fail) throw Object.assign(new Error("simulated 500"), { status: 500 });
        const text = JSON.stringify(body.input);
        const indexes = [...text.matchAll(/Imagine #(\d+):/g)].map((m) => Number(m[1]));
        return {
          output_text: JSON.stringify({
            images: indexes.map((imageIndex) => ({
              imageIndex,
              hasPhoneNumber: false, hasEmail: false, hasUrl: false, hasSocialHandle: false, hasQrCode: false,
              hasLogo: false, hasWatermark: false, hasPromotionalText: false, isPromotionalMaterial: false,
              productVisible: true, looksLikeStockPhoto: false, confidence: 0.97, reasons: [],
            })),
            classification: { type: "HANDMADE", handmadeConfidence: 0.95, possibleResell: false, textHasContactInfo: false, confidence: 0.95, reasons: [], signals: [] },
          }),
        };
      },
    },
  };
}

function baseProduct(overrides = {}) {
  return {
    id: "p1",
    title: "Cană pictată",
    description: "Cană din ceramică pictată manual.",
    category: "ceramica",
    images: ["https://cdn.example/products/u1/a.jpg"],
    moderationStatus: "PENDING",
    reviewedAt: null,
    reviewedByUserId: null,
    approvedAt: null,
    aiModeration: null,
    isOwnManufacturer: true,
    ...overrides,
  };
}

function jobFor(product, overrides = {}) {
  return {
    id: "job1",
    productId: product.id,
    status: "RUNNING",
    attempts: 1,
    maxAttempts: 3,
    lockedBy: "w1",
    contentHash: moderationContentHash(product),
    statusSnapshot: moderationStatusSnapshot(product),
    previouslyRejectedByAdmin: false,
    ...overrides,
  };
}

/** Prisma în memorie: produsul, jobul și ce s-a scris. `beforeApply` rulează în tranzacția de aplicare. */
function fakeDb(product, { newerJob = false, beforeApply = null, retryConflict = false } = {}) {
  const state = { product: product ? structuredClone(product) : null, jobWrites: [], productWrites: [] };
  const db = {
    product: {
      async findUnique({ where }) {
        if (!state.product || where.id !== state.product.id) return null;
        return structuredClone(state.product);
      },
      async update({ where, data }) {
        assert.equal(where.id, state.product.id);
        state.productWrites.push(data);
        Object.assign(state.product, data);
        return structuredClone(state.product);
      },
    },
    productGpsrDeclaration: { findMany: async () => [] },
    productModerationJob: {
      async updateMany({ data }) {
        if (retryConflict && data.status === "QUEUED") throw Object.assign(new Error("unique"), { code: "P2002" });
        state.jobWrites.push(data);
        return { count: 1 };
      },
      async findFirst() {
        return newerJob ? { id: "job2" } : null;
      },
      async findMany() {
        return state.stale || [];
      },
    },
    async $queryRaw() {
      return [];
    },
    async $transaction(fn) {
      if (beforeApply) await beforeApply(state);
      return fn(db);
    },
  };
  return { db, state };
}

test("configurare: implicit totul oprit (moderare sincronă, ca înainte)", () => {
  assert.equal(isAsyncModerationRequested({}), false);
  assert.equal(isModerationWorkerRequested({}), false);
  assert.equal(isAsyncModerationRequested({ PRODUCT_MODERATION_ASYNC: "on" }), true);
  assert.equal(isModerationWorkerRequested({ PRODUCT_MODERATION_ASYNC: "on" }), true);
  // rollback: rutele revin la sincron, procesorul golește coada
  assert.equal(isModerationWorkerRequested({ PRODUCT_MODERATION_ASYNC: "off", PRODUCT_MODERATION_WORKER: "on" }), true);
  assert.equal(isModerationWorkerRequested({ PRODUCT_MODERATION_ASYNC: "on", PRODUCT_MODERATION_WORKER: "off" }), false);
});

test("amprenta conținutului: textul moderat + imaginile în ordine; prețul / stocul nu contează", () => {
  const a = baseProduct({ images: ["x/1.jpg", "x/2.jpg"] });
  assert.equal(moderationContentHash(a), moderationContentHash({ ...a, priceCents: 999, readyQty: 3 }));
  assert.notEqual(moderationContentHash(a), moderationContentHash({ ...a, images: ["x/2.jpg", "x/1.jpg"] }));
  assert.notEqual(moderationContentHash(a), moderationContentHash({ ...a, title: "Alt titlu" }));
});

test("starea de moderare: o decizie Admin (status / reviewedBy) schimbă instantaneul", () => {
  const p = baseProduct();
  const snap = moderationStatusSnapshot(p);
  assert.equal(sameStatusSnapshot(p, snap), true);
  assert.equal(sameStatusSnapshot({ ...p, moderationStatus: "APPROVED", reviewedByUserId: "admin", reviewedAt: new Date(), approvedAt: new Date() }, snap), false);
  assert.equal(sameStatusSnapshot({ ...p, moderationStatus: "REJECTED", reviewedByUserId: "admin", reviewedAt: new Date() }, snap), false);
});

test("job aplicat: aceleași reguli de moderare, statusul vine din verdict", async () => {
  const product = baseProduct();
  const { db, state } = fakeDb(product);
  const client = approveClient();
  const out = await processModerationJob(db, jobFor(product), { client, env: ENV });
  assert.ok(client.calls.length >= 1, "AI apelat (simulat)");
  assert.equal(state.productWrites.length, 1);
  assert.ok(state.productWrites[0].aiModeration?.decision, "aiModeration salvat");
  assert.ok(["APPROVED", "PENDING", "CHANGES_REQUESTED"].includes(state.productWrites[0].moderationStatus));
  assert.equal(state.jobWrites.at(-1).status, "SUCCEEDED");
  assert.equal(state.jobWrites.at(-1).activeKey, null);
  assert.ok(out.outcome);
});

test("decizie manuală a Adminului în timpul analizei: rezultatul AI NU o suprascrie", async () => {
  const product = baseProduct();
  const { db, state } = fakeDb(product, {
    beforeApply: (s) => Object.assign(s.product, { moderationStatus: "REJECTED", reviewedByUserId: "admin1", reviewedAt: new Date() }),
  });
  const out = await processModerationJob(db, jobFor(product), { client: approveClient(), env: ENV });
  assert.equal(out.outcome, "status_changed");
  assert.equal(state.productWrites.length, 0);
  assert.equal(state.product.moderationStatus, "REJECTED");
  assert.equal(state.jobWrites.at(-1).status, "SKIPPED");
});

test("produs editat în timpul analizei: rezultatul vechi nu se aplică", async () => {
  const product = baseProduct();
  const { db, state } = fakeDb(product, {
    beforeApply: (s) => Object.assign(s.product, { images: ["https://cdn.example/products/u1/nou.jpg"] }),
  });
  const out = await processModerationJob(db, jobFor(product), { client: approveClient(), env: ENV });
  assert.equal(out.outcome, "content_changed");
  assert.equal(state.productWrites.length, 0);
});

test("job mai nou în așteptare pentru același produs: cel vechi se încheie fără efect", async () => {
  const product = baseProduct();
  const { db, state } = fakeDb(product, { newerJob: true });
  const out = await processModerationJob(db, jobFor(product), { client: approveClient(), env: ENV });
  assert.equal(out.outcome, "superseded");
  assert.equal(state.productWrites.length, 0);
});

test("produs șters / conținut schimbat înainte de analiză: fără apel AI", async () => {
  const product = baseProduct();
  const client = approveClient();
  const gone = fakeDb(null);
  assert.equal((await processModerationJob(gone.db, jobFor(product), { client, env: ENV })).outcome, "product_deleted");
  const changed = fakeDb({ ...product, title: "Schimbat" });
  assert.equal((await processModerationJob(changed.db, jobFor(product), { client, env: ENV })).outcome, "content_changed");
  assert.equal(client.calls.length, 0);
});

test("AI indisponibil: reîncercare programată, produsul rămâne neatins (nepublic)", async () => {
  const product = baseProduct();
  const { db, state } = fakeDb(product);
  const out = await processModerationJob(db, jobFor(product, { attempts: 1 }), { client: approveClient({ fail: true }), env: ENV });
  assert.equal(out.outcome, "retry");
  assert.equal(state.productWrites.length, 0);
  const retry = state.jobWrites.at(-1);
  assert.equal(retry.status, "QUEUED");
  assert.equal(retry.activeKey, "p1");
  assert.ok(retry.runAfter instanceof Date && retry.runAfter.getTime() > Date.now());
});

test("AI indisponibil la ultima încercare: se aplică verdictul de azi (PENDING -> Admin), nu APPROVED", async () => {
  const product = baseProduct();
  const { db, state } = fakeDb(product);
  const out = await processModerationJob(db, jobFor(product, { attempts: 3, maxAttempts: 3 }), { client: approveClient({ fail: true }), env: ENV });
  assert.equal(out.outcome, "ai_unavailable");
  assert.equal(state.productWrites[0].moderationStatus, "PENDING");
  assert.ok(state.productWrites[0].aiModeration.reasons.includes("AI_ANALYSIS_UNAVAILABLE"));
  assert.equal(state.jobWrites.at(-1).status, "SUCCEEDED");
});

test("reîncercare cu un job mai nou deja în coadă (P2002): cel vechi devine SKIPPED", async () => {
  const product = baseProduct();
  const { db, state } = fakeDb(product, { retryConflict: true });
  const out = await processModerationJob(db, jobFor(product, { attempts: 1 }), { client: approveClient({ fail: true }), env: ENV });
  assert.equal(out.outcome, "superseded");
  assert.equal(state.jobWrites.at(-1).status, "SKIPPED");
});

test("eroare neprevăzută după toate încercările: DEAD, produsul rămâne PENDING", async () => {
  const product = baseProduct();
  const { db, state } = fakeDb(product);
  db.$transaction = async () => {
    throw new Error("db down");
  };
  const out = await processModerationJob(db, jobFor(product, { attempts: 3, maxAttempts: 3 }), { client: approveClient(), env: ENV });
  assert.equal(out.outcome, "dead");
  assert.equal(state.jobWrites.at(-1).status, "DEAD");
  assert.equal(state.product.moderationStatus, "PENDING");
});

test("moderarea AI oprită între timp (kill switch): job SKIPPED, produsul rămâne pentru Admin", async () => {
  const product = baseProduct();
  const { db, state } = fakeDb(product);
  const out = await processModerationJob(db, jobFor(product), { client: approveClient(), env: { PRODUCT_AI_MODERATION: "off" } });
  assert.equal(out.outcome, "moderation_disabled");
  assert.equal(state.productWrites.length, 0);
});

test("restart în timpul jobului: RUNNING abandonat revine în coadă; fără încercări rămase -> DEAD", async () => {
  const { db, state } = fakeDb(baseProduct());
  state.stale = [
    { id: "a", productId: "p1", attempts: 1, maxAttempts: 3, lockedBy: "mort" },
    { id: "b", productId: "p2", attempts: 3, maxAttempts: 3, lockedBy: "mort" },
  ];
  const out = await recoverStaleModerationJobs(db, { now: new Date(), staleMs: 1000 });
  assert.deepEqual(out, { stale: 2, recovered: 1 });
  assert.equal(state.jobWrites[0].status, "QUEUED");
  assert.equal(state.jobWrites[1].status, "DEAD");
});

test("clientul procesorului: fără reîncercări interne ale SDK-ului", () => {
  const seen = [];
  const client = { withOptions: (o) => (seen.push(o), { patched: true }) };
  assert.deepEqual(withoutSdkRetries(client), { patched: true });
  assert.deepEqual(seen, [{ maxRetries: 0 }]);
  const plain = { responses: {} };
  assert.equal(withoutSdkRetries(plain), plain);
});

/* ---------------- „Am făcut modificările” (reason "resubmit") ---------------- */

function blockingClient() {
  return {
    responses: {
      async create(body) {
        const text = JSON.stringify(body.input);
        const indexes = [...text.matchAll(/Imagine #(\d+):/g)].map((m) => Number(m[1]));
        return {
          output_text: JSON.stringify({
            images: indexes.map((imageIndex) => ({
              imageIndex,
              hasPhoneNumber: true, hasEmail: false, hasUrl: false, hasSocialHandle: false, hasQrCode: false,
              hasLogo: false, hasWatermark: false, hasPromotionalText: false, isPromotionalMaterial: false,
              productVisible: true, looksLikeStockPhoto: false, confidence: 0.97, reasons: ["telefon în imagine"],
            })),
            classification: { type: "HANDMADE", handmadeConfidence: 0.95, possibleResell: false, textHasContactInfo: false, confidence: 0.95, reasons: [], signals: [] },
          }),
        };
      },
    },
  };
}

const confirmedRequest = { id: "cr1", confirmedAt: "2026-11-22T10:00:00.000Z", reasons: ["OTHER"], note: "Fotografie" };

test("resubmit blocat de AI: solicitarea se redeschide (confirmedAt null), adminii NU sunt notificați", async () => {
  const product = baseProduct({ aiModeration: { adminReviewRequired: true, changeRequest: confirmedRequest } });
  const { db, state } = fakeDb(product);
  const notified = [];
  const out = await processModerationJob(db, jobFor(product, { reason: "resubmit", previouslyRejectedByAdmin: true }), {
    client: blockingClient(),
    env: ENV,
    hooks: { changeRequestNotificationKey: () => "k", notifyAdminsProductChangesDone: async (x) => notified.push(x) },
  });
  assert.equal(out.outcome, "block_publication");
  assert.equal(state.productWrites[0].moderationStatus, "CHANGES_REQUESTED");
  assert.equal(state.productWrites[0].aiModeration.changeRequest.confirmedAt, null);
  assert.equal(state.productWrites[0].aiModeration.changeRequest.id, "cr1");
  assert.equal(notified.length, 0);
});

test("resubmit acceptat: niciodată auto-aprobat (verificare Admin), confirmarea pe notificare + adminii notificați", async () => {
  const product = baseProduct({ aiModeration: { adminReviewRequired: true, changeRequest: confirmedRequest } });
  const { db, state } = fakeDb(product);
  const notifUpdates = [];
  db.notification = {
    findUnique: async () => ({ id: "n1", meta: { kind: "product_moderation" } }),
    update: async ({ data }) => notifUpdates.push(data),
  };
  const notified = [];
  await processModerationJob(db, jobFor(product, { reason: "resubmit", previouslyRejectedByAdmin: true }), {
    client: approveClient(),
    env: ENV,
    hooks: { changeRequestNotificationKey: (p, r) => `key:${p}:${r}`, notifyAdminsProductChangesDone: async (x) => notified.push(x) },
  });
  assert.equal(state.productWrites[0].moderationStatus, "PENDING");
  assert.equal(state.productWrites[0].aiModeration.changeRequest.confirmedAt, confirmedRequest.confirmedAt);
  assert.equal(notifUpdates[0].meta.confirmedAt, confirmedRequest.confirmedAt);
  assert.equal(notified.length, 1);
  assert.equal(notified[0].changeRequest.id, "cr1");
});

test("editare obișnuită (reason update) blocată: solicitarea confirmată NU se redeschide (regula editărilor de azi)", async () => {
  const product = baseProduct({ aiModeration: { adminReviewRequired: true, changeRequest: confirmedRequest } });
  const { db, state } = fakeDb(product);
  await processModerationJob(db, jobFor(product, { reason: "update", previouslyRejectedByAdmin: true }), { client: blockingClient(), env: ENV });
  assert.equal(state.productWrites[0].moderationStatus, "CHANGES_REQUESTED");
  assert.equal(state.productWrites[0].aiModeration.changeRequest.confirmedAt, confirmedRequest.confirmedAt);
});

test("SQL brut: datele se trimit ca oră UTC fără fus (ca Prisma), indiferent de fusul sesiunii Postgres", async () => {
  const { utcTimestamp } = await import("./productModerationQueue.js");
  assert.equal(utcTimestamp(new Date("2026-11-22T16:08:19.670Z")), "2026-11-22T16:08:19.670");
});

test("pragul de abandon nu poate fi sub durata maximă a unei analize (procesor lent, dar viu)", async () => {
  const { moderationStaleMs } = await import("./productModerationQueue.js");
  assert.equal(moderationStaleMs({}), 5 * 60 * 1000); // implicit 5 min (> 4 × 30 s + 30 s)
  assert.equal(moderationStaleMs({ PRODUCT_MODERATION_STALE_MS: "15000", PRODUCT_AI_MODERATION_TIMEOUT_MS: "40000" }), 190000);
  assert.equal(moderationStaleMs({ PRODUCT_MODERATION_STALE_MS: "600000" }), 600000);
});
