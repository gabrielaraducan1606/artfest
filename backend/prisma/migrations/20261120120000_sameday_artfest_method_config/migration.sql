-- „Sameday prin Artfest”: tariful simplu Artfest pe metodă de livrare, folosit doar când
-- lipsește greutatea unui produs din coletul unui magazin. Doar ADĂUGARE: un tabel nou, gol
-- (fără valori implicite); niciun tabel / rând existent modificat.

-- CreateTable
CREATE TABLE "SamedayMethodConfig" (
    "method" VARCHAR(16) NOT NULL,
    "amountCents" INTEGER,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamedayMethodConfig_pkey" PRIMARY KEY ("method")
);
