// node scripts/backfill-product-embeddings.js
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import fetch from "node-fetch";
import { imageToEmbedding, toPgVectorLiteral } from "../src/lib/embeddings.js";

const prisma = new PrismaClient();

async function upsertEmbedding(productId, embeddingLiteral) {
  // Prisma nu poate scrie direct în coloana 'vector', deci folosim SQL raw
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO product_image_embeddings (product_id, embedding)
    VALUES ($1, CAST($2 AS vector))
    ON CONFLICT (product_id) DO UPDATE SET embedding = EXCLUDED.embedding, created_at = now()
    `,
    productId,
    embeddingLiteral
  );
}

async function run() {
  // ia produse active care au măcar o imagine
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, images: true },
  });

  for (const p of products) {
    const url = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null;
    if (!url) continue;

    // Dacă există deja rândul, poți sări — aici facem UPDATE idempotent prin ON CONFLICT
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`fetch_fail_${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());

      const emb = await imageToEmbedding(buf);
      const literal = toPgVectorLiteral(emb);
      await upsertEmbedding(p.id, literal);

      console.log("indexed", p.id);
    } catch (e) {
      console.warn("skip", p.id, e?.message || e);
    }
  }

  await prisma.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
