// controllers/searchController.js
import Product from "../models/product.js";
import Shop from "../models/shop.js";
import Category from "../models/category.js";

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const sanitize = (s) => (s || "").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rx = (s) => new RegExp(esc(s), "i");
const startsWith = (s) => new RegExp("^" + esc(s), "i");

function parseQuery(qs) {
  const q = sanitize(qs.q).slice(0, 80);
  const page = clamp(parseInt(qs.page || "1", 10) || 1, 1, 9999);
  const limit = clamp(parseInt(qs.limit || "24", 10) || 24, 1, 60);
  const sort = qs.sort || "relevance";
  const category = qs.category ? String(qs.category) : null;
  const min = qs.min != null ? Number(qs.min) : null;
  const max = qs.max != null ? Number(qs.max) : null;
  return { q, page, limit, sort, category, min, max };
}

/* ===== Sugestii ===== */
function parts(text, q) {
  if (!q) return [{ text, highlight: false }];
  const t = String(text);
  const idx = t.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return [{ text: t, highlight: false }];
  return [
    { text: t.slice(0, idx), highlight: false },
    { text: t.slice(idx, idx + q.length), highlight: true },
    { text: t.slice(idx + q.length), highlight: false },
  ];
}

export async function getSuggestions(req, res, next) {
  try {
    const q = sanitize(req.query.q);
    if (!q || q.length < 2) return res.json([]);

    const [prod, shops, cats] = await Promise.all([
      Product.find({ title: startsWith(q) }).select("title").limit(6),
      Shop.find({ name: startsWith(q) }).select("name").limit(4),
      Category.find({ name: startsWith(q) }).select("name slug").limit(4),
    ]);

    const out = [
      ...prod.map((p) => ({ id: `p_${p._id}`, value: p.title, label: p.title, type: "product", parts: parts(p.title, q) })),
      ...shops.map((s) => ({ id: `s_${s._id}`, value: s.name,  label: s.name,  type: "shop",    parts: parts(s.name, q) })),
      ...cats.map((c) => ({ id: `c_${c._id}`, value: c.name,  label: `Categorie: ${c.name}`, type: "category", slug: c.slug, parts: parts(`Categorie: ${c.name}`, q) })),
    ].slice(0, 10);

    res.json(out);
  } catch (e) { next(e); }
}

/* ===== Sort helpers ===== */
const productSort = (sort) =>
  sort === "price_asc" ? { price: 1 } :
  sort === "price_desc" ? { price: -1 } :
  sort === "newest" ? { createdAt: -1 } :
  { score: { $meta: "textScore" }, createdAt: -1 };

const shopSort = (sort) =>
  sort === "rating_desc" ? { rating: -1 } :
  sort === "newest" ? { createdAt: -1 } :
  { score: { $meta: "textScore" }, createdAt: -1 };

/* ===== Funcții pure (refolosibile) ===== */
async function findProducts(params) {
  const { q, page, limit, sort, category, min, max } = parseQuery(params);
  const filter = {};
  if (category) filter.$or = [{ category: category }, { categorySlug: category }]; // adaptează la model

  if (min != null || max != null) {
    filter.price = {};
    if (min != null) filter.price.$gte = min;
    if (max != null) filter.price.$lte = max;
  }

  // încercăm $text; dacă nu există index, cădem pe regex
  let selector = "title price images slug createdAt";
  let sortObj = sort === "relevance" ? { createdAt: -1 } : productSort(sort);
  let useText = false;

  if (q) {
    filter.$text = { $search: q };
    selector = { score: { $meta: "textScore" }, title: 1, price: 1, images: 1, slug: 1, createdAt: 1 };
    sortObj = productSort(sort);
    useText = true;
  }

  try {
    const [items, total] = await Promise.all([
      Product.find(filter).select(selector).sort(sortObj).skip((page - 1) * limit).limit(limit),
      Product.countDocuments(filter),
    ]);
    return {
      items: items.map((p) => ({
        id: p._id, type: "product", title: p.title,
        image: Array.isArray(p.images) ? p.images[0] : null,
        price: typeof p.price === "number" ? p.price : null,
        slug: p.slug,
      })),
      total, page, pages: Math.max(Math.ceil(total / limit), 1),
    };
  } catch (err) {
    // fallback dacă nu există text index
    if (useText) {
      delete filter.$text;
      const _rx = rx(q);
      filter.$or = [{ title: _rx }, { description: _rx }];
      selector = "title price images slug createdAt";
      sortObj = sort === "relevance" ? { createdAt: -1 } : productSort(sort);

      const [items, total] = await Promise.all([
        Product.find(filter).select(selector).sort(sortObj).skip((page - 1) * limit).limit(limit),
        Product.countDocuments(filter),
      ]);
      return {
        items: items.map((p) => ({
          id: p._id, type: "product", title: p.title,
          image: Array.isArray(p.images) ? p.images[0] : null,
          price: typeof p.price === "number" ? p.price : null,
          slug: p.slug,
        })),
        total, page, pages: Math.max(Math.ceil(total / limit), 1),
      };
    }
    throw err;
  }
}

async function findShops(params) {
  const { q, page, limit, sort } = parseQuery(params);
  const filter = {};
  let selector = "name logo slug rating createdAt";
  let sortObj = sort === "relevance" ? { createdAt: -1 } : shopSort(sort);
  let useText = false;

  if (q) {
    filter.$text = { $search: q };
    selector = { score: { $meta: "textScore" }, name: 1, logo: 1, slug: 1, rating: 1, createdAt: 1 };
    sortObj = shopSort(sort);
    useText = true;
  }

  try {
    const [items, total] = await Promise.all([
      Shop.find(filter).select(selector).sort(sortObj).skip((page - 1) * limit).limit(limit),
      Shop.countDocuments(filter),
    ]);
    return {
      items: items.map((s) => ({
        id: s._id, type: "shop", title: s.name,
        image: s.logo || null, slug: s.slug, rating: s.rating ?? null,
      })),
      total, page, pages: Math.max(Math.ceil(total / limit), 1),
    };
  } catch (err) {
    if (useText) {
      delete filter.$text;
      const _rx = rx(q);
      filter.$or = [{ name: _rx }, { description: _rx }];

      const [items, total] = await Promise.all([
        Shop.find(filter).select("name logo slug rating createdAt").sort(sortObj).skip((page - 1) * limit).limit(limit),
        Shop.countDocuments(filter),
      ]);
      return {
        items: items.map((s) => ({
          id: s._id, type: "shop", title: s.name,
          image: s.logo || null, slug: s.slug, rating: s.rating ?? null,
        })),
        total, page, pages: Math.max(Math.ceil(total / limit), 1),
      };
    }
    throw err;
  }
}

/* ===== Rute HTTP ===== */
export async function searchProducts(req, res, next) {
  try { res.json(await findProducts(req.query)); }
  catch (e) { next(e); }
}
export async function searchShops(req, res, next) {
  try { res.json(await findShops(req.query)); }
  catch (e) { next(e); }
}

export async function searchFacets(req, res, next) {
  try {
    const { q, min, max } = parseQuery(req.query);
    const match = {};
    if (q) match.$or = [{ title: rx(q) }, { description: rx(q) }]; // compat cu fallback
    if (min != null || max != null) {
      match.price = {};
      if (min != null) match.price.$gte = min;
      if (max != null) match.price.$lte = max;
    }
    const [byCategory, priceRange] = await Promise.all([
      Product.aggregate([
        { $match: match },
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ]),
      Product.aggregate([
        { $match: match },
        { $group: { _id: null, min: { $min: "$price" }, max: { $max: "$price" } } },
      ]),
    ]);
    res.json({
      categories: byCategory.map((c) => ({ name: c._id, count: c.count })),
      price: priceRange[0] ? { min: priceRange[0].min, max: priceRange[0].max } : { min: 0, max: 0 },
    });
  } catch (e) { next(e); }
}

/* Agregat: /api/search — întoarce două payload-uri standardizate */
export async function searchCombined(req, res, next) {
  try {
    const [products, shops] = await Promise.all([findProducts(req.query), findShops(req.query)]);
    res.json({ products, shops });
  } catch (e) { next(e); }
}
