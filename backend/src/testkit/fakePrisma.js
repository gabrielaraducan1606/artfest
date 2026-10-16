import { AsyncLocalStorage } from "node:async_hooks";

// Prisma în memorie, doar pentru testele mecanismului juridic. NU e
// importat de cod de producție. Acoperă strict operațiile folosite de
// serviciile legal*/reacceptance*/policyEmail*.

let counter = 0;
const nextId = (prefix) => `${prefix}_${++counter}`;

const MODELS = {
  user: { defaults: { status: "ACTIVE", role: "USER" }, unique: {} },
  vendor: { defaults: {}, unique: {} },
  userPolicy: {
    defaults: { isActive: true, isRequired: true },
    unique: { document_version: ["document", "version"] },
  },
  vendorPolicy: {
    defaults: { isActive: true, isRequired: true },
    unique: { document_version: ["document", "version"] },
  },
  userConsent: {
    defaults: {},
    unique: { userId_document_version: ["userId", "document", "version"] },
    autoDate: "givenAt",
  },
  vendorAcceptance: {
    defaults: {},
    unique: { vendorId_document_version: ["vendorId", "document", "version"] },
    autoDate: "acceptedAt",
  },
  policyGateCampaign: {
    defaults: { requiresAction: true, sendEmail: false, documents: [] },
    unique: { campaignKey: ["campaignKey"] },
  },
  notification: { defaults: { archived: false }, unique: { dedupeKey: ["dedupeKey"] } },
  emailLog: { defaults: { status: "QUEUED" }, unique: {} },
  cookieConsent: { defaults: {}, unique: {} },
  influencerProfile: { defaults: {}, unique: { userId: ["userId"] } },
  // Târgul Artfest (artfestFair*.test.js)
  vendorService: { defaults: {}, unique: {} },
  serviceProfile: { defaults: {}, unique: {} },
  artfestFair: {
    defaults: { registrationOpen: true, nextVendorReturnNumber: 1, nextSaleNumber: 1, nextReturnNumber: 1, salesOpen: false, commissionBps: 1000 },
    unique: { key: ["key"] },
  },
  artfestFairRegistration: {
    defaults: {
      productTypes: [],
      cancelledAt: null,
      cancelledById: null,
      cancellationCause: null,
      cancellationReason: null,
      cancellationMessageForVendor: null,
      cancellationGoodsShipped: null,
    },
    unique: { fairId_vendorId: ["fairId", "vendorId"] },
  },
  product: { defaults: { isActive: true, isHidden: false }, unique: {} },
  artfestFairInventoryItem: {
    defaults: {
      status: "DRAFT",
      receivedQty: 0,
      rejectedQty: 0,
      rejectedReturnedQty: 0,
      soldQty: 0,
      damagedQty: 0,
      lostQty: 0,
      returnedQty: 0,
      availableQty: 0,
      isFragile: false,
      isUnique: false,
      isLimitedEdition: false,
      canBeRemade: false,
      currency: "RON",
      onlineReservationMode: "NONE",
      onlineReservedQty: 0,
      onlineReleasedQty: 0,
      onlineDeferredRestoreQty: 0,
      onlineRestoredQty: 0,
      labelPriceCents: null,
      onlineReleasedAt: null,
      onlineRestoredAt: null,
      saleBlockedAt: null,
      saleBlockedReason: null,
      saleBlockedById: null,
      receivedAt: null,
      adminNotes: null,
      onlinePrevAvailability: null,
      onlinePrevReadyQty: null,
      vendorReturnReceivedQty: null,
      damagedReturnedQty: 0,
      vendorReturnConfirmedAt: null,
      closedAt: null,
    },
    unique: {
      barcode: ["barcode"],
      registrationId_productId_variantKey: ["registrationId", "productId", "variantKey"],
    },
  },
  artfestFairInventoryEvent: { defaults: {}, unique: {} },
  artfestFairStockMovement: {
    defaults: { photoUrls: [], returnLineId: null, saleLineId: null, saleReturnLineId: null },
    unique: { idempotencyKey: ["idempotencyKey"] },
  },
  artfestFairRegistrationEvent: { defaults: {}, unique: {} },
  // POS
  artfestFairDiscount: { defaults: { status: "DRAFT", fundingSource: "VENDOR", startsAt: null, endsAt: null }, unique: {} },
  artfestFairSale: {
    defaults: { status: "COMPLETED", currency: "RON", cashCents: null, cardCents: null, notes: null, voidedAt: null, voidedById: null },
    unique: {
      idempotencyKey: ["idempotencyKey"],
      receiptReference: ["receiptReference"],
      fairId_saleNumber: ["fairId", "saleNumber"],
    },
  },
  artfestFairSaleLine: {
    defaults: { lineDiscountCents: 0, artfestFundedDiscountCents: 0, returnedQty: 0 },
    unique: { saleId_inventoryItemId: ["saleId", "inventoryItemId"] },
  },
  artfestFairSaleLineDiscount: { defaults: {}, unique: { saleLineId: ["saleLineId"] } },
  // retururi / anulări ale vânzărilor (clienți)
  artfestFairSaleReturn: {
    defaults: { artfestFundedReversedCents: 0 },
    unique: { idempotencyKey: ["idempotencyKey"], reference: ["reference"], fairId_returnNumber: ["fairId", "returnNumber"] },
  },
  artfestFairSaleReturnLine: {
    defaults: { artfestFundedReversedCents: 0, conditionNote: null, refundResponsibility: null, responsibilityReason: null },
    unique: {},
  },
  // decontul final
  artfestFairSettlement: {
    defaults: {
      status: "DRAFT",
      currency: "RON",
      adjustmentsCents: 0,
      artfestBorneRefundCents: 0,
      carriedInCents: 0,
      previousSettlementId: null,
      finalizedAt: null,
      finalizedById: null,
      paidAt: null,
      paidById: null,
      paymentReference: null,
      documentRef: null,
      notes: null,
    },
    unique: { fairId_vendorId_sequence: ["fairId", "vendorId", "sequence"], previousSettlementId: ["previousSettlementId"] },
    autoDate: "createdAt",
  },
  artfestFairSettlementEntry: {
    defaults: { saleLineId: null, returnLineId: null },
    unique: { saleLineId: ["saleLineId"], returnLineId: ["returnLineId"] },
  },
  artfestFairSettlementAdjustment: { defaults: { vendorNote: null }, unique: {}, autoDate: "createdAt" },
  artfestFairReturn: {
    defaults: {
      status: "PREPARING",
      confirmedByAdmin: false,
      shippedAt: null,
      confirmedAt: null,
      cancelledAt: null,
      courierName: null,
      trackingNumber: null,
      shippingCostCents: null,
      adminNotes: null,
    },
    unique: { fairId_number: ["fairId", "number"] },
  },
  artfestFairReturnLine: {
    defaults: {
      qtyFromStock: 0,
      qtyRejected: 0,
      qtyDamaged: 0,
      vendorReceivedQty: null,
      vendorReceivedDamagedQty: null,
      restoreOnlineQty: null,
      onlineRestoredQty: 0,
    },
    unique: { returnId_inventoryItemId: ["returnId", "inventoryItemId"] },
  },
  artfestBroadcastDelivery: {
    defaults: {
      notificationStatus: "PENDING",
      emailStatus: "PENDING",
      emailAttempts: 0,
      notificationId: null,
    },
    unique: { campaignKey_vendorId: ["campaignKey", "vendorId"], notificationId: ["notificationId"] },
  },
};

const RELATIONS = {
  user: {
    UserConsent: { model: "userConsent", fk: "userId", many: true },
  },
  vendor: {
    VendorAcceptance: { model: "vendorAcceptance", fk: "vendorId", many: true },
    user: { model: "user", local: "userId", many: false },
  },
  userConsent: { user: { model: "user", local: "userId", many: false } },
  vendorAcceptance: { vendor: { model: "vendor", local: "vendorId", many: false } },
  artfestFairRegistration: { vendor: { model: "vendor", local: "vendorId", many: false } },
  vendorService: { profile: { model: "serviceProfile", fk: "serviceId", many: false } },
  artfestFairInventoryItem: { fair: { model: "artfestFair", local: "fairId", many: false } },
};

const isPlainObject = (v) =>
  v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

const cmp = (a, b) => {
  // null / undefined nu sunt egale cu o valoare (ca în SQL); null < "x" și null > "x" sunt ambele false în JS
  if (a == null || b == null) return a == null && b == null ? 0 : a == null ? -1 : 1;
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  return av < bv ? -1 : av > bv ? 1 : 0;
};

export function createFakePrisma(seed = {}) {
  const tables = {};
  for (const name of Object.keys(MODELS)) tables[name] = [];

  function relatedRows(model, row, relName) {
    const rel = RELATIONS[model]?.[relName];
    if (!rel) return null;
    if (rel.many || rel.fk) return tables[rel.model].filter((r) => r[rel.fk] === row.id);
    return tables[rel.model].filter((r) => r.id === row[rel.local]);
  }

  function matchValue(actual, cond) {
    if (!isPlainObject(cond)) return actual !== undefined && cmp(actual, cond) === 0;

    if ("path" in cond) {
      let cur = actual;
      for (const seg of cond.path) cur = cur == null ? undefined : cur[seg];
      return "equals" in cond ? cur === cond.equals : cur !== undefined;
    }

    return Object.entries(cond).every(([op, expected]) => {
      switch (op) {
        case "equals": return cmp(actual, expected) === 0;
        case "in": return expected.some((e) => cmp(actual, e) === 0);
        case "notIn": return !expected.some((e) => cmp(actual, e) === 0);
        case "not":
          // { not: null } = IS NOT NULL (cmp(0, null) ar da 0)
          if (expected === null) return actual !== null && actual !== undefined;
          return isPlainObject(expected)
            ? !matchValue(actual, expected)
            : cmp(actual, expected) !== 0;
        case "startsWith": return typeof actual === "string" && actual.startsWith(expected);
        case "contains": return typeof actual === "string" && actual.includes(expected);
        case "lt": return actual != null && cmp(actual, expected) < 0;
        case "lte": return actual != null && cmp(actual, expected) <= 0;
        case "gt": return actual != null && cmp(actual, expected) > 0;
        case "gte": return actual != null && cmp(actual, expected) >= 0;
        default: throw new Error(`fakePrisma: operator nesuportat ${op}`);
      }
    });
  }

  function match(model, row, where) {
    if (!where) return true;

    return Object.entries(where).every(([key, cond]) => {
      if (key === "AND") return [].concat(cond).every((w) => match(model, row, w));
      if (key === "OR") return cond.some((w) => match(model, row, w));
      if (key === "NOT") return ![].concat(cond).some((w) => match(model, row, w));

      const rel = RELATIONS[model]?.[key];

      if (rel) {
        const rows = relatedRows(model, row, key);
        if ("some" in cond) return rows.some((r) => match(rel.model, r, cond.some));
        if ("none" in cond) return !rows.some((r) => match(rel.model, r, cond.none));
        if ("is" in cond) return rows.length > 0 && rows.every((r) => match(rel.model, r, cond.is));
        throw new Error(`fakePrisma: filtru relație nesuportat pe ${key}`);
      }

      return matchValue(row[key], cond);
    });
  }

  function project(model, row, select) {
    if (!select) return { ...row };

    const out = {};

    for (const [key, value] of Object.entries(select)) {
      if (!value) continue;

      const rel = RELATIONS[model]?.[key];

      if (rel && isPlainObject(value)) {
        let rows = relatedRows(model, row, key).filter((r) => match(rel.model, r, value.where));
        if (value.take) rows = rows.slice(0, value.take);
        const mapped = rows.map((r) => project(rel.model, r, value.select));
        out[key] = rel.many ? mapped : mapped[0] || null;
      } else {
        out[key] = row[key];
      }
    }

    return out;
  }

  function sortRows(rows, orderBy) {
    if (!orderBy) return rows;
    const [[field, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy);
    return [...rows].sort((a, b) => (dir === "desc" ? -1 : 1) * cmp(a[field], b[field]));
  }

  function uniqueConflict(model, data) {
    for (const fields of Object.values(MODELS[model].unique)) {
      const key = fields.map((f) => data[f]);
      if (key.some((v) => v == null)) continue;
      const clash = tables[model].find((r) => fields.every((f, i) => r[f] === key[i]));
      if (clash) return true;
    }
    return false;
  }

  function applyData(row, data) {
    for (const [key, value] of Object.entries(data || {})) {
      if (isPlainObject(value) && ("increment" in value || "decrement" in value)) {
        row[key] = (row[key] ?? 0) + (value.increment ?? 0) - (value.decrement ?? 0);
      } else {
        row[key] = value;
      }
    }
  }

  let clock = 1_700_000_000_000;

  function build(model, data) {
    const def = MODELS[model];
    const now = new Date(clock++);
    const row = { id: nextId(model), createdAt: now, ...def.defaults, ...data };
    if (def.autoDate && !row[def.autoDate]) row[def.autoDate] = now;
    if (model.startsWith("artfest")) row.updatedAt ??= now;
    if (model === "policyGateCampaign") {
      row.targetCount ??= 0;
      row.createdCount ??= 0;
      row.emailQueued ??= null;
      row.emailFailed ??= null;
    }
    if (model === "userPolicy" || model === "vendorPolicy") row.publishedAt ??= now;
    return row;
  }

  function whereUnique(model, where) {
    const table = tables[model];

    if (where.id) return table.find((r) => r.id === where.id) || null;

    for (const [name, fields] of Object.entries(MODELS[model].unique)) {
      if (where[name] !== undefined) {
        const values = isPlainObject(where[name]) ? where[name] : { [name]: where[name] };
        return table.find((r) => fields.every((f) => r[f] === values[f])) || null;
      }
    }

    return table.find((r) => match(model, r, where)) || null;
  }

  function delegate(model) {
    return {
      async findMany({ where, select, orderBy, take, skip } = {}) {
        let rows = sortRows(tables[model].filter((r) => match(model, r, where)), orderBy);
        if (skip) rows = rows.slice(skip);
        if (take) rows = rows.slice(0, take);
        return rows.map((r) => project(model, r, select));
      },
      async findFirst({ where, select, orderBy } = {}) {
        const rows = sortRows(tables[model].filter((r) => match(model, r, where)), orderBy);
        return rows[0] ? project(model, rows[0], select) : null;
      },
      async findUnique({ where, select }) {
        const row = whereUnique(model, where);
        return row ? project(model, row, select) : null;
      },
      async count({ where } = {}) {
        return tables[model].filter((r) => match(model, r, where)).length;
      },
      async create({ data }) {
        const row = build(model, data);
        if (uniqueConflict(model, row)) throw Object.assign(new Error("P2002"), { code: "P2002" });
        tables[model].push(row);
        return { ...row };
      },
      async createMany({ data, skipDuplicates }) {
        let count = 0;
        for (const item of data) {
          const row = build(model, item);
          if (uniqueConflict(model, row)) {
            if (skipDuplicates) continue;
            throw Object.assign(new Error("P2002"), { code: "P2002" });
          }
          tables[model].push(row);
          count += 1;
        }
        return { count };
      },
      async update({ where, data }) {
        const row = whereUnique(model, where);
        if (!row) throw new Error(`fakePrisma: ${model} negăsit pentru update`);
        applyData(row, data);
        return { ...row };
      },
      async updateMany({ where, data }) {
        const rows = tables[model].filter((r) => match(model, r, where));
        rows.forEach((r) => applyData(r, data));
        return { count: rows.length };
      },
      async deleteMany({ where } = {}) {
        const before = tables[model].length;
        tables[model] = tables[model].filter((r) => !match(model, r, where));
        return { count: before - tables[model].length };
      },
      async upsert({ where, create, update }) {
        const row = whereUnique(model, where);
        if (row) {
          applyData(row, update);
          return { ...row };
        }
        const created = build(model, create);
        tables[model].push(created);
        return { ...created };
      },
      async groupBy({ by, where, _count }) {
        const groups = new Map();
        for (const row of tables[model].filter((r) => match(model, r, where))) {
          const key = JSON.stringify(by.map((f) => row[f]));
          if (!groups.has(key)) {
            groups.set(key, { ...Object.fromEntries(by.map((f) => [f, row[f]])), _n: 0 });
          }
          groups.get(key)._n += 1;
        }
        return [...groups.values()].map(({ _n, ...rest }) => ({
          ...rest,
          ...(_count ? { _count: { _all: _n } } : {}),
        }));
      },
    };
  }

  const prisma = { tables };
  for (const model of Object.keys(MODELS)) prisma[model] = delegate(model);

  const txContext = new AsyncLocalStorage();
  let txQueue = Promise.resolve();

  // pg_advisory_xact_lock & co.: tranzacțiile sunt deja serializate mai jos
  prisma.$executeRaw = async () => 0;

  prisma.$transaction = async (fn) => {
    if (txContext.getStore()) return fn(prisma);
    const run = txQueue.then(() => txContext.run(true, () => runTransaction(fn)));
    txQueue = run.catch(() => {});
    return run;
  };

  const runTransaction = async (fn) => {
    const snapshot = Object.fromEntries(
      Object.entries(tables).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))])
    );
    try {
      return await fn(prisma);
    } catch (error) {
      for (const k of Object.keys(tables)) tables[k] = snapshot[k];
      throw error;
    }
  };

  prisma.seed = (model, rows) => {
    const out = [];
    for (const row of rows) {
      const built = build(model, row);
      tables[model].push(built);
      out.push(built);
    }
    return out;
  };

  for (const [model, rows] of Object.entries(seed)) prisma.seed(model, rows);

  return prisma;
}
