// backend/src/services/marketplaceMessageModeration.js

import {
  openai,
} from "../lib/openai.js";

/* =========================================================
   Reguli pentru text
========================================================= */

const EMAIL_REGEX =
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

/*
 * Detectează:
 * - https://site.ro
 * - http://site.ro
 * - www.site.ro
 */
const URL_REGEX =
  /\b(?:https?:\/\/|www\.)[^\s<>()]+/i;

/*
 * Detectează domenii scrise fără protocol:
 * - exemplu.ro
 * - magazin.com
 * - profil.bio
 */
const DOMAIN_REGEX =
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:ro|com|net|org|eu|info|biz|io|co|me|shop|store|online|site|app|dev|link|bio)\b/i;

/*
 * Numere de telefon românești:
 * - 0722 123 456
 * - 0722-123-456
 * - +40 722 123 456
 * - 0040 722 123 456
 * - telefon fix: 021 123 45 67
 */
const ROMANIAN_PHONE_REGEX =
  /(?:\+40|0040|0)[\s().-]*(?:2|3|7)(?:[\s().-]*\d){8}\b/i;

/*
 * Numere internaționale cu prefix +:
 * - +33 6 12 34 56 78
 * - +44 7700 900123
 */
const INTERNATIONAL_PHONE_REGEX =
  /\+\s*\d(?:[\s().-]*\d){7,14}\b/i;

/*
 * Platforme și expresii asociate.
 */
const SOCIAL_REGEX =
  /\b(?:whats?\s*app|instagram|insta|facebook|fb|messenger|telegram|signal|viber|tiktok|tik\s*tok|snapchat|linkedin|youtube|discord)\b/i;

/*
 * Username social:
 * - @numeprofil
 */
const SOCIAL_HANDLE_REGEX =
  /(^|[\s(])@[a-zA-Z0-9._-]{3,}/i;

/*
 * Formulări folosite pentru mutarea conversației
 * în afara platformei.
 */
const CONTACT_REQUEST_REGEX =
  /\b(?:scrie[-\s]?mi|contactează[-\s]?mă|contactati[-\s]?ma|sună[-\s]?mă|suna[-\s]?ma|dă[-\s]?mi numărul|da[-\s]?mi numarul|numărul meu|numarul meu|profilul meu|contul meu|pagina mea|găsește[-\s]?mă|gaseste[-\s]?ma|caută[-\s]?mă|cauta[-\s]?ma|mă găsești|ma gasesti|mă poți găsi|ma poti gasi|numele meu pe|caută după numele|cauta dupa numele|adaugă[-\s]?mă|adauga[-\s]?ma|urmărește[-\s]?mă|urmareste[-\s]?ma|dă[-\s]?mi follow|da[-\s]?mi follow|scrie în privat|scrie-mi în privat|vorbim în privat|vorbim în altă parte|în afara platformei|in afara platformei|plată directă|plata directa|plătește direct|plateste direct)\b/i;

/*
 * Email scris intenționat mascat:
 * - nume [at] gmail [dot] com
 * - nume at gmail dot com
 * - nume arond gmail punct com
 */
const OBFUSCATED_EMAIL_REGEX =
  /\b[a-z0-9._%+-]+\s*(?:\[?\s*at\s*\]?|\(?\s*arond\s*\)?)\s*[a-z0-9.-]+\s*(?:\[?\s*dot\s*\]?|\(?\s*punct\s*\)?)\s*[a-z]{2,}\b/i;

/* =========================================================
   Tipuri și detecții permise
========================================================= */

const ALLOWED_IMAGE_MIME_TYPES =
  new Set([
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
  ]);

const ALLOWED_IMAGE_DETECTIONS =
  new Set([
    "phone_number",
    "email_address",
    "external_url",
    "website_domain",
    "social_media",
    "social_handle",
    "qr_code",
    "business_card",
    "social_profile_screenshot",
    "messaging_app_screenshot",
    "external_contact_information",
  ]);

const ALLOWED_TEXT_DETECTIONS =
  new Set([
    "phone_number",
    "email_address",
    "external_url",
    "website_domain",
    "social_media",
    "social_handle",
    "external_contact_request",
    "off_platform_payment",
    "off_platform_transaction",
    "obfuscated_contact_information",
    "contact_through_name",
  ]);

/* =========================================================
   Helpers
========================================================= */

function normalizeText(
  value
) {
  return String(
    value || ""
  )
    .normalize(
      "NFKC"
    )
    .trim();
}

function containsPhoneNumber(
  value
) {
  if (
    ROMANIAN_PHONE_REGEX.test(
      value
    ) ||
    INTERNATIONAL_PHONE_REGEX.test(
      value
    )
  ) {
    return true;
  }

  /*
   * Detectează și numere scrise cu multe
   * spații sau separatoare.
   *
   * Nu blocăm orice număr lung automat.
   * Cerem fie prefix telefonic, fie context
   * explicit de contact.
   */
  const phoneCandidates =
    value.match(
      /(?:\+|00)?\d(?:[\s().-]*\d){7,14}/g
    ) || [];

  return phoneCandidates.some(
    (
      candidate
    ) => {
      const digits =
        candidate.replace(
          /\D/g,
          ""
        );

      if (
        digits.length < 9 ||
        digits.length > 15
      ) {
        return false;
      }

      const trimmed =
        candidate.trim();

      return (
        trimmed.startsWith(
          "+"
        ) ||
        trimmed.startsWith(
          "00"
        ) ||
        digits.startsWith(
          "40"
        ) ||
        digits.startsWith(
          "0"
        ) ||
        CONTACT_REQUEST_REGEX.test(
          value
        )
      );
    }
  );
}

function safeJsonParse(
  value
) {
  let text =
    String(
      value || ""
    ).trim();

  text = text
    .replace(
      /^```json/i,
      ""
    )
    .replace(
      /^```/i,
      ""
    )
    .replace(
      /```$/i,
      ""
    )
    .trim();

  try {
    return JSON.parse(
      text
    );
  } catch {
    /*
     * Încercăm să extragem primul obiect JSON.
     */
  }

  const start =
    text.indexOf(
      "{"
    );

  const end =
    text.lastIndexOf(
      "}"
    );

  if (
    start >= 0 &&
    end > start
  ) {
    try {
      return JSON.parse(
        text.slice(
          start,
          end + 1
        )
      );
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeConfidence(
  value
) {
  const parsed =
    Number(
      value
    );

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(
      1,
      parsed
    )
  );
}

function normalizeImageDetections(
  value
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map(
          (
            item
          ) =>
            String(
              item || ""
            )
              .trim()
              .toLowerCase()
        )
        .filter(
          (
            item
          ) =>
            item &&
            ALLOWED_IMAGE_DETECTIONS.has(
              item
            )
        )
    )
  ).slice(
    0,
    20
  );
}

function normalizeTextDetections(
  value
) {
  if (
    !Array.isArray(
      value
    )
  ) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map(
          (
            item
          ) =>
            String(
              item || ""
            )
              .trim()
              .toLowerCase()
        )
        .filter(
          (
            item
          ) =>
            item &&
            ALLOWED_TEXT_DETECTIONS.has(
              item
            )
        )
    )
  ).slice(
    0,
    20
  );
}

function bufferToDataUrl({
  buffer,
  mimeType,
}) {
  const normalizedBuffer =
    Buffer.isBuffer(
      buffer
    )
      ? buffer
      : Buffer.from(
          buffer
        );

  const base64 =
    normalizedBuffer.toString(
      "base64"
    );

  return `data:${mimeType};base64,${base64}`;
}

/* =========================================================
   Moderare text cu AI
========================================================= */

async function moderateMarketplaceTextWithAi({
  text,
  senderType,
}) {
  try {
    const response =
      await openai.responses.create({
        model:
          "gpt-4.1",

        text: {
          format: {
            type:
              "json_object",
          },
        },

        input: [
          {
            role:
              "user",

            content: [
              {
                type:
                  "input_text",

                text: `
Analizează următorul mesaj trimis într-un marketplace.

Scopul este prevenirea mutării conversației, plății, comenzii sau tranzacției în afara platformei.

Expeditor:
${senderType || "necunoscut"}

Mesaj:
${text}

BLOCHEAZĂ mesajul dacă încearcă direct sau indirect să transmită ori să solicite:

1. Un număr de telefon.
2. O adresă de email.
3. Un link, website sau domeniu extern.
4. Un cont de social media.
5. Un cont dintr-o aplicație de mesagerie.
6. Un username sau identificator extern.
7. Continuarea conversației în afara platformei.
8. Efectuarea plății sau comenzii în afara platformei.
9. Date de contact mascate, fragmentate sau scrise prin cuvinte.
10. Instrucțiuni suficiente pentru găsirea persoanei sau firmei în afara platformei.

BLOCHEAZĂ formulări precum:

- caută-mă după numele afișat;
- mă găsești după numele meu;
- numele profilului este același;
- caută magazinul pe internet;
- caută după numele firmei;
- scrie-mi în privat;
- vorbim în altă parte;
- putem discuta în afara platformei;
- găsești datele pe ambalaj;
- găsești datele în poză;
- îți trimit o poză cu datele;
- îți spun în mesajul următor;
- plata se poate face direct;
- îți fac un preț mai bun în afara platformei;
- comandă direct de la mine;
- nu mai este nevoie să înregistrăm comanda aici;
- putem evita comisionul platformei;
- trimite-mi datele tale;
- dă-mi o metodă prin care să te contactez;
- lasă-mi datele tale de contact.

BLOCHEAZĂ și încercările mascate:

- cifre scrise în cuvinte;
- număr trimis în mai multe segmente;
- email separat în mai multe fragmente;
- folosirea cuvintelor „arond”, „at”, „punct” sau „dot”;
- username fără simbolul @;
- indicii pentru găsirea profilului după nume;
- indicii pentru găsirea magazinului pe Google;
- solicitarea unei imagini care să conțină contactele;
- solicitarea de a transmite datele în mai multe mesaje;
- propunerea unei plăți prin transfer direct în afara comenzii;
- propunerea evitării platformei sau comisionului.

NU bloca:

- întrebări despre produs;
- dimensiuni;
- cantități;
- culori;
- materiale;
- disponibilitate;
- personalizări;
- prețul discutat în cadrul platformei;
- termenul de realizare;
- nume care trebuie imprimate sau gravate pe produs;
- texte pentru invitații, etichete ori produse personalizate;
- adresa de livrare introdusă prin fluxul oficial al comenzii;
- conversații obișnuite fără intenția mutării tranzacției;
- menționarea unui nume simplu, fără invitație de căutare externă.

Un simplu nume de persoană sau firmă nu este suficient pentru blocare.

Dacă mesajul sugerează însă că persoana sau firma poate fi găsită în afara platformei după acel nume, mesajul trebuie blocat.

Returnează EXCLUSIV JSON valid, fără markdown.

Schema exactă:

{
  "allowed": true,
  "reason": null,
  "detections": [],
  "confidence": 0,
  "explanation": ""
}

Valori permise în detections:

- "phone_number"
- "email_address"
- "external_url"
- "website_domain"
- "social_media"
- "social_handle"
- "external_contact_request"
- "off_platform_payment"
- "off_platform_transaction"
- "obfuscated_contact_information"
- "contact_through_name"

Reguli:

- allowed trebuie să fie false dacă mesajul încearcă să mute comunicarea, plata, comanda sau tranzacția în afara platformei;
- allowed trebuie să fie true numai dacă mesajul este sigur;
- reason trebuie să fie "external_contact_information" pentru mesajele blocate;
- reason trebuie să fie null pentru mesajele permise;
- confidence trebuie să fie între 0 și 1;
- explanation trebuie să fie scurtă și în limba română;
- nu reproduce în explanation telefonul, emailul, linkul sau username-ul detectat.
`,
              },
            ],
          },
        ],
      });

    const parsed =
      safeJsonParse(
        response.output_text
      );

    /*
     * Dacă modelul nu returnează JSON valid,
     * mesajul este blocat.
     */
    if (!parsed) {
      console.error(
        "Marketplace text moderation returned invalid JSON:",
        response.output_text
      );

      return {
        allowed:
          false,

        reason:
          "text_moderation_invalid_response",

        detections:
          [],

        confidence:
          null,

        explanation:
          "",

        senderType:
          senderType ||
          null,
      };
    }

    const detections =
      normalizeTextDetections(
        parsed.detections
      );

    const confidence =
      normalizeConfidence(
        parsed.confidence
      );

    const explanation =
      String(
        parsed.explanation ||
          ""
      )
        .trim()
        .slice(
          0,
          500
        );

    /*
     * Blocăm dacă modelul spune explicit false
     * sau dacă întoarce cel puțin o detecție.
     */
    const blocked =
      parsed.allowed ===
        false ||
      detections.length >
        0;

    if (blocked) {
      return {
        allowed:
          false,

        reason:
          "external_contact_information",

        detections,

        confidence,

        explanation,

        senderType:
          senderType ||
          null,
      };
    }

    /*
     * Acceptăm numai un răspuns explicit true.
     */
    if (
      parsed.allowed !==
      true
    ) {
      return {
        allowed:
          false,

        reason:
          "text_moderation_ambiguous_response",

        detections,

        confidence,

        explanation,

        senderType:
          senderType ||
          null,
      };
    }

    return {
      allowed:
        true,

      reason:
        null,

      detections:
        [],

      confidence,

      explanation,

      senderType:
        senderType ||
        null,
    };
  } catch (
    error
  ) {
    console.error(
      "Marketplace text moderation failed:",
      error
    );

    /*
     * Fail closed:
     * mesajul nu este salvat dacă analiza
     * nu a putut fi realizată.
     */
    return {
      allowed:
        false,

      reason:
        "text_moderation_failed",

      detections:
        [],

      confidence:
        null,

      explanation:
        "",

      senderType:
        senderType ||
        null,
    };
  }
}

/* =========================================================
   Moderare text
========================================================= */

export async function moderateMarketplaceMessage({
  text,
  senderType,
}) {
  const value =
    normalizeText(
      text
    );

  if (!value) {
    return {
      allowed:
        false,

      reason:
        "empty_message",

      detections:
        [],

      confidence:
        null,

      senderType:
        senderType ||
        null,
    };
  }

  /*
   * Nivelul 1:
   * verificări locale rapide.
   */

  if (
    EMAIL_REGEX.test(
      value
    ) ||
    OBFUSCATED_EMAIL_REGEX.test(
      value
    )
  ) {
    return {
      allowed:
        false,

      reason:
        "email_detected",

      detections: [
        "email_address",
      ],

      confidence:
        1,

      senderType:
        senderType ||
        null,
    };
  }

  if (
    URL_REGEX.test(
      value
    ) ||
    DOMAIN_REGEX.test(
      value
    )
  ) {
    return {
      allowed:
        false,

      reason:
        "external_url_detected",

      detections: [
        "external_url",
      ],

      confidence:
        1,

      senderType:
        senderType ||
        null,
    };
  }

  if (
    containsPhoneNumber(
      value
    )
  ) {
    return {
      allowed:
        false,

      reason:
        "phone_detected",

      detections: [
        "phone_number",
      ],

      confidence:
        1,

      senderType:
        senderType ||
        null,
    };
  }

  if (
    SOCIAL_REGEX.test(
      value
    ) ||
    SOCIAL_HANDLE_REGEX.test(
      value
    )
  ) {
    return {
      allowed:
        false,

      reason:
        "social_contact_detected",

      detections: [
        "social_media",
      ],

      confidence:
        1,

      senderType:
        senderType ||
        null,
    };
  }

  if (
    CONTACT_REQUEST_REGEX.test(
      value
    )
  ) {
    return {
      allowed:
        false,

      reason:
        "external_contact_request_detected",

      detections: [
        "external_contact_request",
      ],

      confidence:
        1,

      senderType:
        senderType ||
        null,
    };
  }

  /*
   * Nivelul 2:
   * AI verifică mesajele care au trecut
   * de regulile locale.
   */
  return moderateMarketplaceTextWithAi({
    text:
      value,

    senderType,
  });
}

/* =========================================================
   Moderare imagini cu AI Vision
========================================================= */

export async function moderateMarketplaceImage({
  buffer,
  mimeType,
  filename,
  senderType,
}) {
  if (!buffer) {
    return {
      allowed:
        false,

      reason:
        "missing_image",

      detections:
        [],

      confidence:
        null,

      filename:
        filename ||
        null,

      senderType:
        senderType ||
        null,
    };
  }

  const mime =
    String(
      mimeType || ""
    )
      .trim()
      .toLowerCase();

  if (
    !mime.startsWith(
      "image/"
    )
  ) {
    return {
      allowed:
        false,

      reason:
        "invalid_image_type",

      detections:
        [],

      confidence:
        null,

      filename:
        filename ||
        null,

      senderType:
        senderType ||
        null,
    };
  }

  if (
    !ALLOWED_IMAGE_MIME_TYPES.has(
      mime
    )
  ) {
    return {
      allowed:
        false,

      reason:
        "unsupported_image_type",

      detections:
        [],

      confidence:
        null,

      filename:
        filename ||
        null,

      senderType:
        senderType ||
        null,
    };
  }

  try {
    const imageDataUrl =
      bufferToDataUrl({
        buffer,
        mimeType:
          mime,
      });

    const response =
      await openai.responses.create({
        model:
          "gpt-4.1",

        text: {
          format: {
            type:
              "json_object",
          },
        },

        input: [
          {
            role:
              "user",

            content: [
              {
                type:
                  "input_text",

                text: `
Analizează imaginea înainte ca aceasta să fie trimisă într-o conversație dintr-un marketplace.

Scopul este prevenirea mutării conversației, plății, comenzii sau tranzacției în afara platformei.

Imaginea trebuie blocată dacă observi orice informație care permite contactarea în afara platformei.

BLOCHEAZĂ imaginea dacă detectezi cel puțin unul dintre următoarele:

1. Număr de telefon:
- număr complet;
- număr parțial, dar evident folosit pentru contact;
- număr scris cu spații, puncte, liniuțe sau paranteze;
- număr afișat pe carte de vizită, ambalaj, etichetă ori captură de ecran.

2. Adresă de email:
- adresă completă;
- adresă mascată;
- adresă afișată pe profil, site, carte de vizită sau material promoțional.

3. Link sau adresă externă:
- URL;
- adresă care începe cu www;
- domeniu precum .ro, .com, .net, .org, .eu;
- link vizibil pe un profil, website sau captură de ecran.

4. Platformă socială sau aplicație de mesagerie:
- Instagram;
- Facebook;
- TikTok;
- WhatsApp;
- Telegram;
- Messenger;
- YouTube;
- Snapchat;
- LinkedIn;
- Discord;
- Signal;
- Viber;
- altă platformă de comunicare externă.

5. Username sau identificator:
- @username;
- numele evident al unui profil social;
- captură de ecran a unui profil;
- elemente grafice specifice unei rețele sociale.

6. Cod QR:
- blochează imaginea dacă există orice cod QR vizibil;
- nu este necesar să descifrezi codul.

7. Carte de vizită sau material promoțional care conține date de contact.

8. Captură de ecran din:
- rețea socială;
- aplicație de mesagerie;
- pagină de profil;
- pagină web care conține date de contact.

9. Instrucțiuni vizibile pentru:
- plata directă;
- comandarea în afara platformei;
- evitarea comisionului;
- contactarea directă a vânzătorului sau clientului.

Nu bloca imaginea doar pentru:
- nume obișnuite de persoane;
- texte decorative;
- mesaje de personalizare;
- date calendaristice;
- prețuri;
- cantități;
- dimensiuni;
- numere de comandă;
- coduri interne de produs;
- text care nu reprezintă o metodă de contact;
- nume care trebuie imprimate pe produs.

Dacă un nume este afișat clar ca username, profil sau metodă de contact, imaginea trebuie blocată.

Analizează atât textul vizibil, cât și structura vizuală a imaginii.

Returnează EXCLUSIV JSON valid, fără markdown.

Schema exactă:

{
  "allowed": true,
  "reason": null,
  "detections": [],
  "confidence": 0,
  "explanation": ""
}

Valori permise în detections:

- "phone_number"
- "email_address"
- "external_url"
- "website_domain"
- "social_media"
- "social_handle"
- "qr_code"
- "business_card"
- "social_profile_screenshot"
- "messaging_app_screenshot"
- "external_contact_information"

Reguli pentru răspuns:

- allowed trebuie să fie false dacă există orice element interzis;
- allowed trebuie să fie true numai dacă nu există metode de contact extern;
- reason trebuie să fie "external_contact_information" când imaginea este blocată;
- reason trebuie să fie null când imaginea este permisă;
- confidence trebuie să fie între 0 și 1;
- explanation trebuie să fie scurtă și în limba română;
- nu reproduce în explanation telefonul, emailul, linkul sau username-ul detectat.
`,
              },

              {
                type:
                  "input_image",

                image_url:
                  imageDataUrl,
              },
            ],
          },
        ],
      });

    const parsed =
      safeJsonParse(
        response.output_text
      );

    /*
     * Dacă modelul nu întoarce JSON valid,
     * blocăm imaginea.
     */
    if (!parsed) {
      console.error(
        "Marketplace image moderation returned invalid JSON:",
        response.output_text
      );

      return {
        allowed:
          false,

        reason:
          "image_moderation_invalid_response",

        detections:
          [],

        confidence:
          null,

        explanation:
          "",

        filename:
          filename ||
          null,

        senderType:
          senderType ||
          null,
      };
    }

    const detections =
      normalizeImageDetections(
        parsed.detections
      );

    const confidence =
      normalizeConfidence(
        parsed.confidence
      );

    const explanation =
      String(
        parsed.explanation ||
          ""
      )
        .trim()
        .slice(
          0,
          500
        );

    /*
     * Blocăm dacă:
     * - modelul a spus explicit allowed: false;
     * - sau a returnat cel puțin o detecție interzisă.
     */
    const blocked =
      parsed.allowed ===
        false ||
      detections.length >
        0;

    if (blocked) {
      return {
        allowed:
          false,

        reason:
          "external_contact_information",

        detections,

        confidence,

        explanation,

        filename:
          filename ||
          null,

        senderType:
          senderType ||
          null,
      };
    }

    /*
     * Acceptăm numai răspunsul explicit allowed: true.
     */
    if (
      parsed.allowed !==
      true
    ) {
      return {
        allowed:
          false,

        reason:
          "image_moderation_ambiguous_response",

        detections,

        confidence,

        explanation,

        filename:
          filename ||
          null,

        senderType:
          senderType ||
          null,
      };
    }

    return {
      allowed:
        true,

      reason:
        null,

      detections:
        [],

      confidence,

      explanation,

      filename:
        filename ||
        null,

      senderType:
        senderType ||
        null,
    };
  } catch (
    error
  ) {
    console.error(
      "Marketplace image moderation failed:",
      error
    );

    /*
     * Fail closed:
     * imaginea nu este acceptată dacă analiza
     * nu a putut fi realizată.
     */
    return {
      allowed:
        false,

      reason:
        "image_moderation_failed",

      detections:
        [],

      confidence:
        null,

      explanation:
        "",

      filename:
        filename ||
        null,

      senderType:
        senderType ||
        null,
    };
  }
}