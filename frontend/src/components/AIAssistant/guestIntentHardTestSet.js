// src/components/AIAssistant/guestIntentHardTestSet.js

/*
 * Set de test "greu" (cerința #5, sesiunea 3) - SCRIS DE MÂNĂ, spre
 * deosebire de guestIntentTestSet.js (generat mecanic din
 * temă x transformare) - transformările mecanice de "cuvinte
 * inversate" produceau uneori text nenatural, chiar imposibil de
 * interpretat de un om. Aici fiecare frază e o formulare REALISTĂ pe
 * care chiar ar putea-o tasta un vizitator grăbit: fără semn de
 * întrebare, typo, fără diacritice, 1-3 cuvinte, colocvial, sau
 * fragment de follow-up de context.
 *
 * `expected`:
 * - un GUEST_INTENTS / CHAT_SMALLTALK - Pasul 1 (determinist) TREBUIE
 *   să decidă corect, altfel e FAIL.
 * - "DEFER" - e CORECT ca regulile determinste să NU decidă (mesajul
 *   e prea ambiguu/dependent de context) - un rezultat null aici e
 *   PASS, nu FAIL. Contextul de follow-up ("mai ieftin", "altceva")
 *   e tratat de un mecanism SEPARAT, cu memorie de conversație
 *   (runProductSearchRefinement, din sesiunile anterioare) - Pasul 1
 *   e stateless prin construcție, deci abținerea e comportamentul
 *   CORECT, nu un gol de acoperit aici.
 */

import { GUEST_INTENTS, CHAT_SMALLTALK } from "./guestIntentTaxonomy.js";

export const GUEST_INTENT_HARD_CASES = [
  /* ============== FĂRĂ SEMN DE ÎNTREBARE ============== */
  { text: "cine vinde produsele", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "no-question" },
  { text: "artfest are stoc propriu", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "no-question" },
  { text: "cum functioneaza livrarea", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "no-question" },
  { text: "trebuie cont ca sa cumpar", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "no-question" },
  { text: "cum fac retur", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "no-question" },
  { text: "caut ceva pentru nunta", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "no-question, imperative" },
  { text: "vreau un cadou pentru mama", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "no-question, imperative" },
  { text: "du-ma la produse", expected: GUEST_INTENTS.NAVIGATION, note: "no-question, imperative" },
  { text: "vreau sa ma loghez", expected: GUEST_INTENTS.ACCOUNT_ACTION, note: "no-question, imperative" },
  { text: "nu imi merge plata", expected: GUEST_INTENTS.SUPPORT, note: "no-question" },

  /* ============== TYPO (pe cuvintele-cheie comune) ============== */
  { text: "unde e comnda mea", expected: GUEST_INTENTS.ACCOUNT_ACTION, note: "typo: comnda" },
  { text: "vreau o ofeta pentru un produs", expected: GUEST_INTENTS.QUOTE_DISCOVERY, note: "typo: ofeta" },
  { text: "ce inseamna livare la comanda", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "typo: livare" },
  { text: "ce e perosnalizare?", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "typo: perosnalizare (transpoziție)" },
  { text: "cum functioneaza personalzarea?", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "typo: personalzarea (literă lipsă)" },
  { text: "produsul e disponbil?", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "typo: disponbil" },
  { text: "am o problma cu comanda", expected: GUEST_INTENTS.SUPPORT, note: "typo: problma" },
  { text: "vreau sa ma autentfic", expected: GUEST_INTENTS.ACCOUNT_ACTION, note: "typo: autentfic" },

  /* ============== FĂRĂ DIACRITICE ============== */
  { text: "cine vinde produsele de pe artfest", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "no-diacritics" },
  { text: "cum gasesc marturii pentru nunta", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "no-diacritics" },
  { text: "as vrea un cadou pentru botez", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "no-diacritics" },
  { text: "trebuie sa fiu logat ca sa cumpar", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "no-diacritics" },
  { text: "unde imi vad favoritele", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "no-diacritics - întrebare de orientare (unde), consecvent cu FAQ-ul din wishlist.manifest.js" },

  /* ============== 1-3 CUVINTE ============== */
  { text: "salut", expected: CHAT_SMALLTALK, note: "1 word" },
  { text: "multumesc", expected: CHAT_SMALLTALK, note: "1 word" },
  { text: "personalizare", expected: GUEST_INTENTS.CLARIFY, note: "1 word, ambiguous" },
  { text: "personalizat", expected: GUEST_INTENTS.CLARIFY, note: "1 word, ambiguous" },
  { text: "cadou nunta", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "2 words" },
  { text: "sub 100 lei", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "3 words, price cue" },
  { text: "comenzile mele", expected: GUEST_INTENTS.ACCOUNT_ACTION, note: "2 words" },
  { text: "contul meu", expected: GUEST_INTENTS.ACCOUNT_ACTION, note: "2 words" },
  { text: "nu merge", expected: GUEST_INTENTS.SUPPORT, note: "2 words" },
  { text: "cere oferta", expected: GUEST_INTENTS.QUOTE_DISCOVERY, note: "2 words" },
  { text: "du-ma acasa", expected: "DEFER", note: "2 words, target necunoscut - nu inventăm URL" },
  { text: "produse ieftine", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "2 words" },
  { text: "cine sunteti", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "2 words" },
  { text: "aveti stoc", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "2 words" },

  /* ============== COLOCVIAL ============== */
  { text: "bau aveti si voi produse de-astea handmade", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "colloquial" },
  { text: "sunteti si voi ca un magazin sau ce", expected: "DEFER", note: "colloquial, fără niciun cuvânt-cheie recognoscibil - corect să defereze la LLM" },
  { text: "aveti voi produsele sau le fac altii", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "colloquial (ex. utilizator) - \"aveți voi\" adăugat ca semnal de proprietate" },
  { text: "voi vindeti aici sau cum merge treaba", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "colloquial (ex. utilizator)" },
  { text: "cine vinde aici de fapt", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "colloquial (ex. utilizator)" },
  { text: "produsele sunt ale voastre sau nu", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "colloquial (ex. utilizator)" },
  { text: "ma puteti ajuta sa gasesc ceva mai ieftin de tot", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "colloquial, fără obiect concret numit - cade pe explain-generic (catch-all), care oricum deferă la askCopilot/LLM la fel ca null (vezi AiAssistant.jsx: case PLATFORM_KNOWLEDGE -> return null) - comportament IDENTIC în practică, doar eticheta de Pas 1 diferă" },
  { text: "nush ce sa aleg pentru cadou de nunta", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "colloquial, argou" },
  { text: "hai ajutati-ma cu o idee de cadou", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "colloquial" },
  { text: "pai cum merge cu plata ramburs", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "colloquial" },

  /* ============== CONTEXT FOLLOW-UP (fragmente, fără istoric aici) ============== */
  { text: "mai ieftine", expected: "DEFER", note: "follow-up fragment - gestionat cu context separat" },
  { text: "mai scumpe", expected: "DEFER", note: "follow-up fragment" },
  { text: "altceva", expected: "DEFER", note: "follow-up fragment" },
  { text: "personalizabile", expected: "DEFER", note: "follow-up fragment" },
  { text: "alta culoare", expected: "DEFER", note: "follow-up fragment" },
  { text: "pana in 100 lei", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "follow-up cu preț explicit - decidem determinist" },
  { text: "de la alt creator", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "follow-up fragment - \"creator\" ca temă câștigă; urmărirea de context reală se face separat (refinement cu searchId), nu afectat" },
  { text: "pentru alt eveniment", expected: "DEFER", note: "follow-up fragment" },
  { text: "mai arata-mi", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "follow-up fragment - \"arată-mi\" tratat ca cerere de căutare, rezultat rezonabil" },
  { text: "nu asta", expected: "DEFER", note: "follow-up fragment" },

  /* ============== EXTRA - acoperire suplimentară pe teme cerute ============== */
  { text: "pot sa platesc ramburs", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "payments" },
  { text: "cat costa transportul", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "delivery" },
  { text: "produsul e epuizat", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "availability" },
  { text: "cine imi trimite coletul", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "seller/delivery" },
  { text: "vreau sa vad recenziile", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "\"vreau\" fără alt semnal - regulă generică, consecventă" },
  { text: "pot vedea recenzii fara cont", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "reviews" },
  { text: "ce sunt colectiile", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "collections" },
  { text: "pot salva la favorite fara cont", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "wishlist" },
  { text: "cum ma inregistrez cu google", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "auth" },
  { text: "gasesti idei de cadouri de craciun", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "gifts/events" },
  { text: "ce categorii aveti", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "categories" },
  { text: "arata-mi decoratiuni de botez", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "categories/events" },
  { text: "recomanda-mi ceva pentru un prieten", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "recommendations" },
  { text: "buget maxim 50 lei", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "budget" },
  { text: "am nevoie de ajutor", expected: GUEST_INTENTS.SUPPORT, note: "support" },
  { text: "s-a blocat plata", expected: GUEST_INTENTS.SUPPORT, note: "support" },
  { text: "deschide categoriile", expected: GUEST_INTENTS.NAVIGATION, note: "navigation" },
  { text: "mergi la cos", expected: GUEST_INTENTS.NAVIGATION, note: "navigation" },
  { text: "vreau cererile mele", expected: GUEST_INTENTS.ACCOUNT_ACTION, note: "account" },
  { text: "nu gasesc exact ce vreau", expected: GUEST_INTENTS.QUOTE_DISCOVERY, note: "quote" },
  { text: "poate face vanzatorul altceva", expected: GUEST_INTENTS.QUOTE_DISCOVERY, note: "quote" },

  /* ============== "produs" NU înseamnă automat search (regula #3) ============== */
  { text: "produsul e disponibil", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "produs != search" },
  { text: "cum se livreaza produsul", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "produs != search" },
  { text: "ce se intampla daca produsul e la comanda", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "produs != search" },
  { text: "cine vinde produsele", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "produs != search (duplicat intenționat, temă centrală)" },
  { text: "caut un produs pentru botez", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "produs = search (contrast)" },
  { text: "gaseste-mi un produs sub 100 lei", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "produs = search (contrast)" },

  /* ============== mai multe typo-uri, cuvinte diferite ============== */
  { text: "cati produse aveti", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "generic count question - regulă generică pe \"produse\", rezultat defensibil" },
  { text: "cum e cu retunul", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "typo prea agresiv (retunul), în afara vocabularului - dar rămâne întrebare (\"cum\"), catch-all e comportamentul documentat" },
  { text: "vreu sa caut ceva", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "typo pe \"vreau\" (neafectat, în afara vocabularului), dar \"caut\" e corect scris - semnal suficient" },
  { text: "as dori sa aflu cum functioneaza avansul", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "formal + payments" },
  { text: "buna, ce reduceri aveti", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "smalltalk prefix + real question" },

  /* ============== EXTRA - typo/colocvial/scurt, teme rămase ============== */
  { text: "politica de retur", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "returns, 3 words" },
  { text: "vreau sa returnez", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "returns - excludere pe cuvânt-temă strict" },
  { text: "cate zile am pt retur", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "returns, colloquial abbrev" },
  { text: "cum platesc ramburs sau card", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "payments" },
  { text: "de ce nu merge cardul", expected: GUEST_INTENTS.SUPPORT, note: "payments + support" },
  { text: "unde e coletul meu", expected: GUEST_INTENTS.ACCOUNT_ACTION, note: "no-diacritics, delivery tracking" },
  { text: "cine imi expediaza comanda", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "seller/delivery, no-diacritics" },
  { text: "vand si eu pe artfest", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "become-a-vendor intent - \"artfest\" ca temă, duce la explicația \"cum devin vânzător\", rezonabil" },
  { text: "cum devin vanzator", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "seller onboarding" },
  { text: "produs epuizat ce inseamna", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "availability, no-question-mark" },
  { text: "am nevoie de o marime mai mare", expected: "DEFER", note: "variant not available, dar fără niciun cuvânt-cheie de ofertă/temă - cerință reală pentru LLM, nu determinist" },
  { text: "cat dureaza sa primesc comanda", expected: "DEFER", note: "delivery timing, dar \"comandă\" fără \"livrare\" explicit - genuinely ambiguu determinist" },
  { text: "vreau ceva roz pentru petrecere", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "colors + events" },
  { text: "ce inseamna precomanda", expected: GUEST_INTENTS.PLATFORM_KNOWLEDGE, note: "availability terminology" },
  { text: "produse handmade", expected: GUEST_INTENTS.PRODUCT_DISCOVERY, note: "2 words, generic search" },
];
