// backend/src/config/artfestFair.js
//
// Târgul de Crăciun Artfest (Buzău) - etapa 1: înscrieri + invitație.
// NU conține inventar / coduri de bare / POS / decont (etape ulterioare).
//
// Rândul ArtfestFair se creează la prima utilizare (upsert pe `key`, doar
// cu valorile de mai jos); datele, locația și versiunea condițiilor se
// completează ulterior în DB - aici nu inventăm date sau text juridic.

export const ARTFEST_FAIR_KEY = "CHRISTMAS_FAIR_BUZAU_2026";

// cheia campaniei de invitație (ArtfestBroadcastDelivery.campaignKey)
export const ARTFEST_FAIR_INVITE_CAMPAIGN_KEY = "CHRISTMAS_FAIR_BUZAU_2026_INVITE";

// invitația separată către vânzătorii cu cont, dar cu magazinul încă neactivat
// (aceeași evidență ArtfestBroadcastDelivery, altă cheie => fără amestec cu invitația principală)
export const ARTFEST_FAIR_ACTIVATION_INVITE_CAMPAIGN_KEY = "CHRISTMAS_FAIR_BUZAU_2026_ACTIVATION_INVITE";

// telefonul de ajutor din invitația de activare (afișare + link tel:)
export const ARTFEST_HELP_PHONE_DISPLAY = "0760 565 147";
export const ARTFEST_HELP_PHONE_TEL = "+40760565147";

export const ARTFEST_FAIR_DEFAULTS = Object.freeze({
  title: "Târgul de Crăciun Artfest – Buzău",
  subtitle: "Artfest iese din online și își întâlnește pentru prima dată publicul.",
  city: "Buzău",
});

// pagina vendorului (link din notificare și din email)
export const ARTFEST_FAIR_VENDOR_PATH = "/vendor/targ-artfest";

export const ARTFEST_FAIR_INVITE_NOTIFICATION = Object.freeze({
  title: "Artfest iese din online 🎄",
  body:
    "Te invităm să participi alături de noi la Târgul de Crăciun Artfest din Buzău. " +
    "Poți participa fizic sau ne poți trimite produsele tale.",
  ctaLabel: "Înscrie-te la târg",
});

export const PARTICIPATION_TYPES = Object.freeze(["PARTICIPARE_FIZICA", "PARTICIPARE_LA_DISTANTA"]);

export const REGISTRATION_STATUSES = Object.freeze(["SUBMITTED", "APPROVED", "REJECTED", "WITHDRAWN", "CANCELLED"]);

// ziua de raportare a târgului (rapoartele zilnice): ziua locală, nu UTC
export const ARTFEST_FAIR_TIMEZONE = "Europe/Bucharest";

// Tranzacțiile târgului (recepție, inventar, înscrieri) fac mai multe interogări
// pe Neon; limita implicită Prisma (5 s, maxWait 2 s) poate fi depășită după o
// pauză (baza „se trezește”), iar tranzacția închisă forțat (P2028) anula
// operația cu 500. Aceleași limite ca la retururi / POS.
export const FAIR_TX_OPTIONS = Object.freeze({ timeout: 30_000, maxWait: 10_000 });

/* ===================== Anulare participare + retur către vendor ===================== */

export const CANCELLATION_CAUSES = Object.freeze(["ARTFEST_DECISION", "VENDOR_REQUEST", "VENDOR_BREACH"]);

// regula afișată Adminului (aplicația NU mută bani și NU modifică decontul)
export const CANCELLATION_RULES = Object.freeze({
  ARTFEST_DECISION: Object.freeze({
    feeRefund: "FULL_IF_PAID",
    feeRuleText: "Taxa de participare se restituie integral, dacă fusese plătită.",
    returnCostPayer: "ARTFEST",
    returnCostText: "Costul returului este suportat de Artfest.",
  }),
  VENDOR_REQUEST: Object.freeze({
    feeRefund: "NONE",
    feeRuleText: "Taxa de participare nu se restituie.",
    returnCostPayer: "VENDOR",
    returnCostText: "Costul returului este suportat de vendor.",
  }),
  VENDOR_BREACH: Object.freeze({
    feeRefund: "NONE",
    feeRuleText: "Taxa de participare nu se restituie.",
    returnCostPayer: "VENDOR",
    returnCostText: "Costul returului este suportat de vendor.",
  }),
});

export const RETURN_REASONS = Object.freeze(["PARTICIPATION_CANCELLED", "FAIR_ENDED_UNSOLD", "RECEPTION_REJECTED"]);
export const RETURN_METHODS = Object.freeze(["PICKUP", "COURIER_BY_ARTFEST", "COURIER_BY_VENDOR"]);
export const RETURN_COST_PAYERS = Object.freeze(["VENDOR", "ARTFEST"]);

// Admin poate confirma primirea în numele vendorului doar după acest interval de la SHIPPED
export const RETURN_ADMIN_CONFIRM_MIN_DAYS = 7;

// motivul blocării de la vânzare pus automat la anulare / recepția doar pentru retur
export const PARTICIPATION_CANCELLED_BLOCK_REASON = "participation_cancelled";

// mesajul implicit pentru vendor la anulare
export const DEFAULT_CANCELLATION_VENDOR_MESSAGE =
  "Participarea ta la Târgul Artfest a fost anulată. Verifică mai jos situația produselor și, dacă ai întrebări, contactează Asistența.";

/* ===================== Inventar (etapa 2) ===================== */

// cod intern: "AF" + 8 caractere; fără 0/O, 1/I/L, U și Y/Z (inversate pe QWERTZ)
export const FAIR_BARCODE_PREFIX = "AF";
export const FAIR_BARCODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWX";
export const FAIR_BARCODE_LENGTH = 8;

// linii care țin produsul legat de târg (rezervare online, preț blocat după termen)
export const ACTIVE_INVENTORY_STATUSES = Object.freeze(["SUBMITTED", "RECEIVED"]);
// linii vizibile în inventar și pentru care se pot genera etichete
export const LABEL_INVENTORY_STATUSES = Object.freeze(["DRAFT", "SUBMITTED", "RECEIVED"]);

export const MAX_DECLARED_QTY = 1000;

// eticheta: 70 × 37 mm; foaia A4: 3 × 8 = 24 etichete
export const LABEL_WIDTH_MM = 70;
export const LABEL_HEIGHT_MM = 37;
export const LABEL_SHEET_COLUMNS = 3;
export const LABEL_SHEET_ROWS = 8;
export const LABEL_SITE_TEXT = "artfest.ro";
