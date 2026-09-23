// frontend/src/components/FloatingHub/FloatingHub.jsx
//
// Bula veche a Asistentului, neschimbată ca aspect/dimensiune/drag -
// reutilizează exact mecanismul din `useDraggableLauncher` (extras din
// AiAssistant.jsx: aceeași matematică de clamp, aceeași persistență în
// localStorage). Nu mai crește ea însăși într-un panel - rămâne mereu un
// cerc de 64px, draggable, ACUM pe desktop ȘI pe mobil (pe mobil nu mai
// e ancorată fix jos-dreapta - vezi useDraggableLauncher.js, aceeași
// implementare de drag pe Pointer Events, doar cu prag mai mare pentru
// touch și o cheie de localStorage separată de cea de pe desktop).
//
// La click/tap pe ea, apare o a DOUA bulă (Mesaje) lângă ea - doar UI,
// fără drag propriu, poziționată relativ la bula principală (se mută cu
// ea). Fiecare bulă deschide direct conținutul ei (AiAssistant embedded /
// MiniMessages), fără niciun header/wrapper de tip "Hub" și fără tabs -
// headerul vizibil e cel propriu al componentei ("Asistent Artfest" /
// "Mesaje").
//
// Persistență de stare: panelul (o dată deschis prima dată) rămâne montat
// permanent, doar ascuns cu `hidden` la închidere/comutare - la fel pentru
// fiecare conținut intern (Asistent/Mesaje) - ca să nu se piardă
// conversația AI / thread-ul selectat la redeschidere.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { SparkleIcon } from "../AIAssistant/icons/AssistantIcons.jsx";
import { useUnreadMessagesCount } from "../../features/messages/hooks/useUnreadMessagesCount";
import { prefetchThreads } from "../../features/messages/hooks/messageThreadsCache";
import MiniMessages from "../../features/messages/components/MiniMessages";
import { useDraggableLauncher } from "./useDraggableLauncher";
import { getSafeAreaInsets } from "./safeArea";
import { createAssistantPromptScheduler } from "./assistantPromptScheduler.js";
import styles from "./FloatingHub.module.css";

// Identic cu URL-ul construit de MiniMessages (`apiBase`/`scope=all`) -
// aceeași cheie de cache, ca prefetch-ul de aici să fie exact ce
// citește MiniMessages la montare (cache hit, nu un al doilea URL).
function getThreadsUrl(isVendorRole) {
  return `${isVendorRole ? "/api/inbox" : "/api/user-inbox"}/threads?scope=all`;
}

const AiAssistant = lazy(() => import("../AIAssistant/AiAssistant.jsx"));
const VendorAssistant = lazy(() =>
  import("../AIAssistant/VendorAIAssistant/VendorAssistant.jsx")
);

const COLLAPSED_SIZE = 64;
const BUBBLE_GAP = 10;
const EDGE_PADDING = 12;
const MOBILE_MAX_WIDTH = 480;

// Chei de localStorage separate desktop/mobil - poziția trasă pe
// desktop nu se reutilizează pe mobil, și invers. Cheia de desktop
// rămâne EXACT cea veche ("artfest-assistant-position"), pentru ca o
// poziție salvată de vechea bulă a AiAssistant să fie preluată automat -
// desktop-ul nu se schimbă față de cum era.
const DESKTOP_STORAGE_KEY = "artfest-assistant-position";
const MOBILE_STORAGE_KEY = "artfest-assistant-position-mobile";

/*
 * Speech bubble homepage (redesign 2026) - vezi comentariul din
 * componentă. Mesaj "principal" + 3 alternative, alese la întâmplare -
 * text fix, cerut explicit de business, nu date din API.
 */
const PROMPT_MESSAGES = [
  "Ce cauți? Întreabă-mă orice ✨",
  "Cauți un cadou? Spune-mi bugetul.",
  "Ai o ocazie specială? Te ajut să găsești ceva.",
  "Nu știi ce să alegi? Întreabă-mă.",
  "Spune-mi pentru cine cauți și ce buget ai.",
];
const PROMPT_SESSION_KEY = "artfest-assistant-prompt-shown";
const PROMPT_SHOW_DELAY_MS = 4500;
const PROMPT_VISIBLE_MS = 7000;
const PROMPT_GAP = 12;
const PROMPT_MAX_WIDTH = 260;
// butonul × iese puțin peste colțul boxului (ca pe un toast/bubble
// real) - rezervăm spațiul ăsta la clamp-ul de lățime/poziție, ca să
// nu iasă niciodată din viewport
const PROMPT_DISMISS_OVERHANG = 10;

function getPanelSize(insets) {
  if (typeof window === "undefined") return { width: 380, height: 580 };
  const safe = insets || { top: 0, bottom: 0, left: 0, right: 0 };
  return {
    width: Math.min(380, window.innerWidth - 24 - safe.left - safe.right),
    height: Math.min(580, window.innerHeight - 24 - safe.top - safe.bottom),
  };
}

function getViewportSize() {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

export default function FloatingHub({ me, isVendor, isInfluencer }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { count: unreadCount } = useUnreadMessagesCount();

  // INFLUENCER nu are încă un inbox real - nu inventăm o bulă Mesaje fără
  // endpoint autentic. GUEST vede doar Asistentul.
  const canSeeMessages = me?.role === "USER" || me?.role === "VENDOR";

  // Prefetch discret al listei de threads, după ce `me` e disponibil (deci
  // și după orice re-render cauzat de bootstrap-ul de auth) - programat
  // idle, ca să nu concureze cu primul paint. `prefetchThreads` e
  // deduplicat/cache-uit intern (messageThreadsCache) - dacă useMessageThreads
  // din MiniMessages a apucat deja să pornească același request (ex. user
  // rapid), acesta doar se leagă de aceeași promisiune, nu pornește altul.
  useEffect(() => {
    if (!canSeeMessages || typeof window === "undefined") return undefined;

    const url = getThreadsUrl(isVendor);
    const hasIdleCallback = typeof window.requestIdleCallback === "function";
    const handle = hasIdleCallback
      ? window.requestIdleCallback(() => prefetchThreads(url), { timeout: 2000 })
      : window.setTimeout(() => prefetchThreads(url), 500);

    return () => {
      if (hasIdleCallback) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [canSeeMessages, isVendor]);

  // Prefetch la intenție: la primul semn că userul ar putea deschide
  // bula (hover, focus, sau apăsare - pointerdown acoperă touchstart pe
  // mobil, aceeași cale ca drag-ul) - des mai rapid decât idle prefetch-ul
  // de mai sus. Nu blochează/schimbă comportamentul de drag - doar
  // pornește (sau se leagă de) un fetch în paralel.
  const handleIntentPrefetch = useCallback(() => {
    if (!canSeeMessages) return;
    prefetchThreads(getThreadsUrl(isVendor));
  }, [canSeeMessages, isVendor]);

  const [open, setOpen] = useState(false);
  const [activePanel, setActivePanel] = useState("assistant"); // "assistant" | "messages"
  const [hasOpenedPanelOnce, setHasOpenedPanelOnce] = useState(false);
  const [hasOpenedAssistant, setHasOpenedAssistant] = useState(false);
  const [hasOpenedMessages, setHasOpenedMessages] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [insets, setInsets] = useState(getSafeAreaInsets);
  const [panelSize, setPanelSize] = useState(() => getPanelSize(getSafeAreaInsets()));
  const [viewport, setViewport] = useState(getViewportSize);

  useEffect(() => {
    function onViewportChange() {
      const nextInsets = getSafeAreaInsets();
      setInsets(nextInsets);
      setPanelSize(getPanelSize(nextInsets));
      setViewport(getViewportSize());
    }
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
    };
  }, []);

  // Sub 480px se folosește cheia de poziție de mobil - poziția trasă pe
  // desktop nu se reutilizează aici (și invers).
  const isMobile = viewport.width <= MOBILE_MAX_WIDTH;
  const storageKey = isMobile ? MOBILE_STORAGE_KEY : DESKTOP_STORAGE_KEY;

  useEffect(() => {
    if (open) setHasOpenedPanelOnce(true);
  }, [open]);

  // Deep-link cerere ofertă (?assistant=quote&quoteId=...) - vezi
  // AiAssistant.jsx pentru citirea efectivă a conversației. Aici doar
  // forțăm hub-ul vizibil/montat, indiferent dacă bula a fost deschisă
  // vreodată în sesiunea curentă sau a fost închisă între timp - fără
  // acest efect, AiAssistant putea rămâne nemontat sau ascuns
  // (`hidden`) chiar dacă își seta propriul `isOpen` intern.
  const quoteDeepLinkParams = new URLSearchParams(location.search);
  const isUserQuoteDeepLink =
    quoteDeepLinkParams.get("assistant") === "quote" &&
    Boolean(quoteDeepLinkParams.get("quoteId"));

  useEffect(() => {
    const params = new URLSearchParams(location.search);

    if (params.get("assistant") !== "quote" || !params.get("quoteId")) {
      return;
    }

    setOpen(true);
    setActivePanel("assistant");
    setHasOpenedAssistant(true);
  }, [location.search]);

  // Cerere ofertă / personalizare pornite din pagina de produs sau din
  // profilul magazinului (artfest:personalization-start /
  // artfest:quote-request) - EXACT același bug ca deep-link-ul de mai
  // sus: AiAssistant.jsx ascultă deja aceste evenimente și își
  // populează corect starea internă, dar `setIsOpen(true)` propriu nu
  // are niciun efect când e embedded - vizibilitatea reală e
  // controlată doar de aici. Procesarea payload-ului (event.detail)
  // rămâne exclusiv în AiAssistant.jsx - aici doar deschidem/montăm.
  //
  // `forceUserAssistant`: dacă utilizatorul e VENDOR dar declanșează
  // unul din aceste evenimente ca și cumpărător, vrem experiența de
  // cumpărător (AiAssistant), nu panoul de administrare a magazinului
  // (VendorAssistant, care nu are deloc acest flow). Se resetează
  // automat quand panoul se închide, ca revenirea la bulă să arate
  // din nou comportamentul normal de vendor.
  const [forceUserAssistant, setForceUserAssistant] = useState(false);

  useEffect(() => {
    if (!open) {
      setForceUserAssistant(false);
    }
  }, [open]);

  /*
   * BUGFIX (audit - race event/mount) - `window.dispatchEvent` e
   * SINCRON: rulează doar listenerii deja înregistrați în acel
   * moment, apoi evenimentul dispare definitiv. La primul click
   * (bula niciodată deschisă), `AiAssistant` nu e încă montat, deci
   * `window.addEventListener("artfest:personalization-start", ...)`
   * din AiAssistant.jsx nu există încă - evenimentul de mai jos e
   * singurul care apucă să-l "prindă". De aceea NU mai lăsăm
   * AiAssistant.jsx să asculte evenimentul direct pe `window` -
   * FloatingHub (montat necondiționat, din AppLayout, de la primul
   * render) e singurul listener real, salvează `event.detail` într-un
   * state și îl transmite mai jos ca PROP către AiAssistant - props-
   * urile sunt sincronizate cu ciclul de render al lui React, deci nu
   * mai există nicio fereastră în care payload-ul poate fi pierdut,
   * indiferent de ordinea montare/eveniment. Payload-ul e livrat o
   * singură dată - vezi guard-ul pe referință din AiAssistant.jsx.
   */
  const [
    pendingAssistantEvent,
    setPendingAssistantEvent,
  ] = useState(null);

  const handlePendingAssistantEventHandled =
    useCallback(() => {
      setPendingAssistantEvent(null);
    }, []);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(
      "[PERSONALIZATION DEBUG] hub state APLICAT (post-render)",
      {
        isVendor,
        forceUserAssistant,
        pendingAssistantEvent,
        open,
        activePanel,
        hasOpenedAssistant,
      }
    );
  }, [
    isVendor,
    forceUserAssistant,
    pendingAssistantEvent,
    open,
    activePanel,
    hasOpenedAssistant,
  ]);

  useEffect(() => {
    function openAssistantForBuyerEvent(
      event
    ) {
      // eslint-disable-next-line no-console
      console.log(
        "[PERSONALIZATION DEBUG] FloatingHub received",
        event.type,
        event.detail
      );

      setOpen(true);
      setActivePanel("assistant");
      setHasOpenedAssistant(true);
      setForceUserAssistant(true);

      setPendingAssistantEvent({
        type: event.type,
        detail: event.detail,
      });

      // eslint-disable-next-line no-console
      console.log(
        "[PERSONALIZATION DEBUG] hub state target (valori DINAINTE de re-render, setState e async)",
        {
          isVendor,
          forceUserAssistant,
          pendingAssistantEvent,
          open,
          activePanel,
          hasOpenedAssistant,
        }
      );
    }

    window.addEventListener(
      "artfest:personalization-start",
      openAssistantForBuyerEvent
    );
    window.addEventListener(
      "artfest:quote-request",
      openAssistantForBuyerEvent
    );
    /*
     * Redesign homepage (2026) - "Cumpără după ocazie" și mesajul
     * speech-bubble de lângă bulă (mai jos) deschid Asistentul prin
     * ACELAȘI mecanism ca personalization-start/quote-request de mai
     * sus, doar cu un nume nou de eveniment și un payload liber
     * ({ text } opțional, citit în AiAssistant.jsx - doar precompletează
     * inputul, NU trimite automat mesajul).
     */
    window.addEventListener(
      "artfest:assistant-prompt",
      openAssistantForBuyerEvent
    );

    return () => {
      window.removeEventListener(
        "artfest:personalization-start",
        openAssistantForBuyerEvent
      );
      window.removeEventListener(
        "artfest:quote-request",
        openAssistantForBuyerEvent
      );
      window.removeEventListener(
        "artfest:assistant-prompt",
        openAssistantForBuyerEvent
      );
    };
  }, []);

  const handleAssistantClick = useCallback(() => {
    if (!open) {
      setOpen(true);
      setActivePanel("assistant");
      setHasOpenedAssistant(true);
      return;
    }
    if (activePanel === "assistant") {
      setOpen(false);
      return;
    }
    setActivePanel("assistant");
    setHasOpenedAssistant(true);
  }, [open, activePanel]);

  /*
   * BUGFIX (buton X din AiAssistant/VendorAssistant nu închidea
   * panoul) - `open` de aici e SINGURUL state care controlează
   * vizibilitatea reală a panoului (`hidden={!open}` mai jos).
   * Componentele embedded au propriul `isOpen` intern, dar acela nu
   * mai are niciun efect vizual în modul embedded - X-ul avea nevoie
   * de o cale explicită să anunțe hub-ul. Nu schimbăm `activePanel`
   * (dacă userul redeschide bula, revine la ce avea deschis).
   */
  const handleAssistantClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleMessagesClick = useCallback(() => {
    // bula Mesaje există doar când `open` e deja true, deci aici
    // închiderea/comutarea se raportează mereu la un panel deschis
    if (activePanel === "messages") {
      setOpen(false);
      return;
    }
    setActivePanel("messages");
    setHasOpenedMessages(true);
  }, [activePanel]);

  /*
   * =========================================================
   * SPEECH BUBBLE - invitație spre Asistent, DOAR pe homepage (2026)
   * =========================================================
   *
   * Apare o singură dată automat, la câteva secunde după intrarea pe
   * "/", rămâne vizibilă câteva secunde, apoi dispare singură - fără
   * să reapară obsesiv (sessionStorage: o singură dată per tab/sesiune
   * de navigare, nu la fiecare vizită a homepage-ului). Click -> deschide
   * Asistentul existent, prin ACELAȘI eveniment folosit de "Cumpără
   * după ocazie" (vezi listener-ul de mai sus) - nu duplicăm logica de
   * deschidere.
   */
  const isHomepage = location.pathname === "/";

  const [showPrompt, setShowPrompt] = useState(false);
  const [promptMessage, setPromptMessage] = useState(PROMPT_MESSAGES[0]);

  /*
   * BUGFIX (audit 2026) - scheduler PUR (assistantPromptScheduler.js,
   * testat separat cu node --test), fără nicio stare suplimentară de
   * tip "am încercat deja o dată". Varianta anterioară (un `useRef`
   * separat de sessionStorage) rămânea blocată permanent după o
   * tentativă ÎNTRERUPTĂ (user pleacă de pe homepage sau deschide
   * Asistentul înainte să expire delay-ul) - FloatingHub nu se
   * demontează la navigare (randat din AppLayout.jsx, în afara
   * <Outlet/>), deci acel flag supraviețuia pentru tot restul filei,
   * deși mesajul nu fusese afișat NICIODATĂ (sessionStorage rămânea
   * gol). `sync()` e idempotent - la fiecare schimbare a lui
   * `isHomepage`/`open`, anulează orice timer anterior și decide din
   * nou, strict pe baza stării curente + sessionStorage.
   */
  const promptSchedulerRef = useRef(null);
  if (!promptSchedulerRef.current) {
    promptSchedulerRef.current = createAssistantPromptScheduler({
      delayMs: PROMPT_SHOW_DELAY_MS,
      getAlreadyShown: () => {
        try {
          return (
            window.sessionStorage.getItem(PROMPT_SESSION_KEY) === "1"
          );
        } catch {
          // sessionStorage indisponibil (mod privat etc.) - fără
          // scriere posibilă, deci mesajul s-ar putea reprograma la
          // fiecare navigare în acea filă; acceptabil ca degradare
          // (nu poate deveni "obsesiv" - tot dispare automat).
          return false;
        }
      },
      markShown: () => {
        try {
          window.sessionStorage.setItem(PROMPT_SESSION_KEY, "1");
        } catch {
          // ignorăm - fără sessionStorage, nu putem persista flagul
        }
      },
      onShow: () => {
        setPromptMessage(
          PROMPT_MESSAGES[
            Math.floor(Math.random() * PROMPT_MESSAGES.length)
          ]
        );
        setShowPrompt(true);
      },
    });
  }

  useEffect(() => {
    const scheduler = promptSchedulerRef.current;
    scheduler.sync({ isHomepage, open });
    return () => scheduler.cancel();
  }, [isHomepage, open]);

  useEffect(() => {
    if (!showPrompt) return undefined;

    const hideTimer = window.setTimeout(() => {
      setShowPrompt(false);
    }, PROMPT_VISIBLE_MS);

    return () => window.clearTimeout(hideTimer);
  }, [showPrompt]);

  // dacă panoul se deschide prin orice altă cale (click direct pe
  // bulă, alt eveniment deep-link), ascundem imediat mesajul
  useEffect(() => {
    if (open) setShowPrompt(false);
  }, [open]);

  const dismissPrompt = useCallback((event) => {
    event.stopPropagation();
    setShowPrompt(false);
  }, []);

  const handlePromptClick = useCallback(() => {
    setShowPrompt(false);
    window.dispatchEvent(
      new CustomEvent("artfest:assistant-prompt", { detail: {} })
    );
  }, []);

  const { position, dragHandlers } = useDraggableLauncher({
    storageKey,
    collapsedSize: COLLAPSED_SIZE,
    isOpen: false, // bula ✨ nu-și mai schimbă dimensiunea - rămâne mereu 64x64
    onClick: handleAssistantClick,
  });

  const [prevUnread, setPrevUnread] = useState(unreadCount);
  useEffect(() => {
    if (unreadCount > prevUnread) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 1600);
      setPrevUnread(unreadCount);
      return () => clearTimeout(t);
    }
    if (unreadCount !== prevUnread) setPrevUnread(unreadCount);
  }, [unreadCount, prevUnread]);

  function handleOpenFull() {
    setOpen(false);
    navigate(isVendor ? "/mesaje" : "/cont/mesaje");
  }

  const badgeCount = Math.min(unreadCount, 99);
  const showMsgBubble = open && canSeeMessages;

  // Margini efective = padding de bază + safe-area (notch/home-indicator)
  // pe fiecare parte - la fel ca la clamp-ul bulei ✨ din useDraggableLauncher.
  const padLeft = EDGE_PADDING + insets.left;
  const padRight = EDGE_PADDING + insets.right;
  const padTop = EDGE_PADDING + insets.top;
  const padBottom = EDGE_PADDING + insets.bottom;

  // bula Mesaje: implicit la dreapta bulei principale; dacă nu încape,
  // trece în stânga ei; dacă nici acolo nu încape (ecran foarte îngust),
  // trece deasupra. Se mută mereu cu poziția lui ✨ (aceeași sursă:
  // `position`).
  const msgBubbleFitsRight =
    position.x + COLLAPSED_SIZE + BUBBLE_GAP + COLLAPSED_SIZE <= viewport.width - padRight;
  const msgBubbleFitsLeft = position.x - COLLAPSED_SIZE - BUBBLE_GAP >= padLeft;
  const msgBubbleStacksAbove = showMsgBubble && !msgBubbleFitsRight && !msgBubbleFitsLeft;

  const msgBubbleLeft = showMsgBubble
    ? msgBubbleStacksAbove
      ? position.x
      : msgBubbleFitsRight
        ? position.x + COLLAPSED_SIZE + BUBBLE_GAP
        : position.x - COLLAPSED_SIZE - BUBBLE_GAP
    : position.x;
  const msgBubbleTop = msgBubbleStacksAbove
    ? Math.max(padTop, position.y - COLLAPSED_SIZE - BUBBLE_GAP)
    : position.y;

  const groupRightEdge =
    showMsgBubble && !msgBubbleStacksAbove
      ? Math.max(msgBubbleLeft, position.x) + COLLAPSED_SIZE
      : position.x + COLLAPSED_SIZE;
  const groupTopEdge = msgBubbleStacksAbove ? msgBubbleTop : position.y;

  // panelul: implicit deasupra rândului de bule (loc firesc, launcherul
  // stă de obicei jos); dacă nu încape deasupra, trece dedesubt. Clamp
  // final pe X/Y ca să rămână complet în viewport (incl. safe-area).
  const spaceAbove = groupTopEdge - padTop;
  const panelAbove = spaceAbove >= panelSize.height + BUBBLE_GAP;
  let panelTop = panelAbove
    ? groupTopEdge - panelSize.height - BUBBLE_GAP
    : position.y + COLLAPSED_SIZE + BUBBLE_GAP;
  panelTop = Math.min(
    Math.max(panelTop, padTop),
    Math.max(padTop, viewport.height - panelSize.height - padBottom)
  );

  let panelLeft = groupRightEdge - panelSize.width;
  panelLeft = Math.min(
    Math.max(panelLeft, padLeft),
    Math.max(padLeft, viewport.width - panelSize.width - padRight)
  );

  /*
   * Mesajul speech-bubble - poziționare (2026, ajustare):
   *
   *   1. STÂNGA bulei ✨, centrat vertical pe ea (cazul normal -
   *      bula stă implicit jos-dreapta, deci stânga încape aproape
   *      mereu) - `data-placement="left"`, coada spre dreapta.
   *   2. Dacă nu încape în stânga (bulă trasă spre marginea stângă,
   *      viewport îngust), încearcă DREAPTA - `data-placement="right"`,
   *      coada spre stânga.
   *   3. Dacă nici lateral nu încape, DEASUPRA bulei (fallback final,
   *      util mai ales pe mobil) - `data-placement="above"`, coada
   *      jos, aliniată spre centrul bulei. Dacă nici deasupra nu
   *      încape (bulă lipită de marginea de sus), trece dedesubt.
   *
   * Element decorativ, tranzitoriu (auto-dispare) - o înălțime
   * ESTIMATĂ (nu măsurată din DOM) e suficientă pentru clamp.
   */
  const promptAvailableWidth = Math.max(
    0,
    viewport.width - padLeft - padRight - PROMPT_DISMISS_OVERHANG
  );
  const promptWidth = Math.min(
    PROMPT_MAX_WIDTH,
    Math.max(160, promptAvailableWidth)
  );
  const promptEstimatedHeight = 74;

  const promptFitsLeft =
    position.x - PROMPT_GAP - promptWidth >= padLeft;
  const promptFitsRight =
    position.x + COLLAPSED_SIZE + PROMPT_GAP + promptWidth <=
    viewport.width - padRight;

  const promptPlacement = promptFitsLeft
    ? "left"
    : promptFitsRight
    ? "right"
    : "above";

  let promptLeft;
  let promptTop;
  let promptTailOffset = "50%";

  if (promptPlacement === "left") {
    promptLeft = position.x - PROMPT_GAP - promptWidth;
    promptTop =
      position.y + COLLAPSED_SIZE / 2 - promptEstimatedHeight / 2;
  } else if (promptPlacement === "right") {
    promptLeft = position.x + COLLAPSED_SIZE + PROMPT_GAP;
    promptTop =
      position.y + COLLAPSED_SIZE / 2 - promptEstimatedHeight / 2;
  } else {
    const spaceAboveBubble = position.y - padTop;
    const fitsAbove =
      spaceAboveBubble >= promptEstimatedHeight + PROMPT_GAP;

    promptTop = fitsAbove
      ? position.y - promptEstimatedHeight - PROMPT_GAP
      : position.y + COLLAPSED_SIZE + PROMPT_GAP;

    promptLeft =
      position.x + COLLAPSED_SIZE / 2 - promptWidth / 2;
  }

  promptTop = Math.min(
    Math.max(promptTop, padTop),
    Math.max(padTop, viewport.height - promptEstimatedHeight - padBottom)
  );
  promptLeft = Math.min(
    Math.max(promptLeft, padLeft),
    Math.max(padLeft, viewport.width - promptWidth - padRight)
  );

  if (promptPlacement === "above") {
    // coada rămâne aliniată spre centrul bulei, chiar dacă boxul a
    // fost clamp-uit lateral ca să rămână în viewport
    promptTailOffset = `${Math.min(
      Math.max(
        position.x + COLLAPSED_SIZE / 2 - promptLeft,
        18
      ),
      promptWidth - 18
    )}px`;
  }

  return (
    <>
      {hasOpenedPanelOnce && (
        <div
          className={styles.panel}
          hidden={!open}
          role="dialog"
          aria-label={activePanel === "assistant" ? "Asistent" : "Mesaje"}
          style={{
            left: panelLeft,
            top: panelTop,
            width: panelSize.width,
            height: panelSize.height,
          }}
        >
          {hasOpenedAssistant && (
            <div className={styles.panelContent} hidden={activePanel !== "assistant"}>
              <Suspense fallback={<div className={styles.loading}>Se încarcă…</div>}>
                {isVendor && !isUserQuoteDeepLink && !forceUserAssistant ? (
                  <VendorAssistant
                    embedded
                    onClose={handleAssistantClose}
                  />
                ) : (
                  <AiAssistant
                    embedded
                    isVendor={false}
                    isAuthenticated={Boolean(me)}
                    role={isInfluencer ? "INFLUENCER" : undefined}
                    pendingAssistantEvent={
                      pendingAssistantEvent
                    }
                    onPendingAssistantEventHandled={
                      handlePendingAssistantEventHandled
                    }
                    onClose={handleAssistantClose}
                  />
                )}
              </Suspense>
            </div>
          )}

          {hasOpenedMessages && canSeeMessages && (
            <div className={styles.panelContent} hidden={activePanel !== "messages"}>
              <MiniMessages me={me} onOpenFull={handleOpenFull} />
            </div>
          )}
        </div>
      )}

      {showMsgBubble && (
        <button
          type="button"
          className={styles.msgBubble}
          style={{ left: msgBubbleLeft, top: msgBubbleTop }}
          onClick={handleMessagesClick}
          aria-label="Mesaje"
          aria-pressed={activePanel === "messages"}
        >
          <MessageSquare size={22} />
          {unreadCount > 0 && (
            <span className={styles.bubbleBadge} data-pulse={pulse ? "1" : "0"}>
              {badgeCount}
            </span>
          )}
        </button>
      )}

      {showPrompt && (
        <div
          className={styles.promptWrap}
          data-placement={promptPlacement}
          style={{
            left: promptLeft,
            top: promptTop,
            width: promptWidth,
            "--prompt-tail-offset": promptTailOffset,
          }}
        >
          <button
            type="button"
            className={styles.promptBubble}
            onClick={handlePromptClick}
          >
            <span className={styles.promptSparkle} aria-hidden="true">
              <SparkleIcon size={13} />
            </span>
            <span className={styles.promptText}>{promptMessage}</span>
          </button>

          <button
            type="button"
            className={styles.promptDismiss}
            onClick={dismissPrompt}
            aria-label="Închide mesajul"
          >
            ×
          </button>
        </div>
      )}

      <button
        type="button"
        className={styles.bubble}
        style={{ left: position.x, top: position.y }}
        aria-label="Deschide asistentul"
        aria-pressed={open && activePanel === "assistant"}
        onPointerEnter={handleIntentPrefetch}
        onFocus={handleIntentPrefetch}
        onPointerDown={(event) => {
          handleIntentPrefetch();
          dragHandlers.onPointerDown(event);
        }}
        onPointerMove={dragHandlers.onPointerMove}
        onPointerUp={dragHandlers.onPointerUp}
        onPointerCancel={dragHandlers.onPointerCancel}
      >
        <SparkleIcon size={28} />
        {canSeeMessages && unreadCount > 0 && !showMsgBubble && (
          <span className={styles.bubbleDot} data-pulse={pulse ? "1" : "0"} aria-hidden="true" />
        )}
      </button>
    </>
  );
}
