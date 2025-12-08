-- 1) extensia pgvector (o singură dată pe baza de date)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) tabelul pentru embeddings de imagini
CREATE TABLE IF NOT EXISTS product_image_embeddings (
  id BIGSERIAL PRIMARY KEY,
  -- Product.id la tine este String fără @db.Uuid → în Postgres e TEXT
  product_id TEXT REFERENCES "Product"(id) ON DELETE CASCADE,
  image_index INT NOT NULL DEFAULT 0,
  embedding VECTOR(512) NOT NULL
);

-- 3) index vectorial pentru căutare rapidă
CREATE INDEX IF NOT EXISTS product_image_embeddings_vec_idx
ON product_image_embeddings
USING ivfflat (embedding vector_l2_ops)
WITH (lists = 100);

-- 4) index normal pe product_id
CREATE INDEX IF NOT EXISTS product_image_embeddings_product_idx
ON product_image_embeddings (product_id);

-- 5) constraint unic pe (product_id, image_index) ca să poți face UPSERT pe viitor
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_image_embeddings_unique'
  ) THEN
    ALTER TABLE product_image_embeddings
    ADD CONSTRAINT product_image_embeddings_unique
    UNIQUE (product_id, image_index);
  END IF;
END$$;
