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
};

const isPlainObject = (v) =>
  v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

const cmp = (a, b) => {
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
    if (rel.many) return tables[rel.model].filter((r) => r[rel.fk] === row.id);
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

  let clock = 1_700_000_000_000;

  function build(model, data) {
    const def = MODELS[model];
    const now = new Date(clock++);
    const row = { id: nextId(model), createdAt: now, ...def.defaults, ...data };
    if (def.autoDate && !row[def.autoDate]) row[def.autoDate] = now;
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
        Object.assign(row, data);
        return { ...row };
      },
      async updateMany({ where, data }) {
        const rows = tables[model].filter((r) => match(model, r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      async upsert({ where, create, update }) {
        const row = whereUnique(model, where);
        if (row) {
          Object.assign(row, update);
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

  prisma.$transaction = async (fn) => {
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
