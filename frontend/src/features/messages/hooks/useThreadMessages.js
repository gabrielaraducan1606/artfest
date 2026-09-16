// frontend/src/features/messages/hooks/useThreadMessages.js
//
// ETAPA 3: generalizeaza useMessages(threadId) din UserMessages.jsx si
// Vendor/Mesaje/Messages.jsx.
//
// ETAPA 4 (paginare thread + load older).
//
// Extins (viteză percepută deschidere conversație în MiniMessages): la fel
// ca useMessageThreads, hook-ul nu mai deține propriul state izolat +
// propriul fetch necondiționat la fiecare mount - citește/scrie printr-un
// cache shared la nivel de modul (threadMessagesCache.js), cheia fiind
// `buildEndpoint(threadId)`. Contractul extern rămâne identic - niciun
// apelant (MiniThread, UserMessages, Vendor Messages) nu trebuie schimbat.
//
// Ce s-a mutat în threadMessagesCache.js (vezi comentariile de-acolo):
//  - reload() -> `reloadThreadLatest` (GET complet, ÎNLOCUIEȘTE - păstrat
//    identic, esențial pt. swap-ul mesaj-optimist -> mesaj-real după send)
//  - poll (8s, neschimbat) -> `ensureFreshLatest` (GET doar mesaje noi,
//    APPEND) + `markThreadRead`, orchestrate acum de `subscribeThread`
//    (UN SINGUR poll per thread, chiar dacă thread-ul e deschis simultan
//    în MiniThread ȘI pe pagina completă)
//  - loadOlder() -> `loadOlderThreadPage` (guard separat, scrie în cache)
//  - "protecție la switch rapid de thread" - acum emergentă din design:
//    fiecare cache e ținut per `base` (deci per thread), iar hook-ul se
//    dezabonează de la vechiul `base` înainte să se abonează la cel nou -
//    un răspuns întârziat pt. threadul părăsit tot ajunge să actualizeze
//    cache-ul LUI (util - dacă userul revine la el, găsește date proaspete),
//    dar nu mai poate ajunge la state-ul local al hook-ului curent (nu mai
//    ascultă acel `base`).
//
// Prefetch (hover pe rândul conversației, sau primul thread cu unread /
// cel mai recent) foloseşte direct `prefetchThreadMessages` din
// threadMessagesCache.js - NU trece prin acest hook (hook-ul reprezintă o
// vizualizare reală -> declanșează și markThreadRead; prefetch-ul nu are
// voie să facă asta, ar strica badge-urile de unread).
import { useCallback, useEffect, useState } from "react";
import {
  getEntry,
  loadOlderThreadPage,
  reloadThreadLatest,
  setThreadItems,
  subscribeThread,
} from "./threadMessagesCache";

function hasUsableData(entry) {
  return !!entry && (entry.loadedAt > 0 || entry.items.length > 0);
}

const EMPTY_ENTRY = {
  items: [],
  hasMoreOlder: false,
  threadMeta: null,
  quoteRequest: null,
  peerLastReadAt: null,
  error: null,
};

export function useThreadMessages(
  threadId,
  { buildEndpoint, includeQuoteRequest = true, pageSize = 50 }
) {
  const base = threadId ? buildEndpoint(threadId) : null;

  const initialEntry = base ? getEntry(base) : null;
  const [msgs, setMsgsState] = useState(initialEntry?.items || []);
  const [loading, setLoading] = useState(!!threadId && !hasUsableData(initialEntry));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(initialEntry?.hasMoreOlder || false);
  const [error, setError] = useState(initialEntry?.error || null);
  const [threadMeta, setThreadMeta] = useState(initialEntry?.threadMeta || null);
  const [quoteRequest, setQuoteRequest] = useState(
    includeQuoteRequest ? initialEntry?.quoteRequest || null : null
  );
  const [peerLastReadAt, setPeerLastReadAt] = useState(initialEntry?.peerLastReadAt || null);

  const applyEntry = useCallback(
    (entry) => {
      const e = entry || EMPTY_ENTRY;
      setMsgsState(e.items);
      setHasMoreOlder(!!e.hasMoreOlder);
      setThreadMeta(e.threadMeta);
      setQuoteRequest(includeQuoteRequest ? e.quoteRequest : null);
      setPeerLastReadAt(e.peerLastReadAt);
      setError(e.error || null);
    },
    [includeQuoteRequest]
  );

  useEffect(() => {
    if (!threadId || !base) {
      applyEntry(null);
      setLoading(false);
      return undefined;
    }

    let active = true;

    const entry = getEntry(base);
    if (hasUsableData(entry)) {
      applyEntry(entry);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const unsubscribe = subscribeThread(
      base,
      (nextEntry) => {
        if (!active) return;
        applyEntry(nextEntry);
        setLoading(false);
      },
      { pageSize }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [threadId, base, pageSize, applyEntry]);

  // read-ticks: recalculează readByPeer pe mesajele "ale mele" deja
  // încărcate ori de câte ori peerLastReadAt avansează, fără alt fetch.
  // Scrie prin cache (setMsgs = write-through), la fel ca înainte local.
  useEffect(() => {
    if (!peerLastReadAt || !base) return;
    const cutoff = new Date(peerLastReadAt).getTime();
    if (!Number.isFinite(cutoff)) return;

    setThreadItems(base, (prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (m.from !== "me" || m.pending || m.failed) return m;
        const shouldBeRead = new Date(m.createdAt).getTime() <= cutoff;
        if (shouldBeRead === !!m.readByPeer) return m;
        changed = true;
        return { ...m, readByPeer: shouldBeRead };
      });
      return changed ? next : prev;
    });
  }, [peerLastReadAt, base]);

  const reload = useCallback(async () => {
    if (!threadId || !base) return;
    setError(null);
    await reloadThreadLatest(base, { pageSize });
  }, [threadId, base, pageSize]);

  const loadOlder = useCallback(async () => {
    if (!threadId || !base) return { appended: 0 };
    setLoadingOlder(true);
    try {
      return await loadOlderThreadPage(base, { pageSize });
    } finally {
      setLoadingOlder(false);
    }
  }, [threadId, base, pageSize]);

  const setMsgs = useCallback((updater) => base && setThreadItems(base, updater), [base]);

  return {
    loading,
    loadingOlder,
    hasMoreOlder,
    msgs,
    error,
    setMsgs,
    reload,
    loadOlder,
    threadMeta,
    quoteRequest,
  };
}
