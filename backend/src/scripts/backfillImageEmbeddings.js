// src/scripts/backfillImageEmbeddings.js
import { prisma } from "../db.js";
import { imageToEmbedding, toPgVectorLiteral } from "../lib/embeddings.js";
import fetch from "node-fetch";

// Dacă în DB ai URL-uri relative (ex: "/uploads/xyz.jpg"),
// setează în .env ceva de genul:
// IMAGE_BASE_URL=https://artfest.ro
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || "";

// helper: detectăm dacă e data URL (data:image/png;base64,...)
function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

// descarcă imaginea ca Buffer, suportând:
// - data URL
// - URL absolut (http/https)
// - URL relativ (dacă avem IMAGE_BASE_URL)
async function fetchImageBuffer(rawUrl) {
  if (!rawUrl) {
    throw new Error("URL imagine lipsă");
  }
  if (typeof rawUrl !== "string") {
    throw new Error("URL imagine nu este string");
  }

  const url = rawUrl.trim();

  // 1) data URL (base64)
  if (isDataUrl(url)) {
    const commaIndex = url.indexOf(",");
    if (commaIndex === -1) {
      throw new Error("data URL invalid (nu conține ,)");
    }
    const base64Part = url.slice(commaIndex + 1);
    if (!base64Part) {
      throw new Error("data URL invalid (nu are conținut base64)");
    }
    return Buffer.from(base64Part, "base64");
  }

  // 2) URL absolut (http/https)
  let finalUrl = url;
  if (!/^https?:\/\//i.test(url)) {
    // 3) URL relativ → avem nevoie de IMAGE_BASE_URL
    if (!IMAGE_BASE_URL) {
      throw new Error(
        `URL relativ (${url}) dar IMAGE_BASE_URL nu este setat în env`
      );
    }
    finalUrl =
      IMAGE_BASE_URL.replace(/\/+$/, "") + "/" + url.replace(/^\/+/, "");
  }

  const res = await fetch(finalUrl);
  if (!res.ok) {
    throw new Error(
      `Nu am putut descărca imaginea: ${finalUrl} (status ${res.status})`
    );
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function processProduct(p) {
  const firstImage =
    Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null;

  if (!firstImage) {
    console.log(`- [SKIP] Produs ${p.id} nu are imagini.`);
    return false;
  }

  // verificăm dacă există deja embedding pentru product_id + image_index 0
  const existing = await prisma.$queryRawUnsafe(
    `
      SELECT id
      FROM product_image_embeddings
      WHERE product_id = $1 AND image_index = 0
      LIMIT 1
    `,
    p.id
  );

  if (Array.isArray(existing) && existing.length > 0) {
    console.log(
      `- [SKIP] Produs ${p.id} are deja embedding (product_image_embeddings.id=${existing[0].id})`
    );
    return false;
  }

  try {
    console.log(`- Procesez produs ${p.id}...`);
    // 1) luăm imaginea ca buffer
    const imgBuffer = await fetchImageBuffer(firstImage);

    // 2) facem embedding
    const emb = await imageToEmbedding(imgBuffer);
    const vec = toPgVectorLiteral(emb); // '[0.1,0.2,...]'

    // 3) inserăm în pgvector
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO product_image_embeddings (product_id, image_index, embedding)
        VALUES ($1, $2, CAST($3 AS vector))
      `,
      p.id,
      0,
      vec
    );

    console.log(`  ✓ OK produs ${p.id}`);
    return true;
  } catch (err) {
    console.error(
      `  ✗ Eroare la produsul ${p.id}:`,
      err?.message || err
    );
    return false;
  }
}

async function main() {
  console.log("Încep backfill embeddings...");

  const batchSize = 50;
  let skip = 0;
  let processed = 0;
  let inserted = 0;

  // iei din DB doar produse active care au cel puțin o imagine
  // (condiția pe images nu filtrează perfect, dar e ok, filtrăm noi în cod)
  const total = await prisma.product.count({
    where: {
      isActive: true,
    },
  });

  console.log(`Total produse active: ${total}`);

  while (true) {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
      },
      select: {
        id: true,
        images: true,
      },
      skip,
      take: batchSize,
      orderBy: {
        createdAt: "asc",
      },
    });

    if (!products.length) break;

    console.log(
      `Batch de ${products.length} produse (skip=${skip})...`
    );

    for (const p of products) {
      processed++;
      const ok = await processProduct(p);
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
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
