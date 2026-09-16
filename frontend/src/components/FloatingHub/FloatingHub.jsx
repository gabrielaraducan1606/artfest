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
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { SparkleIcon } from "../AIAssistant/icons/AssistantIcons.jsx";
import { useUnreadMessagesCount } from "../../features/messages/hooks/useUnreadMessagesCount";
import { prefetchThreads } from "../../features/messages/hooks/messageThreadsCache";
import MiniMessages from "../../features/messages/components/MiniMessages";
import { useDraggableLauncher } from "./useDraggableLauncher";
import { getSafeAreaInsets } from "./safeArea";
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

    return () => {
      window.removeEventListener(
        "artfest:personalization-start",
        openAssistantForBuyerEvent
      );
      window.removeEventListener(
        "artfest:quote-request",
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
