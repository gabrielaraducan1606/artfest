// frontend/src/features/messages/hooks/useMessageThreads.js
//
// ETAPA 3 (refactor comun Mesaje) - generalizeaza useThreads() din
// UserMessages.jsx si Vendor/Mesaje/Messages.jsx.
//
// Extins (viteză percepută FloatingHub): în loc să dețină propriul state
// izolat + propriul setInterval de poll, hook-ul citește/scrie acum
// printr-un cache shared la nivel de modul (messageThreadsCache.js),
// cheia fiind chiar URL-ul rezolvat de `buildUrl(dq)`. Contractul extern
// ({ loading, items, error, reload, setItems }) rămâne identic - niciun
// apelant (MiniMessages, UserMessages, Vendor Messages) nu trebuie
// schimbat.
//
// Comportament stale-while-revalidate: la mount, dacă URL-ul are deja o
// intrare în cache (prefetch idle/intenție, sau alt consumator montat pe
// același URL), datele apar instant (loading=false chiar dacă sunt
// stale) și un refresh discret pornește în fundal dacă TTL-ul a expirat;
// fără cache, comportamentul e loading normal, ca înainte.
//
// Poll-ul de 15s e acum UNUL SINGUR per URL (nu unul per componentă
// montată) - vezi messageThreadsCache.js pt. detalii (subscribeThreads).
import { useCallback, useEffect, useState } from "react";
import {
  getCachedEntry,
  requestThreads,
  setCachedItems,
  subscribeThreads,
} from "./messageThreadsCache";

function hasUsableData(entry) {
  return !!entry && (entry.loadedAt > 0 || entry.items.length > 0);
}

export function useMessageThreads({ q, buildUrl }) {
  const [dq, setDq] = useState(q);
  useEffect(() => {
    const id = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  const url = buildUrl(dq);

  const initialEntry = getCachedEntry(url);
  const [items, setItemsState] = useState(initialEntry?.items || []);
  const [loading, setLoading] = useState(!hasUsableData(initialEntry));
  const [error, setError] = useState(initialEntry?.error || null);

  useEffect(() => {
    let active = true;

    const entry = getCachedEntry(url);
    if (hasUsableData(entry)) {
      setItemsState(entry.items);
      setError(entry.error || null);
      setLoading(false);
    } else {
      setItemsState(entry?.items || []);
      setError(entry?.error || null);
      setLoading(true);
    }

    const unsubscribe = subscribeThreads(url, (nextEntry) => {
      if (!active) return;
      setItemsState(nextEntry.items);
      setError(nextEntry.error || null);
      setLoading(false);
    });

    // asigură date proaspete: cache fresh -> no-op; stale -> refresh
    // discret în fundal; fără cache/in-flight deja pornit -> se leagă de
    // el, nu pornește un al doilea request identic.
    requestThreads(url, { force: false });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [url]);

  const reload = useCallback(() => {
    // spinner doar dacă nu avem deja ce arăta (paritate cu comportamentul
    // vechi al lui reload()) - citit imperativ din cache la momentul
    // apelului, nu ca dependență, ca `reload` să rămână stabil per URL
    const entry = getCachedEntry(url);
    setLoading(!entry || entry.items.length === 0);
    setError(null);
    return requestThreads(url, { force: true });
  }, [url]);

  const setItems = useCallback((updater) => setCachedItems(url, updater), [url]);

  return { loading, items, error, reload, setItems };
}
