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
