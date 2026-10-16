-- =====================================================================
-- Târg Artfest - regulamentul acceptat la înscriere.
-- termsVersion și termsUrl se setează DOAR împreună, iar URL-ul este adresa
-- canonică a versiunii (pagina publică /targ-artfest/regulament/v<versiune>).
-- Interzice stările „doar unul setat” sau „URL care nu corespunde versiunii”.
-- Strict aditivă (doar ADD CONSTRAINT); rândurile existente au ambele NULL.
-- =====================================================================

ALTER TABLE "ArtfestFair"
  ADD CONSTRAINT "ArtfestFair_terms_pair_chk"
    CHECK (
      ("termsVersion" IS NULL AND "termsUrl" IS NULL)
      OR (
        "termsVersion" IS NOT NULL
        AND "termsVersion" ~ '^[0-9]+\.[0-9]+\.[0-9]+$'
        AND "termsUrl" = '/targ-artfest/regulament/v' || "termsVersion"
      )
    );
