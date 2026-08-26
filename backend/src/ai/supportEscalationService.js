// backend/src/ai/supportEscalationService.js

/*
 * FAZA 8-10: AI-ul încearcă să rezolve problema înainte să ofere
 * ticket. Patru decizii posibile (SupportEscalationService):
 *
 *   RESOLVE_WITH_AI        - răspuns/pași concreți, fără ticket.
 *   ASK_CLARIFICATION      - o singură întrebare, max 2 ture.
 *   OFFER_TICKET           - AI-ul nu poate rezolva, propune ticket
 *                             (prioritate MEDIUM implicit).
 *   HIGH_PRIORITY_ESCALATION - la fel, dar prioritate HIGH (bani
 *                             serioși, cont compromis, blocaj
 *                             total) - folosește STRICT enum-ul
 *                             Prisma existent (LOW/MEDIUM/HIGH),
 *                             NU introduce URGENT.
 *
 * Ticketul NU se creează niciodată direct de aici - se construiește
 * doar un DRAFT (subject/category/priority/message), afișat ca
 * pendingAction, iar scrierea reală se face prin endpoint-ul deja
 * existent POST /api/assistant/support/tickets (reutilizat de
 * frontend, prin createSupportTicket() deja existent în
 * Support/supportApi.js) - NU un endpoint nou, NU o rescriere a
 * logicii de creare tichet.
 */

import { openai } from "../lib/openai.js";
import { normalizeSearchText } from "../lib/textRelevance.js";

export const SUPPORT_DECISIONS = {
  RESOLVE_WITH_AI: "RESOLVE_WITH_AI",
  ASK_CLARIFICATION: "ASK_CLARIFICATION",
  OFFER_TICKET: "OFFER_TICKET",
  HIGH_PRIORITY_ESCALATION: "HIGH_PRIORITY_ESCALATION",
};

/*
 * Categoriile de intrare (din classifyCopilotMessage) tratate de
 * acest serviciu.
 */
export const SUPPORT_INTELLIGENCE_CATEGORIES = new Set([
  "ACCOUNT_HELP",
  "ORDER_HELP",
  "PAYMENT_HELP",
  "INCIDENT_OR_BUG",
  "HUMAN_SUPPORT",
]);

/*
 * Maximum 1-2 clarificări - la a treia tură forțăm o decizie
 * finală (nu se mai poate alege ASK_CLARIFICATION din nou).
 */
const MAX_CLARIFICATION_ROUNDS = 2;

const VALID_PRIORITIES = new Set([
  "LOW",
  "MEDIUM",
  "HIGH",
]);

function safeJsonParse(text) {
  let raw = String(text || "").trim();

  raw = raw
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch {
    // încercăm să extragem obiectul JSON
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  return null;
}

/*
 * Confirmare/renunțare determinist (fără LLM) pentru întrebarea
 * "Vrei să o trimit către suport?" - normalizare fără diacritice,
 * reutilizată din knowledgeRetrieval.js/textRelevance.js, nu
 * reinventată aici.
 */
const CONFIRM_WORDS = [
  "da",
  "sigur",
  "confirm",
  "trimite",
  "trimite-l",
  "trimiteti",
  "ok",
  "okay",
  "corect",
  "merge",
];

const DECLINE_WORDS = [
  "nu",
  "renunta",
  "renunt",
  "anuleaza",
  "las-o",
  "las o balta",
  "stop",
  "nu vreau",
];

/*
 * BUGFIX (audit): CONFIRM_WORDS/DECLINE_WORDS conțineau intrări cu
 * cratimă ("las-o", "trimite-l"), dar normalizeSearchText
 * transformă cratima în spațiu ("las-o" -> "las o") - comparația
 * `normalized === word` nu se mai potrivea NICIODATĂ pentru acele
 * intrări, pentru că `word` rămânea cu cratima literală. Rezultat:
 * un răspuns scurt legitim precum "Las-o." (renunțare, fără
 * cuvântul "baltă") nu era recunoscut ca decline. Fix: normalizăm
 * și intrările din liste înainte de comparație, nu doar inputul.
 */
export function detectYesNo(text) {
  const normalized = normalizeSearchText(text);

  if (!normalized) return null;

  for (const word of DECLINE_WORDS) {
    const normalizedWord = normalizeSearchText(word);

    if (
      normalized === normalizedWord ||
      normalized.startsWith(`${normalizedWord} `)
    ) {
      return "no";
    }
  }

  for (const word of CONFIRM_WORDS) {
    const normalizedWord = normalizeSearchText(word);

    if (
      normalized === normalizedWord ||
      normalized.startsWith(`${normalizedWord} `)
    ) {
      return "yes";
    }
  }

  return null;
}

function buildEscalationPrompt({
  category,
  message,
  history,
  audience,
  manifests,
  clarificationRound,
  stepsAttempted,
}) {
  return `
Ești sistemul de triaj al suportului Artfest. Un utilizator cu rolul ${audience} a scris ceva clasificat drept ${category}. Scopul tău este să încerci să rezolvi problema ÎNAINTE să propui un tichet de suport - un tichet e ultima soluție, nu prima.

Cunoștințe relevante despre platformă, dacă există (sursa de adevăr pentru ce e disponibil/indisponibil/planificat):
${JSON.stringify(manifests, null, 2)}

Istoric conversație:
${JSON.stringify(history || [], null, 2)}

Clarificări deja cerute în ACEASTĂ problemă: ${clarificationRound} (maximum 2 permise)
Pași/răspunsuri deja primite de la utilizator:
${JSON.stringify(stepsAttempted || [], null, 2)}

Mesaj curent:
${message}

Alege UNA din deciziile următoare:

- RESOLVE_WITH_AI: poți oferi acum o explicație sau pași concreți utili. Poți da sfaturi tehnice GENERALE și sigure (verifică conexiunea la internet, reîncarcă pagina, verifică formatul/mărimea fișierului, verifică datele cardului, încearcă alt browser) - acestea NU sunt afirmații despre funcționalități Artfest, deci sunt sigure de dat chiar fără confirmare din manifeste. Dacă manifestele arată clar că funcționalitatea cerută nu există/e planificată, spune asta clar (fără ticket - nu e un bug, e o limitare cunoscută).
- ASK_CLARIFICATION: lipsește o informație esențială. Pune O SINGURĂ întrebare clară și scurtă. NU alege asta dacă clarificationRound >= 2 - la a treia tură trebuie deja RESOLVE_WITH_AI sau (dacă tot nu ai suficient) OFFER_TICKET.
- OFFER_TICKET: problema pare reală și tu nu o poți rezolva - bug confirmat sau plauzibil, problemă de plată/comandă care necesită verificare de către o persoană, utilizatorul spune că a încercat deja pașii și tot nu merge, sau categoria e HUMAN_SUPPORT (cerere explicită de suport uman - AICI ÎNTOTDEAUNA alege OFFER_TICKET sau HIGH_PRIORITY_ESCALATION, niciodată RESOLVE_WITH_AI/ASK_CLARIFICATION).
- HIGH_PRIORITY_ESCALATION: la fel ca OFFER_TICKET, dar problema e cu adevărat critică - sumă de bani greșită/taxare dublă/plată către altcineva, cont posibil compromis, blocaj complet al activității (nu poate vinde/cumpăra deloc), incident tehnic major. Folosește RAR, doar când chiar e grav.

Reguli:
- Nu propune ticket pentru o simplă întrebare informativă care are deja răspuns clar în manifeste sau printr-un sfat general sigur.
- category (pentru ticket, dacă alegi OFFER_TICKET/HIGH_PRIORITY_ESCALATION) trebuie să fie una scurtă, în engleză, lowercase: "account", "order", "payment", "bug", sau "general".
- priority (dacă alegi OFFER_TICKET) trebuie să fie "MEDIUM" sau ocazional "LOW" pentru ceva minor; pentru HIGH_PRIORITY_ESCALATION folosește ÎNTOTDEAUNA "HIGH".

Returnează EXCLUSIV JSON valid:
{
  "decision": "RESOLVE_WITH_AI",
  "message": "",
  "steps": [],
  "domain": "",
  "ticketCategory": "general",
  "priority": "MEDIUM",
  "summary": ""
}

Câmpul "summary" - un rezumat de 1-2 propoziții al problemei utilizatorului, în română, folosit ca rezumat AI dacă se ajunge la ticket - completează-l ÎNTOTDEAUNA, indiferent de decizie.
`;
}

/**
 * O tură din fluxul de triaj. NU scrie nimic - doar decide și,
 * dacă decizia e OFFER_TICKET/HIGH_PRIORITY_ESCALATION, întoarce
 * și un DRAFT de tichet (nu creat).
 */
export async function evaluateSupportRequest({
  category,
  message,
  history = [],
  audience,
  manifests = [],
  clarificationRound = 0,
  stepsAttempted = [],
}) {
  /*
   * Determinist: HUMAN_SUPPORT e o cerere explicită - nu încercăm
   * să "rezolvăm" ceva ce userul deja a decis că vrea escaladat la
   * un om. Sărim direct la OFFER_TICKET, fără apel LLM.
   */
  if (category === "HUMAN_SUPPORT") {
    return {
      decision: SUPPORT_DECISIONS.OFFER_TICKET,

      message:
        "Am înțeles - vrei să vorbești direct cu cineva din echipa de suport.",

      steps: [],
      domain: null,
      ticketCategory: "general",
      priority: "MEDIUM",
      summary: message,
    };
  }

  const response = await openai.responses.create({
    model: "gpt-4.1",

    text: { format: { type: "json_object" } },

    input: [
      {
        role: "user",

        content: [
          {
            type: "input_text",

            text: buildEscalationPrompt({
              category,
              message,
              history,
              audience,
              manifests,
              clarificationRound,
              stepsAttempted,
            }),
          },
        ],
      },
    ],
  });

  const parsed = safeJsonParse(response.output_text);

  if (!parsed) {
    return {
      decision: SUPPORT_DECISIONS.OFFER_TICKET,

      message:
        "Nu am putut analiza problema automat. Vrei să o trimit către suport?",

      steps: [],
      domain: null,
      ticketCategory: "general",
      priority: "MEDIUM",
      summary: message,
    };
  }

  const decision = Object.values(
    SUPPORT_DECISIONS
  ).includes(parsed.decision)
    ? parsed.decision
    : SUPPORT_DECISIONS.OFFER_TICKET;

  /*
   * Plasă de siguranță determinist - la a treia tură (0-indexat:
   * clarificationRound ajunge la MAX), nu mai permitem
   * ASK_CLARIFICATION, indiferent ce a ales LLM-ul.
   */
  const safeDecision =
    decision === SUPPORT_DECISIONS.ASK_CLARIFICATION &&
    clarificationRound >= MAX_CLARIFICATION_ROUNDS
      ? SUPPORT_DECISIONS.OFFER_TICKET
      : decision;

  const priority = VALID_PRIORITIES.has(
    String(parsed.priority || "").toUpperCase()
  )
    ? String(parsed.priority).toUpperCase()
    : safeDecision ===
      SUPPORT_DECISIONS.HIGH_PRIORITY_ESCALATION
      ? "HIGH"
      : "MEDIUM";

  return {
    decision: safeDecision,

    message:
      String(parsed.message || "").trim() ||
      "Nu am suficiente informații pentru a răspunde.",

    steps: Array.isArray(parsed.steps)
      ? parsed.steps.slice(0, 6)
      : [],

    domain: parsed.domain
      ? String(parsed.domain).slice(0, 80)
      : null,

    ticketCategory: String(
      parsed.ticketCategory || "general"
    )
      .toLowerCase()
      .slice(0, 40),

    priority,

    summary:
      String(parsed.summary || "").trim() ||
      message,
  };
}

/*
 * BUGFIX (audit): currentPage vine de la frontend în forma NOUĂ
 * {pathname, pageType} (vezi derivePageContext.js) - câmpurile
 * page/route erau shape-ul VECHI, pe care niciun client nu-l mai
 * trimite după etapa PAGE-AWARE COPILOT. Citirea lor aici făcea ca
 * fiecare tichet creat prin fluxul real să arate "Pagina curentă:
 * necunoscută", chiar când pathname-ul era cunoscut și trimis.
 */
function formatCurrentPageForTicket(currentPage) {
  const pathname = currentPage?.pathname;
  const pageType = currentPage?.pageType;
  const legacy = currentPage?.page || currentPage?.route;

  if (pathname && pageType) {
    return `${pathname} (${pageType})`;
  }

  return pathname || legacy || "necunoscută";
}

/*
 * FAZA 8/10.4: context automat, fără schimbare de schemă Prisma -
 * tot ce nu are câmp dedicat pe SupportTicket (rol, domeniu,
 * pagină curentă, pași încercați, entitate din conversationContext)
 * intră într-un rezumat STRUCTURAT în body-ul mesajului, nu într-un
 * câmp nou.
 */
export function buildTicketDraft({
  category,
  ticketCategory,
  priority,
  audience,
  currentPage,
  message,
  stepsAttempted = [],
  summary,
  domain,
  entityType = null,
  entityId = null,
}) {
  const subjectBase =
    summary || message || "Solicitare de suport";

  const subject = subjectBase
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  const stepsText = stepsAttempted.length
    ? stepsAttempted
        .map((step, index) => `${index + 1}. ${step}`)
        .join("\n")
    : "(niciun pas de clarificare - problema a fost clară din primul mesaj)";

  const structuredMessage = `
Rezumat AI: ${summary || "-"}

Rol: ${audience}
Categorie detectată: ${category}
Domeniu: ${domain || "necunoscut"}
Pagina curentă: ${formatCurrentPageForTicket(currentPage)}
${entityType && entityId ? `Entitate legată: ${entityType} (${entityId})` : ""}

Mesajul utilizatorului:
${message}

Pași/clarificări încercate:
${stepsText}
`.trim();

  return {
    subject,
    category: ticketCategory || "general",
    priority: priority || "MEDIUM",
    message: structuredMessage,
  };
}
