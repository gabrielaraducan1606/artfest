import { prisma } from "../db.js";
import { imageToEmbedding, toPgVectorLiteral } from "../lib/embeddings.js";
import fetch from "node-fetch";

const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || "";
const FETCH_TIMEOUT_MS = Number(process.env.IMAGE_FETCH_TIMEOUT_MS || 15000);
const BATCH_SIZE = Number(process.env.IMAGE_BACKFILL_BATCH || 50);

function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

function normalizeImageUrl(img) {
  if (!img) return null;
  if (typeof img === "string") return img;
  if (typeof img === "object") return img.url || img.src || img.href || img.path || null;
  return null;
}

async function fetchImageBuffer(raw) {
  const rawUrl = normalizeImageUrl(raw);
  if (!rawUrl) throw new Error("URL imagine lipsă sau format necunoscut");

  const url = String(rawUrl).trim();
  if (!url) throw new Error("URL imagine gol");

  if (isDataUrl(url)) {
    const commaIndex = url.indexOf(",");
    if (commaIndex === -1) throw new Error("data URL invalid (nu conține ,)");
    const base64Part = url.slice(commaIndex + 1);
    if (!base64Part) throw new Error("data URL invalid (nu are conținut base64)");
    return Buffer.from(base64Part, "base64");
  }

  let finalUrl = url;
  if (!/^https?:\/\//i.test(url)) {
    if (!IMAGE_BASE_URL) {
      throw new Error(`URL relativ (${url}) dar IMAGE_BASE_URL nu este setat în env`);
    }
    finalUrl = IMAGE_BASE_URL.replace(/\/+$/, "") + "/" + url.replace(/^\/+/, "");
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(finalUrl, { signal: controller.signal });
  } catch (e) {
    throw new Error(`Fetch a eșuat pentru ${finalUrl}: ${e?.message || e}`);
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    throw new Error(`Nu am putut descărca imaginea: ${finalUrl} (status ${res.status})`);
  }

  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function isAllZeroEmbedding(arr) {
  for (let i = 0; i < arr.length; i++) if (arr[i] !== 0) return false;
  return true;
}

function quoteIdent(ident) {
  // quote SQL identifier safely ("productId")
  // We only call this on identifiers we discovered from information_schema.
  const safe = String(ident).replace(/"/g, '""');
  return `"${safe}"`;
}

async function detectEmbeddingTableShape() {
  // confirm table exists + fetch columns (in the SAME DB Prisma uses)
  const cols = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_image_embeddings'
    ORDER BY ordinal_position
  `;

  const colNames = (cols || []).map((r) => r.column_name);
  console.log("COLUMNS public.product_image_embeddings:", colNames);

  if (!colNames.length) {
    throw new Error(
      "Nu găsesc tabela public.product_image_embeddings în DB-ul curent (sau nu ai permisiuni)."
    );
  }

  // pick product id column
  const productIdCandidates = ["product_id", "productId", "productid", "productID"];
  const imageIndexCandidates = ["image_index", "imageIndex", "imageindex", "imageIDX"];
  const embeddingCandidates = ["embedding"];

  const productIdCol = productIdCandidates.find((c) => colNames.includes(c));
  const imageIndexCol = imageIndexCandidates.find((c) => colNames.includes(c));
  const embeddingCol = embeddingCandidates.find((c) => colNames.includes(c));

  if (!productIdCol) {
    throw new Error(
      `Nu găsesc coloana de product id. Am căutat: ${productIdCandidates.join(
        ", "
      )}. Coloane existente: ${colNames.join(", ")}`
    );
  }
  if (!imageIndexCol) {
    throw new Error(
      `Nu găsesc coloana de image index. Am căutat: ${imageIndexCandidates.join(
        ", "
      )}. Coloane existente: ${colNames.join(", ")}`
    );
  }
  if (!embeddingCol) {
    throw new Error(
      `Nu găsesc coloana embedding. Coloane existente: ${colNames.join(", ")}`
    );
  }

  return {
    productIdCol,
    imageIndexCol,
    embeddingCol,
  };
}

async function processProduct(p, shape) {
  const firstImage = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null;

  if (!firstImage) {
    console.log(`- [SKIP] Produs ${p.id} nu are imagini.`);
    return false;
  }

  // Build SQL with detected identifiers (safe; identifiers come from information_schema)
  const pid = quoteIdent(shape.productIdCol);
  const idx = quoteIdent(shape.imageIndexCol);
  const emb = quoteIdent(shape.embeddingCol);

  // 1) check existing
  const existsSql = `
    SELECT id
    FROM public.product_image_embeddings
    WHERE ${pid} = $1 AND ${idx} = 0
    LIMIT 1
  `;
  const existing = await prisma.$queryRawUnsafe(existsSql, p.id);

  if (Array.isArray(existing) && existing.length > 0) {
    console.log(`- [SKIP] Produs ${p.id} are deja embedding (id=${existing[0].id})`);
    return false;
  }

  try {
    console.log(`- Procesez produs ${p.id}...`);

    const imgBuffer = await fetchImageBuffer(firstImage);

    const vecArr = await imageToEmbedding(imgBuffer);
    if (!vecArr || vecArr.length !== 512) {
      throw new Error(`Embedding invalid (len=${vecArr?.length})`);
    }
    if (isAllZeroEmbedding(vecArr)) {
      throw new Error("Embedding all-zero (fallback / eșec CLIP).");
    }

   const vecLiteral = toPgVectorLiteral(vecArr);

await prisma.$executeRaw`
  INSERT INTO public.product_image_embeddings (product_id, image_index, embedding)
  VALUES (${p.id}, 0, CAST(${vecLiteral} AS vector))
  ON CONFLICT (product_id, image_index)
  DO UPDATE SET embedding = EXCLUDED.embedding
`;
const rows = await prisma.$queryRaw`
  SELECT product_id, MIN(embedding <=> CAST(${pgVec} AS vector)) AS score
  FROM public.product_image_embeddings
  GROUP BY product_id
  ORDER BY score
  LIMIT ${k}
`;

await prisma.$executeRawUnsafe(insertSql, p.id, 0, vecLiteral);

    console.log(`  ✓ OK produs ${p.id}`);
    return true;
  } catch (err) {
    console.error(`  ✗ Eroare la produsul ${p.id}:`, err?.message || err);
    return false;
  }
}

async function main() {
  console.log("Încep backfill embeddings...");

  // DEBUG: confirm DB
  const info = await prisma.$queryRaw`
    SELECT current_database() AS db,
           current_user AS user,
           current_schema() AS schema,
           current_setting('search_path') AS search_path,
           inet_server_addr() AS server_ip,
           inet_server_port() AS server_port,
           version() AS version;
  `;
  console.log("DB INFO:", info);

  // Detect table columns in THIS DB
  const shape = await detectEmbeddingTableShape();

  const total = await prisma.product.count({ where: { isActive: true } });
  console.log(`Total produse active: ${total}`);

  let skip = 0;
  let processed = 0;
  let inserted = 0;

  while (true) {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, images: true },
      skip,
      take: BATCH_SIZE,
      orderBy: { createdAt: "asc" },
    });

    if (!products.length) break;

    console.log(`Batch de ${products.length} produse (skip=${skip})...`);

    for (const p of products) {
      processed++;
      const ok = await processProduct(p, shape);
      if (ok) inserted++;
    }

    skip += products.length;
  }

  console.log(
    `Gata backfill embeddings. Produse procesate: ${processed}, embeddings inserate: ${inserted}`
  );
}

main()
  .catch((e) => {
    console.error("EROARE GLOBALĂ backfill:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
