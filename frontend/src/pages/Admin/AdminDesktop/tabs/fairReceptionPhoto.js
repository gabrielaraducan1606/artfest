// src/pages/Admin/AdminDesktop/tabs/fairReceptionPhoto.js
//
// Fotografiile de la recepția Târgului (Admin): aceeași pregătire ca la produse,
// cu limita REALĂ a serverului pentru recepție (10 MB / fișier) verificată în browser.

import { prepareProductImage } from "../../../../lib/productImages/prepareProductImage.js";

// limita REALĂ a serverului pentru o fotografie de recepție (POST /inventory/photos: 10 MB / fișier)
export const RECEPTION_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const RECEPTION_PHOTO_TOO_LARGE =
  "Fotografia are peste 10 MB și nu a putut fi micșorată pe acest dispozitiv. Alege o fotografie mai mică sau fă o captură de ecran a ei (maximum 10 MB).";

/*
 * Aceeași optimizare ca la produse (max 2400 px, JPEG); dacă fișierul care ar pleca
 * depășește tot 10 MB (ex. HEIC pe care browserul nu îl poate micșora), îl refuzăm
 * în browser, cu un mesaj clar, în loc să-l trimitem doar ca să primim 413.
 */
export async function prepareReceptionPhoto(file, options, prepare = prepareProductImage) {
  const result = await prepare(file, options);
  const outgoing = result?.file || file;
  if (!result?.fatalMessage && Number(outgoing?.size) > RECEPTION_PHOTO_MAX_BYTES) {
    return { ...result, file: outgoing, fatalMessage: RECEPTION_PHOTO_TOO_LARGE };
  }
  return result;
}
