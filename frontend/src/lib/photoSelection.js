// src/lib/photoSelection.js
//
// Selecția COMUNĂ de fotografii pentru formularele care NU sunt de produs
// (recenzii, retururi, recepție Târg ...): o nouă selecție se ADAUGĂ la cele
// existente, duplicatele accidentale (același fișier ales de două ori) sunt
// sărite, limita SECȚIUNII se respectă, iar fiecare fișier refuzat primește un
// motiv clar în română. Fără upload: fiecare formular își păstrează ruta, limitele
// de mărime și formatele proprii (validările de securitate rămân pe server).
// Formularele de produs folosesc coada din lib/productImages (procesare + retry).

import { fileFingerprint } from "./productImages/productImageRules.js";

export { fileFingerprint };

/**
 * @param {{
 *   existingCount?: number,          // fotografii deja în formular (încărcate sau alese)
 *   existingFingerprints?: Iterable<string>,
 *   incoming: Iterable<File>,
 *   max: number,                     // limita secțiunii
 *   accept?: (file: File) => boolean, // formatul acceptat de secțiune
 *   acceptMessage?: string,          // motivul pentru formatul refuzat
 *   maxBytes?: number,               // mărimea maximă a secțiunii (opțional)
 * }} options
 * @returns {{ accepted: File[], rejected: { name: string, message: string }[], fingerprints: string[] }}
 */
export function selectPhotos({
  existingCount = 0,
  existingFingerprints = [],
  incoming,
  max,
  accept = (file) => /^image\//i.test(String(file?.type || "")),
  acceptMessage = "nu este o fotografie",
  maxBytes = 0,
}) {
  const seen = new Set(existingFingerprints);
  const accepted = [];
  const fingerprints = [];
  const rejected = [];
  let overLimit = 0;
  let room = Math.max(0, Number(max) - Number(existingCount || 0));

  for (const file of Array.from(incoming || []).filter(Boolean)) {
    const name = String(file.name || "fotografia");
    const fingerprint = fileFingerprint(file);
    if (seen.has(fingerprint)) {
      rejected.push({ name, message: `„${name}” este deja adăugată.` });
      continue;
    }
    if (!accept(file)) {
      rejected.push({ name, message: `„${name}” ${acceptMessage}.` });
      continue;
    }
    if (maxBytes > 0 && Number(file.size) > maxBytes) {
      rejected.push({ name, message: `„${name}” depășește ${Math.round(maxBytes / (1024 * 1024))} MB.` });
      continue;
    }
    if (room <= 0) {
      overLimit += 1;
      continue;
    }
    seen.add(fingerprint);
    accepted.push(file);
    fingerprints.push(fingerprint);
    room -= 1;
  }

  if (overLimit) {
    rejected.push({
      name: "",
      message:
        overLimit === 1
          ? `Poți adăuga cel mult ${max} fotografii - o fotografie nu a fost adăugată.`
          : `Poți adăuga cel mult ${max} fotografii - ${overLimit} fotografii nu au fost adăugate.`,
    });
  }

  return { accepted, rejected, fingerprints };
}

/** Mesajele refuzurilor, pe rânduri (pentru zona de eroare a formularului). */
export function selectionMessage(rejected) {
  return (rejected || []).map((entry) => entry.message).join("\n");
}
