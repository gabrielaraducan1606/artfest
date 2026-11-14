// src/lib/productImages/useProductImageQueue.js
//
// Hook React peste productImageQueue.js: o coadă per formular, distrusă la
// demontare (upload-urile în curs se opresc, previzualizările se eliberează).
// Implicit: pregătire în browser + POST /api/upload/products.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { prepareProductImage } from "./prepareProductImage.js";
import { createProductImageQueue } from "./productImageQueue.js";
import { uploadProductImage } from "./uploadProductImage.js";

export const defaultProductImageUpload = (file, { onProgress, signal }) =>
  uploadProductImage(file, { onProgress, signal });

/**
 * @param {{ initialUrls?: string[], upload?: Function, prepare?: Function, maxPhotos?: number }} [options]
 *   Opțiunile sunt citite O SINGURĂ dată (la creare); pentru URL-uri noi folosește queue.reset(urls).
 */
export function useProductImageQueue(options = {}) {
  const ref = useRef(null);
  if (!ref.current) {
    ref.current = createProductImageQueue({
      upload: options.upload || defaultProductImageUpload,
      prepare: options.prepare || prepareProductImage,
      maxPhotos: options.maxPhotos,
      initialUrls: options.initialUrls || [],
    });
  }
  const queue = ref.current;
  const destroyTimer = useRef(null);

  // distrugerea e amânată un tick: în StrictMode (dev) React demontează și
  // remontează imediat efectul - coada nu trebuie oprită în acel caz
  useEffect(() => {
    clearTimeout(destroyTimer.current);
    return () => {
      destroyTimer.current = setTimeout(() => queue.destroy(), 0);
    };
  }, [queue]);

  const state = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  return { queue, state };
}

/**
 * Decizia de sincronizare coadă <-> formular (pură, testată):
 * coada are prioritate (o fotografie tocmai încărcată nu se pierde); altfel,
 * o schimbare venită din formular ajunge în coadă.
 * @returns {{ action: "toForm" | "toQueue" | null, syncedKey: string }}
 */
export function decideImagesSync(syncedKey, queueKey, formKey) {
  if (queueKey !== syncedKey) return { action: formKey === queueKey ? null : "toForm", syncedKey: queueKey };
  if (formKey !== syncedKey) return { action: "toQueue", syncedKey: formKey };
  return { action: null, syncedKey };
}

/**
 * Sincronizare în ambele sensuri: coadă <-> lista de imagini a unui formular.
 *  - coada s-a schimbat (fotografie încărcată / eliminată / mutată) -> onQueueUrls(urls);
 *  - formularul s-a schimbat din altă parte (deschidere, ciornă, AI, URL lipit)
 *    -> queue.syncUrls(images): fotografiile încă în lucru NU se opresc.
 * În formular ajung doar URL-uri definitive (niciodată blob: / data: noi).
 */
export function useQueueFormImagesSync({ queue, state, images, onQueueUrls }) {
  const syncedKeyRef = useRef("");
  const onQueueUrlsRef = useRef(onQueueUrls);
  onQueueUrlsRef.current = onQueueUrls;
  const list = Array.isArray(images) ? images : [];
  const listRef = useRef(list);
  listRef.current = list;
  const queueKey = state.urls.join("\n");
  const formKey = list.join("\n");

  useEffect(() => {
    const decision = decideImagesSync(syncedKeyRef.current, queueKey, formKey);
    syncedKeyRef.current = decision.syncedKey;
    if (decision.action === "toForm") onQueueUrlsRef.current?.(queueKey ? queueKey.split("\n") : []);
    else if (decision.action === "toQueue") queue.syncUrls(listRef.current);
  }, [queueKey, formKey, queue]);
}
