// src/features/creators/creatorsClient.js
//
// Artfest Creators - hook-ul de stare + utilitare fără componente (separat de
// creatorsShared.jsx, ca fast refresh să funcționeze: acolo doar componente).

import { useCallback, useEffect, useState } from "react";

import { api } from "../../lib/api";
import { prepareProductImage } from "../../lib/productImages/prepareProductImage.js";
import { sniffImageKind } from "../../lib/productImages/productImageRules.js";
import { CREATORS_API, friendlyError } from "./creatorsLogic.js";

export const cx = (...xs) => xs.filter(Boolean).join(" ");

export const labelOf = (list, value) => list?.find((o) => o.value === value)?.label || value;

/* ---------------- starea + opțiunile ---------------- */

export function useCreatorState() {
  const [state, setState] = useState(null);
  const [options, setOptions] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setError("");
    try {
      const [next, opts] = await Promise.all([api(`${CREATORS_API}/state`), options ? Promise.resolve(options) : api(`${CREATORS_API}/options`)]);
      setState(next);
      setOptions(opts);
      return next;
    } catch (e) {
      setError(friendlyError(e, "Nu am putut încărca profilul Creators. Reîncarcă pagina."));
      return null;
    } finally {
      setLoading(false);
    }
  }, [options]);

  useEffect(() => {
    reload();
    // o singură încărcare la montare; reload() e apelat explicit după acțiuni
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, setState, options, error, loading, reload };
}

/* ---------------- încărcare fotografie ---------------- */

/*
 * Aceeași pregătire ca fotografiile de produs (redimensionare în browser, HEIC
 * convertit) + POST /api/creator/uploads. Întoarce URL-ul public al fotografiei.
 */
export async function uploadCreatorImage(file) {
  let kind = null;
  try {
    kind = sniffImageKind(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
  } catch {
    kind = null;
  }
  if (!kind) throw Object.assign(new Error("invalid"), { data: { message: "Fișierul ales nu este o fotografie (JPG, PNG, WebP sau HEIC)." } });
  const prepared = await prepareProductImage(file, { kind }).catch(() => ({ file }));
  const form = new FormData();
  const upload = prepared?.file || file;
  form.append("file", upload, upload.name || "foto.jpg");
  const res = await api(`${CREATORS_API}/uploads`, { method: "POST", body: form });
  return res.url;
}
