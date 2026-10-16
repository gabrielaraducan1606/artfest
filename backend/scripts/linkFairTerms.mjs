// backend/scripts/linkFairTerms.mjs
//
// Leagă o versiune PUBLICATĂ a regulamentului Târgului Artfest de înscriere:
// setează ÎMPREUNĂ ArtfestFair.termsVersion + termsUrl (URL-ul se derivă din versiune).
//
// Implicit rulează doar verificarea (nu scrie nimic):
//   node --env-file=.env scripts/linkFairTerms.mjs --version 1.0.0
// Scrierea cere confirmarea explicită a hostului bazei de date:
//   node --env-file=.env scripts/linkFairTerms.mjs --version 1.0.0 --apply --confirm-host <host>
//
// Refuză versiunile care nu sunt în legal/artfest_fair_rules/versions.yml, al căror
// fișier lipsește sau care mai conțin marcaje de draft / variabile lipsă.

import { prisma } from "../src/db.js";
import { checkPublishableTerms, linkPublishedTerms, termsPairState } from "../src/services/artfestFairTermsService.js";
import { ARTFEST_FAIR_KEY } from "../src/config/artfestFair.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const version = arg("version");
const apply = process.argv.includes("--apply");
const confirmHost = arg("confirm-host");
const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL).hostname;
  } catch {
    return null;
  }
})();

try {
  console.log("Baza de date:", host || "(necunoscută)");
  const fair = await prisma.artfestFair.findUnique({
    where: { key: ARTFEST_FAIR_KEY },
    select: { termsVersion: true, termsUrl: true },
  });
  if (!fair) throw new Error("Târgul nu există în această bază.");
  console.log("Acum:", JSON.stringify(fair), "| stare:", termsPairState(fair.termsVersion, fair.termsUrl));

  const target = checkPublishableTerms(version);
  console.log(`Versiunea ${target.version} este publicată: „${target.title}” -> ${target.url}`);

  if (!apply) {
    console.log("Verificare încheiată. Nimic nu a fost scris (adaugă --apply --confirm-host <host>).");
  } else {
    if (!host || confirmHost !== host) {
      throw new Error(`--confirm-host trebuie să fie exact hostul bazei (${host}). Nimic nu a fost scris.`);
    }
    const result = await linkPublishedTerms({ version: target.version });
    console.log("Scris:", JSON.stringify(result.before), "->", JSON.stringify(result.after));
  }
} catch (error) {
  console.error("Oprit:", error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
