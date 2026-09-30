// src/utils/referralAttributionCapture.js
//
// Logica PURĂ a capturii ?ref= (fără React), comună pentru referral de
// INFLUENCER (components/InfluencerAttributionCapture.jsx) și de VENDOR
// (components/VendorReferralAttributionCapture.jsx) - separată ca să poată fi
// testată determinist. Diferă doar endpoint-ul și forma payload-ului salvat
// (toStorePayload).
//
// Regula de consimțământ (categoria „Atribuire”):
//  - fără consimțământ NU se apelează endpoint-ul de atribuire (care
//    înregistrează InfluencerClick / VendorReferralClick) și NU se salvează token;
//  - dacă vizitatorul încă nu a răspuns la banner, codul `ref` e ținut DOAR
//    în memorie (nu localStorage/cookie) până la evenimentul `cookie:consent`;
//    la attribution=true captura se reia automat;
//  - la refuz / retragere, codul în așteptare e abandonat (fără click, fără
//    token, fără atribuire ulterioară);
//  - un cod e marcat „capturat” DOAR după ce tokenul a fost salvat efectiv;
//  - cel mult un request în curs per cod (fără duplicate la evenimente
//    repetate de consimțământ sau la navigare).

export const COOKIE_CONSENT_EVENT = "cookie:consent";

export function createReferralAttributionCapture({
  requestAttribution, // async ({ referralCode, pageUrl }) => răspunsul endpoint-ului
  storeAttribution, // (payload) => boolean (true = token scris)
  toStorePayload, // (răspuns) => payload pentru storeAttribution
  hasConsent, // () => boolean, consimțământ „Atribuire”
  hasDecision, // () => boolean, a răspuns deja la banner
}) {
  let pending = null; // { referralCode, pageUrl } - doar în memorie
  let capturedRef = "";
  let inFlightRef = "";
  const rejectedRefs = new Set(); // coduri invalide - fără reîncercări

  async function attempt() {
    const current = pending;
    if (!current) return false;
    if (!hasConsent()) return false; // așteptăm consimțământul
    if (inFlightRef === current.referralCode) return false; // fără duplicate

    inFlightRef = current.referralCode;

    try {
      const res = await requestAttribution(current);

      // între timp: alt cod, refuz sau retragere
      if (pending !== current) return false;

      if (!res?.ok || !res?.attributionToken) {
        rejectedRefs.add(current.referralCode);
        pending = null;
        return false;
      }

      const stored = storeAttribution(toStorePayload(res)) === true;

      if (stored) {
        capturedRef = current.referralCode;
        pending = null;
      }

      return stored;
    } catch (error) {
      // cod invalid / promotor inactiv -> terminal, fără reîncercări;
      // eroare de rețea -> rămâne în așteptare (reîncercat la următorul semnal)
      if (error?.status >= 400 && error?.status < 500) {
        rejectedRefs.add(current.referralCode);
        if (pending === current) pending = null;
      }
      return false;
    } finally {
      if (inFlightRef === current.referralCode) inFlightRef = "";
    }
  }

  // apelat la fiecare schimbare de URL
  function handleRef(referralCode, pageUrl = null) {
    const ref = String(referralCode || "").trim();
    if (!ref || ref === capturedRef || rejectedRefs.has(ref)) return Promise.resolve(false);

    // a refuzat deja atribuirea -> nimic de ținut minte
    if (!hasConsent() && hasDecision()) {
      pending = null;
      return Promise.resolve(false);
    }

    if (pending?.referralCode !== ref) {
      pending = { referralCode: ref, pageUrl };
    }

    return attempt();
  }

  // evenimentul `cookie:consent` (detail = consimțământul salvat)
  function handleConsent(detail) {
    const attribution = detail ? detail.attribution === true : hasConsent();

    if (attribution) return attempt();

    // refuz / retragere: abandonăm codul; tokenul local e deja șters de
    // saveConsent (clearAttributionStorage)
    pending = null;
    capturedRef = "";
    return Promise.resolve(false);
  }

  function attach(target) {
    const listener = (event) => {
      handleConsent(event?.detail);
    };

    target.addEventListener(COOKIE_CONSENT_EVENT, listener);
    return () => target.removeEventListener(COOKIE_CONSENT_EVENT, listener);
  }

  return {
    handleRef,
    handleConsent,
    attach,
    // doar pentru teste / diagnostic
    getState: () => ({ pending, capturedRef, inFlightRef }),
  };
}
