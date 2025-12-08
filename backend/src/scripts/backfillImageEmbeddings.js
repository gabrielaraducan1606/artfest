// server/scripts/backfillImageEmbeddings.js
import { prisma } from "../db.js";
import { imageToEmbedding, toPgVectorLiteral } from "../lib/embeddings.js";
import fetch from "node-fetch";

// adaptează dacă imaginile tale nu sunt URL-uri HTTP absolute
async function fetchImageBuffer(url) {
  if (!url) {
    throw new Error("URL imagine gol");
  }

  // dacă ai URL-uri relative (ex: /uploads/...), trebuie să le prefixezi cu origin:
  // const fullUrl = url.startsWith("http")
  //   ? url
  //   : `https://domeniul-tau.ro${url}`;
  const fullUrl = url;

  const res = await fetch(fullUrl);
  if (!res.ok) {
    throw new Error(
      `Nu am putut descărca imaginea: ${fullUrl} (${res.status})`
    );
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function processProduct(p) {
  const firstImage = Array.isArray(p.images) ? p.images[0] : null;
  if (!firstImage) {
    console.log(`- [SKIP] Produs ${p.id} nu are imagini.`);
    return;
  }

  // verificăm dacă există deja embedding pt product_id + image_index 0
  const existing = await prisma.$queryRawUnsafe(
    `
    SELECT id
    FROM product_image_embeddings
    WHERE product_id = $1 AND image_index = 0
    LIMIT 1
    `,
    p.id
  );

  if (existing.length > 0) {
    console.log(`- [SKIP] Produs ${p.id} are deja embedding.`);
    return;
  }

  try {
    console.log(`- Procesez produs ${p.id} (img: ${firstImage})...`);

    const imgBuffer = await fetchImageBuffer(firstImage);
    const emb = await imageToEmbedding(imgBuffer);
    const vec = toPgVectorLiteral(emb);

    await prisma.$executeRawUnsafe(
      `
      INSERT INTO product_image_embeddings (product_id, image_index, embedding)
      VALUES ($1, $2, CAST($3 AS vector))
      `,
      p.id,
      0,
      vec
    );

    console.log(`✓ Gata produs ${p.id}`);
  } catch (err) {
    console.error(`✗ Eroare la produsul ${p.id}:`, err.message);
  }
}

async function main() {
  console.log("Încep backfill embeddings...");

  const batchSize = 100;
  let skip = 0;
  let totalProcessed = 0;

  while (true) {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        // dacă images e listă scalară:
        // images: { isEmpty: false },
        // dacă e JSON: scoate filtrul și filtrezi în JS
      },
      select: {
        id: true,
        images: true,
      },
      skip,
      take: batchSize,
    });

    if (!products.length) break;

    console.log(
      `Batch de ${products.length} produse (skip=${skip})...`
    );

    for (const p of products) {
      await processProduct(p);
      totalProcessed++;
    }

    skip += batchSize;
  }

  console.log(`Gata backfill embeddings. Produse procesate: ${totalProcessed}`);
}

main()
  .catch((e) => {
    console.error("EROARE GLOBALĂ backfill:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
