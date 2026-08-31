// src/components/AIAssistant/Products/assistantProducts.js

import {
  CameraIcon,
  GiftIcon,
  SearchIcon,
  WalletIcon,
} from "./ProductsIcons.jsx";

import {
  normalizeForIntentDetection,
  isExplainIntentMessage,
} from "../explainIntent.js";

/* =========================================================
   Configurare
========================================================= */

const API_BASE =
  "/api/assistant/products";

const BUDGET_OPTIONS = [
  "Sub 100 lei",
  "100–250 lei",
  "250–500 lei",
  "Peste 500 lei",
];

const VISUAL_REFINEMENT_CHOICES =
  new Set([
    "Păstrează culorile",
    "Păstrează stilul",
    "Păstrează categoria",
  ]);

/*
 * BUGFIX (audit): regresie găsită doar pentru VENDOR - "caut un
 * cadou pentru mama"/"idei cadou mama" răspundeau "Nu am suficiente
 * informații sigure" în loc să caute produse. Cauza reală: NU e
 * specifică rolului VENDOR - clasificatorul general
 * (copilotRouter.js) poate clasifica greșit astfel de cereri ca
 * PLATFORM_KNOWLEDGE sau chiar PLATFORM_ACTION pentru ORICE
 * audiență, dar bug-ul era mascat pentru USER/GUEST pentru că
 * AiAssistant.jsx avea un detector local de cuvinte-cheie
 * (detectAssistantIntent) care intercepta aceste mesaje ÎNAINTE să
 * ajungă la backend. VendorAssistant.jsx (widget-ul complet
 * separat, montat DOAR pentru role==="VENDOR" - vezi AppLayout.jsx)
 * nu avea niciun echivalent, deci orice mesaj de-al vendorului
 * ajungea direct la backend și lovea bug-ul de clasificare.
 *
 * Fix pe două planuri: (1) acest detector, extras aici ca să poată
 * fi folosit IDENTIC de ambele widget-uri - capabilities(VENDOR) =
 * capabilities(USER) + vendorCapabilities, nu un search separat;
 * (2) clasificatorul backend a fost întărit separat (vezi
 * copilotRouter.js) ca plasă de siguranță pentru orice formulare pe
 * care acest detector determinist n-o prinde.
 *
 * Aceleași tipare ca detectAssistantIntent din AiAssistant.jsx
 * (căutare/cadou/imagine), verificate DUPĂ EXPLAIN-guard, ca
 * "Cum comand un produs personalizat?" să rămână PLATFORM_KNOWLEDGE,
 * nu product-search.
 *
 * includeGenericProductWords: "produs"/"produse" ca substring
 * singur e sigur pentru AiAssistant.jsx (un client nu are comenzi
 * de gestiune produs care să se confunde), dar e riscant pentru
 * VendorAssistant.jsx - "Ascunde produsul X"/"Arată produsul X" ar
 * fi interceptate greșit ca product-search în loc să ajungă la
 * PLATFORM_ACTION. VendorAssistant.jsx apelează cu false; toate
 * cele 6 formulări de test cerute pentru VENDOR se potrivesc oricum
 * prin alte cuvinte (caut/vreau/gaseste/cadou/lumanare), fără să
 * aibă nevoie de "produs"/"produse".
 */
/*
 * BUGFIX (audit, verificare independentă): "vreau"/"caut" ca
 * declanșator singur e prea larg pentru VendorAssistant.jsx -
 * "Vreau să schimb prețul produsului X" / "Vreau să modific
 * stocul" conțin "vreau" și erau interceptate greșit ca
 * product-search, în loc să ajungă la PLATFORM_ACTION. Forma cu
 * articol hotărât ("produsul"/"produsului"/"prețul"/"stocul") e un
 * semnal puternic că vendorul se referă la o entitate PROPRIE
 * deja deținută, nu la ceva generic de cumpărat - excludem acest
 * caz înainte de a verifica tiparele de căutare, DOAR când
 * includeGenericProductWords===false (contextul vendor; pe
 * widget-ul de client, unde acest parametru rămâne true, cuvintele
 * astea n-ar apărea într-o cerere de cumpărare oricum).
 */
const OWN_ENTITY_ACTION_RE =
  /\b(produsul|produsului|pretul|pretului|stocul|stocului|comanda mea|comenzii mele|costul|costului)\b/;

/*
 * BUGFIX (audit) - două confuzii semantice GENERALE, nu specifice
 * unei fraze, valabile pentru ORICE audiență (nu doar VENDOR):
 *
 * 1. CREATION_INTENT_RE: "adaug/creez/listez UN produs" e o
 *    intenție de CREARE (vendor creation intent), niciodată o
 *    căutare de cumpărat - "Mă poți ajuta să adaug un produs cu
 *    variante?" conținea cuvântul "produs" și era interceptat
 *    greșit ca product-search. Verificat ÎNAINTEA tiparelor de
 *    căutare, indiferent de includeGenericProductWords (un client
 *    care scrie asta nu caută de cumpărat, ci vrea să înceapă să
 *    vândă - trebuie tratat ca PLATFORM_KNOWLEDGE, care explică
 *    apoi corect că e o funcție de vânzător).
 * 2. OWN_VENDOR_DATA_RE: întrebări despre datele PROPRII ale unui
 *    vânzător ("produsele mele", "produse sub cost", "produse fără
 *    costing", "de recalculat", "comenzile mele") NU sunt căutare
 *    de cumpărat - sunt live data despre magazinul cuiva. Pentru un
 *    VENDOR, acestea au deja un flow dedicat (EXISTING_FLOW, prin
 *    backend); pentru un USER/GUEST, mesajul trebuie să ajungă tot
 *    la backend, ca să răspundă corect "funcția e doar pentru
 *    vânzători" - în niciun caz nu trebuie arătate rezultate de
 *    marketplace pentru "Ce produse am sub cost?".
 */
/*
 * BUGFIX (audit) - un preț menționat în text liber ("ceva sub 100
 * lei", "produse până în 100 lei", "cadou sub 100 lei", "ce găsesc
 * cu 100 lei") NU ajungea niciodată la un filtru REAL de preț -
 * runTextSearch/searchByText (backend) aplică doar minPriceCents/
 * maxPriceCents primite explicit ca parametri, niciodată extrase
 * din "query" - iar submitProductMessage nu trimitea niciodată acei
 * parametri. Rezultatul era o căutare semantică simplă, fără
 * garanția reală a pragului de preț cerut. Regex gated pe un cuvânt
 * de prag explicit ("sub"/"pana"/"până"/"maxim"/"max"/"cu") urmat de
 * un număr + "lei"/"ron" - suficient de restrictiv să nu confunde
 * un preț menționat din alt motiv ("produs de 500 lei" fără cuvânt
 * de prag nu se potrivește, intenționat - ambiguu dacă e prag sau
 * doar o mențiune).
 */
const MAX_PRICE_LEI_RE =
  /\b(?:sub|pana(?: in| la)?|până(?: în| la)?|maxim|max|cu)\s+(\d+(?:[.,]\d+)?)\s*(?:lei|ron)\b/i;

export function detectMaxPriceCentsFromText(text = "") {
  const match = MAX_PRICE_LEI_RE.exec(String(text || ""));

  if (!match) return null;

  const lei = Number(match[1].replace(",", "."));

  if (!Number.isFinite(lei) || lei <= 0) return null;

  return Math.round(lei * 100);
}

const CREATION_INTENT_RE =
  /\b(adaug|adauga|creez|creeaza|creaza|listez|listeaza|public|publica)\b[\s\w]{0,25}\bprodus/;

const OWN_VENDOR_DATA_RE =
  /(produsele mele|produsul meu|produse[\s\w]{0,15}\b(sub|peste|fara)\b|comenzile mele|comand[aă]\s+(mea|mele)|comenzi\s+(care|ce)\s+necesit|recalcul|biblioteca de costuri|costuri\s+si\s+profit)/;

/*
 * BUGFIX (raportat manual, doar VENDOR): "Ce recomandări ai pentru
 * mine azi?" era interceptat ca product-search - productSearchRe de
 * mai jos conține "recomanda" ca substring, care se potrivește și
 * cu "recomandari"/"recomand"/"recomanzi" (după diacritice), deci
 * ORICE mesaj cu un cuvânt din familia recomandare/sugestie era
 * tratat ca shopping, indiferent de context.
 *
 * Diferența reală, generalizată (NU pe fraze exacte):
 * recommendationTarget = STORE_OPERATIONS (contul/magazinul propriu
 * al vânzătorului - "ce recomandări ai pentru mine", "ce ar trebui
 * să verific", "cum stă magazinul") vs SHOPPING_ITEM (ceva de
 * CUMPĂRAT - un obiect/cadou/ocazie/destinatar concret, "recomandă-mi
 * un cadou", "ce îmi recomanzi pentru mama", "ce produse îmi
 * recomanzi"). Diferența: SHOPPING_ITEM numește mereu un OBIECT de
 * cumpărat (cadou/produs/ocazie) sau un DESTINATAR concret ("pentru
 * mama"/"pentru nașa" - dar NU "pentru mine", care se referă la
 * vânzătorul însuși, nu la un cadou). Fără niciun obiect de cumpărat
 * numit, un cuvânt de recomandare rămâne STORE_OPERATIONS - lăsăm
 * mesajul să treacă la copilotul server-side (VENDOR_INSIGHTS decide
 * acolo, cu context complet, nu aici cu regex).
 */
const RECOMMENDATION_WORD_RE = /\b(recoman\w*|suger\w*)\b/;

const SHOPPING_OBJECT_RE =
  /\b(cadou\w*|idei\b|ocazi\w*|eveniment|nunta|botez|aniversar\w*|pentru\s+(?!mine\b)\w+|produs\w*)\b/;

export function detectMarketplaceIntent(
  text = "",
  { includeGenericProductWords = true } = {}
) {
  const normalized = normalizeForIntentDetection(text);

  if (!normalized) return null;

  if (isExplainIntentMessage(normalized)) {
    return null;
  }

  if (
    CREATION_INTENT_RE.test(normalized) ||
    OWN_VENDOR_DATA_RE.test(normalized)
  ) {
    return null;
  }

  if (
    !includeGenericProductWords &&
    OWN_ENTITY_ACTION_RE.test(normalized)
  ) {
    return null;
  }

  /*
   * recommendationTarget: doar pentru VENDOR (includeGenericProductWords
   * === false) - un cuvânt de recomandare/sugestie FĂRĂ niciun obiect
   * de cumpărat numit e despre magazinul/contul propriu (STORE_OPERATIONS),
   * nu shopping. Nu schimbăm comportamentul pentru widget-ul de client
   * (AiAssistant.jsx), unde "recomandă-mi ceva" e oricum shopping valid.
   */
  if (!includeGenericProductWords && RECOMMENDATION_WORD_RE.test(normalized)) {
    if (!SHOPPING_OBJECT_RE.test(normalized)) {
      return null;
    }

    /*
     * Are un obiect de cumpărat clar (cadou/ocazie/"produse", ca
     * generic PLURAL de shopping, nu "produsul"/"produsului" definit -
     * acela e deja exclus mai sus de OWN_ENTITY_ACTION_RE) - e
     * shopping real ("ce produse îmi recomanzi?"), chiar dacă
     * productSearchRe de mai jos exclude cuvintele generice de produs
     * pentru vendor (ca să nu confunde "arată produsul X").
     */
    return { type: "product-search" };
  }

  if (
    /(poza|fotografie|imagine)/.test(normalized) &&
    /(gas|caut|similar|asemanator|dupa)/.test(normalized)
  ) {
    return { type: "image-search" };
  }

  const genericWords = includeGenericProductWords
    ? "|produs|produse"
    : "";

  const productSearchRe = new RegExp(
    `(caut|vreau|gaseste|recomanda|cadou|marturie|invitatie|lumanare|bijuterie${genericWords})`
  );

  if (productSearchRe.test(normalized)) {
    return { type: "product-search" };
  }

  return null;
}

export const SHOPPING_ACTIONS = [
  {
    id: "image-search",
    title:
      "Găsește după o fotografie",
    description:
      "Încarcă o imagine și descoperă produse Artfest asemănătoare.",
    icon: CameraIcon,
  },
  {
    id: "product-search",
    title:
      "Caută produsul perfect",
    description:
      "Descrie ce îți dorești folosind cuvinte naturale.",
    icon: SearchIcon,
  },
  {
    id: "gift",
    title:
      "Recomandă-mi un cadou",
    description:
      "Primește sugestii în funcție de persoană, ocazie și buget.",
    icon: GiftIcon,
  },
  {
    id: "budget",
    title:
      "Caută după buget",
    description:
      "Spune cât vrei să cheltuiești și găsim opțiunile potrivite.",
    icon: WalletIcon,
  },
];

/* =========================================================
   Helpers
========================================================= */

function cleanText(
  value,
  maxLength = 1000
) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function getErrorMessage(
  error,
  fallbackMessage
) {
  if (
    error instanceof Error &&
    error.message
  ) {
    return error.message;
  }

  return fallbackMessage;
}

function isBrowserFile(value) {
  return (
    typeof File !== "undefined" &&
    value instanceof File
  );
}

export function isVisualRefinementChoice(
  choice
) {
  return VISUAL_REFINEMENT_CHOICES.has(
    cleanText(choice, 200)
  );
}

/* =========================================================
   Request helper
========================================================= */

async function requestJson(
  url,
  options = {}
) {
  let response;

  try {
    response = await fetch(url, {
      credentials: "include",
      ...options,
    });
  } catch {
    throw new Error(
      "Nu m-am putut conecta la server. Verifică dacă backend-ul rulează."
    );
  }

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";

  let data = null;

  if (
    contentType.includes(
      "application/json"
    )
  ) {
    data = await response
      .json()
      .catch(() => null);
  } else {
    const text = await response
      .text()
      .catch(() => "");

    data = text
      ? { message: text }
      : null;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        "Cererea nu a putut fi procesată."
    );
  }

  return data;
}

/* =========================================================
   Pornire fluxuri
========================================================= */

export function startProductFlow({
  actionId,
  addConversation,
}) {
  switch (actionId) {
    case "image-search":
      addConversation(
        "Vreau să găsesc un produs după o fotografie.",
        "Încarcă fotografia, iar eu voi analiza stilul, culorile, materialele și forma pentru a găsi produse Artfest asemănătoare.",
        {
          type: "image-upload",
        }
      );

      return true;

    case "product-search":
      addConversation(
        "Vreau să caut produsul perfect.",
        "Descrie produsul dorit. Poți menționa categoria, culoarea, materialul, stilul, ocazia, bugetul sau dacă trebuie să fie personalizabil."
      );

      return true;

    case "gift":
      addConversation(
        "Recomandă-mi un cadou.",
        "Pentru cine cauți cadoul?",
        {
          type: "choices",
          choiceStep:
            "gift-recipient",

          choices: [
            "Pentru ea",
            "Pentru el",
            "Pentru un copil",
            "Pentru un cuplu",
            "Altă persoană",
          ],
        }
      );

      return true;

    case "budget":
      addConversation(
        "Vreau produse într-un anumit buget.",
        "Care este bugetul maxim?",
        {
          type: "choices",
          choiceStep:
            "budget-range",
          choices:
            BUDGET_OPTIONS,
        }
      );

      return true;

    default:
      return false;
  }
}

/* =========================================================
   Gestionarea alegerilor
========================================================= */

export async function handleProductChoice({
  activeFlow,
  choice,
  sourceMessage,
  visualSearchId = null,
  addMessage,
  removeMessage,
  createMessage,
}) {
  if (activeFlow === "gift") {
    return handleGiftChoice({
      choice,
      sourceMessage,
      addMessage,
      removeMessage,
      createMessage,
    });
  }

  if (activeFlow === "budget") {
  /*
   * Orice alegere care este un buget valid
   * pornește o căutare nouă.
   */
  if (
    BUDGET_OPTIONS.includes(choice)
  ) {
    await runBudgetSearch({
      budgetLabel: choice,
      addMessage,
      removeMessage,
      createMessage,
    });

    return true;
  }

  /*
   * Reafișăm opțiunile de buget.
   */
  if (
    choice ===
      "Încearcă alt buget" ||
    choice ===
      "Alege alt buget"
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Sigur. Alege noul buget maxim:",
        {
          type: "choices",
          choiceStep:
            "budget-range",
          choices:
            BUDGET_OPTIONS,
        }
      )
    );

    return true;
  }

  /*
   * Rafinăm rezultatele existente,
   * păstrând bugetul selectat.
   */
  if (
    choice ===
    "Arată-mi produse personalizabile"
  ) {
    const searchId =
      sourceMessage?.searchId ||
      null;

    if (!searchId) {
      addMessage(
        createMessage(
          "assistant",
          "Căutarea anterioară nu mai este disponibilă. Alege din nou bugetul.",
          {
            type: "choices",
            choiceStep:
              "budget-range",
            choices:
              BUDGET_OPTIONS,
          }
        )
      );

      return true;
    }

    await runBudgetSearchRefinement({
      searchId,
      instruction:
        "Arată-mi produse personalizabile",
      addMessage,
      removeMessage,
      createMessage,
    });

    return true;
  }

  async function runBudgetSearchRefinement({
  searchId,
  instruction,
  addMessage,
  removeMessage,
  createMessage,
}) {
  if (!searchId) {
    addMessage(
      createMessage(
        "assistant",
        "Căutarea după buget nu mai este disponibilă. Alege din nou bugetul.",
        {
          type: "choices",
          choiceStep:
            "budget-range",
          choices:
            BUDGET_OPTIONS,
        }
      )
    );

    return;
  }

  const loadingId =
    createLoadingMessage({
      addMessage,
      content:
        "Rafinez produsele din bugetul ales...",
    });

  try {
    const result =
      await refineProductSearch({
        searchId,
        instruction,
      });

    removeMessage?.(
      loadingId
    );

    addSearchResultMessage({
      result,
      addMessage,
      createMessage,

      emptyMessage:
        "Nu am găsit produse personalizabile în bugetul ales.",

      successPrefix:
        result.message ||
        "Am păstrat doar produsele personalizabile din bugetul ales.",

      choices: [
        "Încearcă alt buget",
        "Mergi la produse",
      ],
    });
  } catch (error) {
    removeMessage?.(
      loadingId
    );

    addErrorMessage({
      error,
      addMessage,
      createMessage,

      retryChoices: [
        "Încearcă alt buget",
        "Mergi la produse",
      ],
    });
  }
}
  /*
   * Acest buton poate fi tratat separat
   * de componenta care face navigarea.
   */
  if (
    choice ===
    "Mergi la produse"
  ) {
    return false;
  }
}

  if (
    activeFlow ===
      "image-search" &&
    isVisualRefinementChoice(
      choice
    )
  ) {
    await runVisualSearchRefinement({
      searchId:
        visualSearchId ||
        sourceMessage?.searchId ||
        null,

      instruction: choice,
      addMessage,
      removeMessage,
      createMessage,
    });

    return true;
  }
if (
  activeFlow === "product-search"
) {
  const searchId =
    sourceMessage?.searchId ||
    null;

  if (
    choice ===
    "Încearcă altă căutare"
  ) {
    addMessage(
      createMessage(
        "assistant",
        "Sigur. Descrie noul produs pe care îl cauți. Poți menționa categoria, culoarea, materialul, stilul, bugetul sau dacă trebuie să fie personalizabil."
      )
    );

    return true;
  }

  const refinementChoices =
    new Set([
      "Arată-mi variante mai ieftine",
      "Arată-mi produse personalizabile",
    ]);

  if (
    refinementChoices.has(choice)
  ) {
    await runProductSearchRefinement({
      searchId,
      instruction: choice,
      addMessage,
      removeMessage,
      createMessage,
    });

    return true;
  }
}
  return false;
}

async function handleGiftChoice({
  choice,
  sourceMessage,
  addMessage,
  removeMessage,
  createMessage,
}) {
  const step =
    sourceMessage?.choiceStep ||
    "gift-recipient";

  if (step === "gift-recipient") {
    addMessage(
      createMessage(
        "assistant",
        "Pentru ce ocazie este cadoul?",
        {
          type: "choices",
          choiceStep:
            "gift-occasion",

          giftData: {
            recipient: choice,
          },

          choices: [
            "Zi de naștere",
            "Nuntă",
            "Aniversare",
            "Casă nouă",
            "Crăciun",
            "Mulțumire",
            "Altă ocazie",
          ],
        }
      )
    );

    return true;
  }

  if (step === "gift-occasion") {
    addMessage(
      createMessage(
        "assistant",
        "Care este bugetul maxim pentru cadou?",
        {
          type: "choices",
          choiceStep:
            "gift-budget",

          giftData: {
            ...(sourceMessage?.giftData ||
              {}),
            occasion: choice,
          },

          choices:
            BUDGET_OPTIONS,
        }
      )
    );

    return true;
  }

  if (step === "gift-budget") {
    const giftData =
      sourceMessage?.giftData ||
      {};

    await runGiftRecommendations({
      recipient:
        giftData.recipient ||
        "Altă persoană",

      occasion:
        giftData.occasion ||
        "Altă ocazie",

      budgetLabel: choice,

      addMessage,
      removeMessage,
      createMessage,
    });

    return true;
  }

  return false;
}

/* =========================================================
   Submit text din input
========================================================= */

export async function submitProductMessage({
  activeFlow,
  value,
  visualSearchId = null,
  maxPriceCents = null,
  addMessage,
  removeMessage,
  createMessage,
}) {
  const query =
    cleanText(value);

  if (!query) {
    return false;
  }

  if (
    activeFlow ===
    "product-search"
  ) {
    await runTextSearch({
      query,
      maxPriceCents,
      addMessage,
      removeMessage,
      createMessage,
    });

    return true;
  }

  if (
    activeFlow ===
    "image-search"
  ) {
    if (!visualSearchId) {
      addMessage(
        createMessage(
          "assistant",
          "Încarcă mai întâi o fotografie, apoi îmi poți spune ce elemente dorești să păstrăm sau să modificăm.",
          {
            type: "choices",
            choiceStep:
              "visual-search-image-required",

            choices: [
              "Încarcă o fotografie",
            ],
          }
        )
      );

      return true;
    }

    await runVisualSearchRefinement({
      searchId:
        visualSearchId,
      instruction: query,
      addMessage,
      removeMessage,
      createMessage,
    });

    return true;
  }

  if (
    activeFlow === "gift"
  ) {
    return false;
  }

  if (
    activeFlow === "budget"
  ) {
    return false;
  }

  return false;
}

/* =========================================================
   Căutare după fotografie
========================================================= */

export async function searchProductsByImage(
  file
) {
  if (!isBrowserFile(file)) {
    throw new Error(
      "Fotografia selectată nu este validă."
    );
  }

  const allowedTypes =
    new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);

  if (
    !allowedTypes.has(
      file.type
    )
  ) {
    throw new Error(
      "Sunt acceptate doar imagini JPG, PNG sau WEBP."
    );
  }

  if (
    file.size >
    10 * 1024 * 1024
  ) {
    throw new Error(
      "Imaginea este prea mare. Limita este de 10 MB."
    );
  }

  const formData =
    new FormData();

  formData.append(
    "image",
    file
  );

  const data =
    await requestJson(
      `${API_BASE}/search-by-image`,
      {
        method: "POST",
        body: formData,
      }
    );

  return normalizeProductSearchResponse(
    data
  );
}

/*
 * BUGFIX (audit): extras din AiAssistant.jsx (era funcția locală
 * runVisualSearch, coupled la closures) ca să poată fi refolosit
 * IDENTIC de orice widget - VendorAssistant.jsx nu avea deloc acces
 * la image-search-ul de marketplace, doar la Vendor Assistant nu
 * avea (vendorii pierdeau complet capacitatea de căutare vizuală ca
 * buyer). Nu duplicăm search-ul - același searchProductsByImage,
 * același format de mesaj "product-results", un singur loc de
 * întreținut.
 */
export async function runImageSearchFlow({
  file,
  addMessage,
  removeMessage,
  createMessage,
  setVisualSearchId,
}) {
  const loadingId = createLoadingMessage({
    addMessage,
    content:
      "Analizez fotografia și caut produse similare...",
  });

  try {
    const result = await searchProductsByImage(file);

    if (typeof setVisualSearchId === "function") {
      setVisualSearchId(result?.searchId || null);
    }

    removeMessage?.(loadingId);

    if (!result?.products?.length) {
      addMessage(
        createMessage(
          "assistant",
          "Nu am găsit produse suficient de asemănătoare. Poți încerca o altă fotografie sau poți descrie elementele pe care dorești să le păstrăm.",
          {
            type: "choices",
            choiceStep: "visual-search-empty",

            choices: [
              "Păstrează culorile",
              "Păstrează stilul",
              "Păstrează categoria",
              "Încarcă altă fotografie",
            ],
          }
        )
      );

      return;
    }

    const total = Number.isFinite(result.total)
      ? result.total
      : result.products.length;

    addMessage(
      createMessage(
        "assistant",

        `Am găsit ${total} ${
          total === 1
            ? "produs asemănător"
            : "produse asemănătoare"
        }.`,

        {
          type: "product-results",
          searchId: result.searchId || null,
          total,
          products: result.products.slice(0, 3),
          analysis: result.analysis || null,
          filters: result.filters || null,
        }
      )
    );
  } catch (error) {
    removeMessage?.(loadingId);

    addMessage(
      createMessage(
        "assistant",

        error instanceof Error
          ? error.message
          : "A apărut o problemă la analizarea fotografiei.",

        {
          type: "choices",
          choiceStep: "visual-search-error",

          choices: [
            "Încearcă din nou",
            "Încarcă altă fotografie",
          ],
        }
      )
    );
  }
}

/* =========================================================
   Rafinare căutare vizuală
========================================================= */

export async function refineProductSearch({
  searchId,
  instruction,
}) {
  const normalizedSearchId =
    cleanText(searchId, 120);

  const normalizedInstruction =
    cleanText(
      instruction,
      1000
    );

  if (!normalizedSearchId) {
    throw new Error(
      "Căutarea vizuală nu mai este disponibilă. Încarcă fotografia din nou."
    );
  }

  if (
    !normalizedInstruction
  ) {
    throw new Error(
      "Spune ce dorești să păstrăm sau să modificăm în rezultate."
    );
  }

  const data =
    await requestJson(
      `${API_BASE}/refine-search`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          searchId:
            normalizedSearchId,

          instruction:
            normalizedInstruction,
        }),
      }
    );

  return normalizeProductSearchResponse(
    data
  );
}

/* =========================================================
   Căutare textuală
========================================================= */

export async function searchProducts({
  query,
  minPriceCents = null,
  maxPriceCents = null,
  customizableOnly = false,
}) {
  const normalizedQuery =
    cleanText(query);

  if (!normalizedQuery) {
    throw new Error(
      "Descrie produsul pe care îl cauți."
    );
  }

  const data =
    await requestJson(
      `${API_BASE}/search`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          query:
            normalizedQuery,

          minPriceCents,
          maxPriceCents,

          customizableOnly:
            customizableOnly ===
            true,
        }),
      }
    );

  return normalizeProductSearchResponse(
    data
  );
}

/* =========================================================
   Recomandări cadou
========================================================= */

export async function recommendGift({
  recipient,
  occasion,
  budgetLabel,
  minPriceCents = null,
  maxPriceCents = null,
  notes = "",
}) {
  const normalizedRecipient =
    cleanText(recipient, 160);

  const normalizedOccasion =
    cleanText(occasion, 160);

  const normalizedNotes =
    cleanText(notes, 1000);

  if (!normalizedRecipient) {
    throw new Error(
      "Spune pentru cine cauți cadoul."
    );
  }

  if (!normalizedOccasion) {
    throw new Error(
      "Spune pentru ce ocazie este cadoul."
    );
  }

  const data =
    await requestJson(
      `${API_BASE}/gift-recommendations`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          recipient:
            normalizedRecipient,

          occasion:
            normalizedOccasion,

          budgetLabel:
            budgetLabel || null,

          minPriceCents,
          maxPriceCents,

          notes:
            normalizedNotes,
        }),
      }
    );

  return normalizeProductSearchResponse(
    data
  );
}

/* =========================================================
   Căutare după buget
========================================================= */

export async function searchProductsByBudget({
  budgetLabel,
  minPriceCents = null,
  maxPriceCents = null,
  query = "",
  customizableOnly = false,
}) {
  const normalizedQuery =
    cleanText(query);

  const hasBudget =
    Boolean(budgetLabel) ||
    minPriceCents !== null ||
    maxPriceCents !== null;

  if (!hasBudget) {
    throw new Error(
      "Alege un buget sau un interval de preț."
    );
  }

  const data =
    await requestJson(
      `${API_BASE}/search-by-budget`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          budgetLabel:
            budgetLabel || null,

          minPriceCents,
          maxPriceCents,

          query:
            normalizedQuery,

          customizableOnly:
            customizableOnly ===
            true,
        }),
      }
    );

  return normalizeProductSearchResponse(
    data
  );
}

/* =========================================================
   Citirea rezultatelor salvate
========================================================= */

export async function getProductSearchResults({
  searchId,
  page = 1,
  limit = 24,
}) {
  const normalizedSearchId =
    cleanText(searchId, 120);

  if (!normalizedSearchId) {
    throw new Error(
      "Identificatorul căutării lipsește."
    );
  }

  const safePage =
    Number.isFinite(
      Number(page)
    )
      ? Math.max(
          1,
          Math.floor(Number(page))
        )
      : 1;

  const safeLimit =
    Number.isFinite(
      Number(limit)
    )
      ? Math.min(
          60,
          Math.max(
            1,
            Math.floor(
              Number(limit)
            )
          )
        )
      : 24;

  const query =
    new URLSearchParams({
      page:
        String(safePage),

      limit:
        String(safeLimit),
    });

  const data =
    await requestJson(
      `${API_BASE}/visual-search/${encodeURIComponent(
        normalizedSearchId
      )}?${query.toString()}`
    );

  return {
    ...normalizeProductSearchResponse(
      data
    ),

    page:
      Number(data?.page) ||
      safePage,

    limit:
      Number(data?.limit) ||
      safeLimit,

    totalPages:
      Number(
        data?.totalPages
      ) || 1,

    expiresAt:
      data?.expiresAt ||
      null,
  };
}

/* =========================================================
   Execuția căutării textuale
========================================================= */

async function runTextSearch({
  query,
  maxPriceCents = null,
  addMessage,
  removeMessage,
  createMessage,
}) {
  const loadingId =
    createLoadingMessage({
      addMessage,

      content:
        "Caut produsele Artfest care se potrivesc descrierii tale...",
    });

  try {
    const result =
      await searchProducts({
        query,
        maxPriceCents,
      });

    removeMessage?.(
      loadingId
    );

    addSearchResultMessage({
      result,
      addMessage,
      createMessage,

      emptyMessage:
        "Nu am găsit produse care să corespundă descrierii. Încearcă să folosești termeni mai generali.",

      successPrefix:
        "Am găsit produse care se potrivesc cererii tale.",

      choices: [
        "Arată-mi variante mai ieftine",
        "Arată-mi produse personalizabile",
        "Încearcă altă căutare",
      ],
    });
  } catch (error) {
    removeMessage?.(
      loadingId
    );

    addErrorMessage({
      error,
      addMessage,
      createMessage,
      retryChoices: [
        "Încearcă din nou",
        "Mergi la produse",
      ],
    });
  }
}

/*
 * Exportat (audit) - reutilizat direct din AiAssistant.jsx pentru
 * follow-up-uri tastate liber într-o căutare activă ("mai ieftine",
 * "roșii", "sub 50 lei"...), NU doar din click-ul pe butoanele fixe
 * (handleProductChoice, mai jos) - ACEEAȘI funcție, niciun cod
 * duplicat. `instruction` acceptă orice text liber - refineProductSearch
 * (backend, analyzeRefinement) interpretează instrucțiunea prin LLM,
 * nu doar cele 2 fraze fixe ale butoanelor.
 */
export async function runProductSearchRefinement({
  searchId,
  instruction,
  addMessage,
  removeMessage,
  createMessage,
}) {
  if (!searchId) {
    addMessage(
      createMessage(
        "assistant",
        "Căutarea nu mai este disponibilă. Descrie din nou produsul pe care îl cauți."
      )
    );

    return;
  }

  const loadingId =
    createLoadingMessage({
      addMessage,
      content:
        "Rafinez rezultatele...",
    });

  try {
    const result =
      await refineProductSearch({
        searchId,
        instruction,
      });

    removeMessage?.(
      loadingId
    );

    addSearchResultMessage({
      result,
      addMessage,
      createMessage,

      emptyMessage:
        "Nu am găsit produse care să respecte această preferință.",

      successPrefix:
  result.message ||
  (
    instruction ===
    "Arată-mi variante mai ieftine"
      ? "Am ordonat rezultatele de la cele mai accesibile."
      : instruction ===
          "Arată-mi produse personalizabile"
        ? "Am păstrat doar produsele care pot fi personalizate."
        : "Am rafinat rezultatele."
  ),

      choices: [
        "Arată-mi variante mai ieftine",
        "Arată-mi produse personalizabile",
        "Încearcă altă căutare",
      ],
    });
  } catch (error) {
    removeMessage?.(
      loadingId
    );

    addErrorMessage({
      error,
      addMessage,
      createMessage,

      retryChoices: [
        "Încearcă din nou",
        "Încearcă altă căutare",
      ],
    });
  }
}

/* =========================================================
   Execuția rafinării vizuale
========================================================= */

async function runVisualSearchRefinement({
  searchId,
  instruction,
  addMessage,
  removeMessage,
  createMessage,
}) {
  if (!searchId) {
    addMessage(
      createMessage(
        "assistant",
        "Căutarea vizuală nu mai este disponibilă. Încarcă fotografia din nou.",
        {
          type: "choices",
          choiceStep:
            "visual-search-image-required",

          choices: [
            "Încarcă o fotografie",
          ],
        }
      )
    );

    return;
  }

  const loadingId =
    createLoadingMessage({
      addMessage,

      content:
        "Rafinez rezultatele folosind fotografia și indicațiile tale...",
    });

  try {
    const result =
      await refineProductSearch({
        searchId,
        instruction,
      });

    removeMessage?.(
      loadingId
    );

    addSearchResultMessage({
      result,
      addMessage,
      createMessage,

      emptyMessage:
        "Nu am găsit alte produse care să respecte această cerință. Încearcă o formulare mai generală.",

      successPrefix:
        `Am rafinat rezultatele după cerința „${instruction}”.`,

      choices: [
        "Păstrează culorile",
        "Păstrează stilul",
        "Păstrează categoria",
        "Arată-mi variante mai ieftine",
        "Arată-mi produse personalizabile",
        "Încarcă altă fotografie",
      ],
    });
  } catch (error) {
    removeMessage?.(
      loadingId
    );

    addErrorMessage({
      error,
      addMessage,
      createMessage,

      retryChoices: [
        "Încearcă din nou",
        "Încarcă altă fotografie",
      ],
    });
  }
}

/* =========================================================
   Execuția căutării după buget
========================================================= */

async function runBudgetSearch({
  budgetLabel,
  query = "",
  addMessage,
  removeMessage,
  createMessage,
}) {
  const loadingId =
    createLoadingMessage({
      addMessage,

      content:
        "Caut produsele disponibile în bugetul ales...",
    });

  try {
    const result =
      await searchProductsByBudget({
        budgetLabel,
        query,
      });

    removeMessage?.(
      loadingId
    );

    addSearchResultMessage({
      result,
      addMessage,
      createMessage,

      emptyMessage:
        "Nu am găsit momentan produse în acest interval de preț.",

      successPrefix:
        `Am găsit produse în bugetul „${budgetLabel}”.`,

      choices: [
        "Încearcă alt buget",
        "Arată-mi produse personalizabile",
        "Mergi la produse",
      ],
    });
  } catch (error) {
    removeMessage?.(
      loadingId
    );

    addErrorMessage({
      error,
      addMessage,
      createMessage,

      retryChoices: [
        "Încearcă din nou",
        "Alege alt buget",
      ],
    });
  }
}

/* =========================================================
   Execuția recomandărilor de cadouri
========================================================= */

async function runGiftRecommendations({
  recipient,
  occasion,
  budgetLabel,
  notes = "",
  addMessage,
  removeMessage,
  createMessage,
}) {
  const loadingId =
    createLoadingMessage({
      addMessage,

      content:
        "Pregătesc recomandările de cadouri...",
    });

  try {
    const result =
      await recommendGift({
        recipient,
        occasion,
        budgetLabel,
        notes,
      });

    removeMessage?.(
      loadingId
    );

    addSearchResultMessage({
      result,
      addMessage,
      createMessage,

      emptyMessage:
        "Nu am găsit încă recomandări potrivite. Putem încerca un buget sau o ocazie diferită.",

      successPrefix:
        `Am ales câteva idei potrivite pentru ${recipient.toLowerCase()}, pentru ${occasion.toLowerCase()}.`,

      choices: [
        "Arată-mi variante mai ieftine",
        "Vreau ceva personalizabil",
        "Încearcă altă ocazie",
      ],
    });
  } catch (error) {
    removeMessage?.(
      loadingId
    );

    addErrorMessage({
      error,
      addMessage,
      createMessage,

      retryChoices: [
        "Încearcă din nou",
        "Schimbă preferințele",
      ],
    });
  }
}

/* =========================================================
   Mesaje rezultate
========================================================= */

function createLoadingMessage({
  addMessage,
  content,
}) {
  const id =
    `${Date.now()}-products-loading-${Math.random()
      .toString(36)
      .slice(2)}`;

  addMessage({
    id,
    role: "assistant",
    type: "loading",
    content,
  });

  return id;
}

function addSearchResultMessage({
  result,
  addMessage,
  createMessage,
  emptyMessage,
  successPrefix,
  choices = [],
}) {
  const products =
    Array.isArray(
      result?.products
    )
      ? result.products
      : [];

  if (!products.length) {
    addMessage(
      createMessage(
        "assistant",
        emptyMessage,
        {
          type: "choices",

          searchId:
            result?.searchId ||
            null,

          choices:
            choices.length
              ? choices
              : [
                  "Încearcă altă căutare",
                  "Mergi la produse",
                ],
        }
      )
    );

    return;
  }

  const total =
    Number.isFinite(
      Number(result?.total)
    )
      ? Number(result.total)
      : products.length;

  addMessage(
    createMessage(
      "assistant",
      `${successPrefix} ${
        total === 1
          ? "Am găsit 1 rezultat."
          : `Am găsit ${total} rezultate.`
      }`,
      {
        type:
          "product-results",

        searchId:
          result?.searchId ||
          null,

        total,

        products:
          products.slice(0, 3),

        analysis:
          result?.analysis ||
          null,

        filters:
          result?.filters ||
          null,

        choices,
      }
    )
  );
}

function addErrorMessage({
  error,
  addMessage,
  createMessage,
  retryChoices = [
    "Încearcă din nou",
    "Mergi la produse",
  ],
}) {
  addMessage(
    createMessage(
      "assistant",
      getErrorMessage(
        error,
        "A apărut o problemă la căutarea produselor."
      ),
      {
        type: "choices",
        choices:
          retryChoices,
      }
    )
  );
}

/* =========================================================
   Normalizare răspuns
========================================================= */

function normalizeProductSearchResponse(
  data
) {
  const rawProducts =
    Array.isArray(
      data?.products
    )
      ? data.products
      : Array.isArray(
            data?.results
          )
        ? data.results
        : Array.isArray(
              data?.items
            )
          ? data.items
          : [];

  const products =
    rawProducts
      .map(normalizeProduct)
      .filter(
        (product) =>
          Boolean(product.id)
      );

  const parsedTotal =
    Number(data?.total);

return {
  searchId:
    data?.searchId ||
    data?.visualSearchId ||
    null,

  type:
    data?.type ||
    null,

  query:
    data?.query ||
    "",

  message:
    cleanText(
      data?.message,
      1000
    ),

  total:
    Number.isFinite(
      parsedTotal
    )
      ? parsedTotal
      : products.length,

  analysis:
    data?.analysis ||
    null,

  filters:
    data?.filters ||
    null,

  products,
};
}

function normalizeProduct(product) {
  const images =
    normalizeImages(
      product?.images
    );

  return {
    /*
     * Păstrăm toate câmpurile originale.
     * Sunt necesare pe ProductsPage și în ProductCard:
     * stoc, disponibilitate, vendor, service,
     * moderare, status activ etc.
     */
    ...product,

    id: String(
      product?.id ||
        product?.productId ||
        ""
    ),

    slug:
      product?.slug ||
      product?.handle ||
      null,

    title:
      product?.title ||
      product?.name ||
      "Produs Artfest",

    description:
      product?.description ||
      null,

    imageUrl:
      product?.imageUrl ||
      product?.image ||
      images[0]?.url ||
      images[0] ||
      "",

    images,

    priceCents:
      normalizePriceCents(
        product
      ),

    currency:
      product?.currency ||
      "RON",

    category:
      normalizeNamedValue(
        product?.category
      ),

    color:
      normalizeNamedValue(
        product?.color
      ),

    materialMain:
      normalizeNamedValue(
        product?.materialMain
      ),

    technique:
      normalizeNamedValue(
        product?.technique
      ),

    availability:
      product?.availability ||
      null,

    orderMode:
      product?.orderMode ||
      null,

    acceptsCustom:
      product?.acceptsCustom ===
        true ||
      product?.customizable ===
        true,

    similarity:
      normalizeSimilarity(
        product
      ),
  };
}

function normalizeImages(
  images
) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map((image) => {
      if (
        typeof image ===
        "string"
      ) {
        return image;
      }

      if (
        image &&
        typeof image ===
          "object"
      ) {
        return {
          ...image,
          url:
            image.url ||
            image.src ||
            image.imageUrl ||
            "",
        };
      }

      return null;
    })
    .filter(Boolean);
}

function normalizeNamedValue(
  value
) {
  if (
    typeof value ===
    "string"
  ) {
    return value;
  }

  if (
    value &&
    typeof value ===
      "object"
  ) {
    return (
      value.name ||
      value.title ||
      value.label ||
      null
    );
  }

  return null;
}

function normalizeSimilarity(
  product
) {
  const value =
    product?.similarity ??
    product?.score ??
    product?.relevanceScore ??
    null;

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function normalizePriceCents(
  product
) {
  const priceCents =
    Number(
      product?.priceCents
    );

  if (
    Number.isFinite(
      priceCents
    ) &&
    priceCents >= 0
  ) {
    return Math.round(
      priceCents
    );
  }

  const price =
    Number(product?.price);

  if (
    Number.isFinite(price) &&
    price >= 0
  ) {
    return Math.round(
      price * 100
    );
  }

  return 0;
}

/* =========================================================
   Mesaje auxiliare
========================================================= */

export function getProductTemporaryResponse(
  activeFlow
) {
  switch (activeFlow) {
    case "gift":
      return "Poți adăuga și alte preferințe despre persoana care va primi cadoul.";

    case "budget":
      return "Poți descrie și tipul de produs dorit pentru a rafina rezultatele.";

    default:
      return null;
  }
}

export function getProductImageUploadResponse(
  activeFlow
) {
  if (
    activeFlow ===
    "image-search"
  ) {
    return "Analizez fotografia și caut produse similare...";
  }

  return null;
}

export function getProductInputPlaceholder(
  activeFlow
) {
  switch (activeFlow) {
    case "image-search":
      return "Ex: păstrează culorile, dar caută un stil mai minimalist...";

    case "product-search":
      return "Ex: vază ceramică bej, stil minimalist, sub 200 lei...";

    case "gift":
      return "Adaugă preferințe opționale...";

    case "budget":
      return "Descrie tipul de produs dorit...";

    default:
      return null;
  }
}