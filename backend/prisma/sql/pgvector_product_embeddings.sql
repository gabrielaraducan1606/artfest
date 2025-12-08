-- 1) extensia pgvector (o singură dată pe baza de date)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) tabelul pentru embeddings de imagini
CREATE TABLE IF NOT EXISTS product_image_embeddings (
  id BIGSERIAL PRIMARY KEY,
  -- Product.id la tine este String fără @db.Uuid, deci în Postgres e TEXT
  product_id TEXT REFERENCES "Product"(id) ON DELETE CASCADE,
  image_index INT NOT NULL DEFAULT 0,
  embedding VECTOR(512) NOT NULL
);

-- 3) index pt. căutare rapidă pe vectori
CREATE INDEX IF NOT EXISTS product_image_embeddings_vec_idx
ON product_image_embeddings
USING ivfflat (embedding vector_l2_ops)
WITH (lists = 100);

-- 4) index normal pe product_id (opțional, dar util)
CREATE INDEX IF NOT EXISTS product_image_embeddings_product_idx
ON product_image_embeddings (product_id);
