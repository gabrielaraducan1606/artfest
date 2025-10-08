BEGIN;

-- vezi dublurile
SELECT "vendorId","typeId", COUNT(*) AS cnt, array_agg(id ORDER BY "createdAt") AS ids
FROM "VendorService"
GROUP BY "vendorId","typeId"
HAVING COUNT(*) > 1;

-- șterge dublurile (păstrează ACTIVE apoi cel mai vechi)
WITH ranked AS (
  SELECT id,"vendorId","typeId","status","createdAt",
         row_number() OVER (
           PARTITION BY "vendorId","typeId"
           ORDER BY
             CASE WHEN "status"='ACTIVE' THEN 0
                  WHEN "status"='DRAFT'  THEN 1
                  ELSE 2 END,
             "createdAt"
         ) rn
  FROM "VendorService"
),
to_delete AS (SELECT id FROM ranked WHERE rn > 1)
DELETE FROM "VendorService" v
USING to_delete d
WHERE v.id = d.id;

-- verificare
SELECT "vendorId","typeId", COUNT(*) AS cnt
FROM "VendorService"
GROUP BY "vendorId","typeId"
HAVING COUNT(*) > 1;

COMMIT;
