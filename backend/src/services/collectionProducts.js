// backend/src/services/collectionProducts.js
//
// Regulile după care o colecție Artfest (model Collection) își alege
// produsele publice. Sursă unică pentru:
//  - GET /api/public/collections/:slug (publicProductRoutes.js) - lista de
//    produse a paginii;
//  - GET /api/public/collections (publicCollectionsRoutes.js) și
//    GET /sitemap.xml (sitemap.js) - decid dacă o colecție are cel puțin
//    un produs real (colecțiile goale nu se linkează și nu intră în
//    sitemap).
//
// Nu modifică nimic în DB; doar construiește clauze `where` și face
// interogări de citire.
//
// De ce nu `products: { some: ... }`: produsele unei colecții NU sunt o
// relație Prisma. Sunt (a) produse fixate (CollectionItem.pinned) și (b)
// produse care se potrivesc `Collection.rules` (JSON). De aceea
// `collectionsWithPublicProducts` rezolvă TOATE colecțiile cu un număr
// CONSTANT de interogări (max. 2, indiferent câte colecții sunt), nu una
// per colecție.

/* =========================================================
   Definiția "produs public" + regulile colecției
========================================================= */

/**
 * Produs public eligibil pentru o colecție: activ, neascuns, aprobat,
 * serviciu activ (status ACTIVE), vendor activ, serviciu de tip
 * "products". Aceeași definiție ca pagina colecției.
 */
export function publicProductWhere() {
  return {
    isActive: true,
    isHidden: false,
    moderationStatus: "APPROVED",
    service: {
      is: {
        isActive: true,
        status: "ACTIVE",
        vendor: { is: { isActive: true } },
        type: { is: { code: "products" } },
      },
    },
  };
}

function safeRules(rules) {
  return rules && typeof rules === "object" && !Array.isArray(rules)
    ? rules
    : {};
}

/**
 * Doar partea de reguli (fără condițiile de produs public): clauza
 * `where` pe câmpurile produsului. Obiect gol => colecție fără constrângeri.
 * Sursa unică folosită atât în interogările Prisma, cât și de evaluatorul
 * în memorie (`productMatchesRulesClause`).
 */
export function buildCollectionRulesClause(rawRules = {}) {
  const rules = safeRules(rawRules);
  const clause = {};

  if (Array.isArray(rules.categories) && rules.categories.length) {
    clause.category = {
      in: rules.categories.map((x) => String(x || "").trim()).filter(Boolean),
    };
  }

  if (rules.acceptsCustom === true) {
    clause.acceptsCustom = true;
  }

  const minPriceCents = Number(rules.minPriceCents);
  const maxPriceCents = Number(rules.maxPriceCents);

  if (Number.isFinite(minPriceCents) || Number.isFinite(maxPriceCents)) {
    clause.priceCents = {};
    if (Number.isFinite(minPriceCents)) clause.priceCents.gte = minPriceCents;
    if (Number.isFinite(maxPriceCents)) clause.priceCents.lte = maxPriceCents;
  }

  if (Array.isArray(rules.occasionTags) && rules.occasionTags.length) {
    clause.occasionTags = { hasSome: rules.occasionTags.map(String) };
  }

  if (Array.isArray(rules.styleTags) && rules.styleTags.length) {
    clause.styleTags = { hasSome: rules.styleTags.map(String) };
  }

  return clause;
}

/**
 * `where` pentru produsele unei colecții: produs public + regulile din
 * `collection.rules`. `excludedIds` = produsele excluse manual/deja
 * afișate (pinned).
 */
export function buildCollectionWhereFromRules(rules = {}, excludedIds = []) {
  return {
    ...publicProductWhere(),
    ...(excludedIds.length ? { id: { notIn: excludedIds } } : {}),
    ...buildCollectionRulesClause(rules),
  };
}

// Câmpurile de produs de care au nevoie regulile (pentru `select`).
export const RULE_PRODUCT_FIELDS = {
  id: true,
  category: true,
  acceptsCustom: true,
  priceCents: true,
  occasionTags: true,
  styleTags: true,
};

/**
 * Evaluează în memorie clauza produsă de `buildCollectionRulesClause`
 * (același subset de operatori pe care îl folosește Prisma: in, gte, lte,
 * hasSome, egalitate pe acceptsCustom). Nu interpretează clauze
 * arbitrare - doar pe cele generate de builder-ul de mai sus.
 */
export function productMatchesRulesClause(product, clause) {
  if (!product || !clause) return false;

  if (clause.category && !clause.category.in.includes(product.category)) {
    return false;
  }

  if (clause.acceptsCustom === true && product.acceptsCustom !== true) {
    return false;
  }

  if (clause.priceCents) {
    const price = product.priceCents;
    if ("gte" in clause.priceCents && !(price >= clause.priceCents.gte)) {
      return false;
    }
    if ("lte" in clause.priceCents && !(price <= clause.priceCents.lte)) {
      return false;
    }
  }

  for (const field of ["occasionTags", "styleTags"]) {
    if (clause[field]) {
      const tags = Array.isArray(product[field]) ? product[field] : [];
      if (!clause[field].hasSome.some((tag) => tags.includes(tag))) {
        return false;
      }
    }
  }

  return true;
}

/* =========================================================
   "Are colecția cel puțin un produs public?" - în lot
========================================================= */

/**
 * Pentru fiecare colecție din `collections`: are cel puțin un produs
 * public? Aceeași semantică ca pagina colecției: produsele fixate (pinned,
 * ignoră regulile) plus cele care se potrivesc regulilor, fără cele
 * excluse manual.
 *
 * NUMĂR CONSTANT de interogări, indiferent de numărul colecțiilor:
 *  1. (doar dacă există produse fixate) un `findMany` cu `id in [...]`
 *     peste toate produsele fixate ale tuturor colecțiilor;
 *  2. (doar dacă mai rămân colecții nerezolvate) un `findMany` cu
 *     `OR: [<clauza colecției>, ...]` peste produsele publice, cu select
 *     minim; potrivirea per colecție se face apoi în memorie.
 *
 * @param {object} db  client Prisma (sau echivalent)
 * @param {Array<{rules?: object, items?: Array<{productId:string,pinned?:boolean,excluded?:boolean}>}>} collections
 * @returns {Promise<boolean[]>} aliniat cu `collections`
 */
export async function collectionsWithPublicProducts(db, collections) {
  const list = Array.isArray(collections) ? collections : [];
  if (!list.length) return [];

  const specs = list.map((collection) => {
    const items = Array.isArray(collection?.items) ? collection.items : [];

    return {
      clause: buildCollectionRulesClause(collection?.rules),
      excluded: new Set(
        items.filter((i) => i.excluded).map((i) => i.productId)
      ),
      pinned: items
        .filter((i) => i.pinned && !i.excluded)
        .map((i) => i.productId),
    };
  });

  const result = list.map(() => false);

  /* 1) produse fixate care sunt publice */
  const allPinned = [...new Set(specs.flatMap((s) => s.pinned))];

  if (allPinned.length) {
    const publicPinned = new Set(
      (
        await db.product.findMany({
          where: { ...publicProductWhere(), id: { in: allPinned } },
          select: { id: true },
        })
      ).map((p) => p.id)
    );

    specs.forEach((spec, index) => {
      if (spec.pinned.some((id) => publicPinned.has(id))) result[index] = true;
    });
  }

  /* 2) produse care se potrivesc regulilor (doar colecțiile rămase) */
  const pending = specs
    .map((spec, index) => ({ spec, index }))
    .filter(({ index }) => !result[index]);

  if (!pending.length) return result;

  const candidates = await db.product.findMany({
    where: {
      ...publicProductWhere(),
      OR: pending.map(({ spec }) => spec.clause),
    },
    select: RULE_PRODUCT_FIELDS,
  });

  for (const { spec, index } of pending) {
    result[index] = candidates.some(
      (product) =>
        !spec.excluded.has(product.id) &&
        productMatchesRulesClause(product, spec.clause)
    );
  }

  return result;
}

/** Varianta pentru o singură colecție (folosește același cod ca lotul). */
export async function collectionHasPublicProducts(db, collection) {
  const [has] = await collectionsWithPublicProducts(db, [collection]);
  return has;
}
