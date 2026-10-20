// backend/scripts/checkUnsubscribeConfig.mjs
//
// Verifică configurația linkului de dezabonare, DOAR citire:
//   - nu afișează valoarea UNSUBSCRIBE_SECRET (doar dacă e setat și lungimea);
//   - nu trimite emailuri și nu se conectează la baza de date;
//   - semnează și verifică local un token de test.
//
// Rulare (local):            node --env-file=.env scripts/checkUnsubscribeConfig.mjs
// Rulare (Render -> Shell):  node scripts/checkUnsubscribeConfig.mjs

import { checkUnsubscribeConfig } from "../src/lib/unsubscribeUrl.js";

const result = checkUnsubscribeConfig(process.env);

console.log("UNSUBSCRIBE_SECRET:", result.secretSet ? `setat (${result.secretLength} caractere)` : "LIPSĂ");
console.log("Baza URL folosită din:", result.baseSource || "(niciuna)");
console.log("Endpoint dezabonare:", result.unsubscribeEndpoint || "(niciunul)");
console.log("HTTPS:", result.httpsOk ? "da" : "NU");
console.log("Token semnat + verificat local:", result.tokenRoundTrip ? "da" : "NU");
console.log(result.ok ? "\nConfigurație OK." : `\nProbleme:\n- ${result.issues.join("\n- ")}`);
process.exitCode = result.ok ? 0 : 1;
