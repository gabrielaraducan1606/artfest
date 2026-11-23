-- Artfest Creators: tariful ORIENTATIV de promovare cerut de influencer (bani, RON).
-- EXCLUSIV aditivă: o coloană nouă, nullable, fără valoare implicită și fără actualizări de date.
-- Doar informativ (nu e prețul final plătit de vânzător, nu pornește nicio plată).

-- AlterTable
ALTER TABLE "CreatorProfile" ADD COLUMN "indicativeFeeCents" INTEGER;
