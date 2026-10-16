// src/pages/Vendor/Fair/artfestFair.js
//
// Târgul de Crăciun Artfest - etichete, apeluri API și hook-ul comun
// folosit de pagină și de CTA-urile din Dashboard / Comenzi (o singură
// sursă de adevăr pentru starea înscrierii).

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api";

export const FAIR_API = "/api/vendor/artfest-fair";

export const FAIR_TITLE = "Târgul de Crăciun Artfest – Buzău";

export const PARTICIPATION_OPTIONS = [
  {
    value: "PARTICIPARE_FIZICA",
    label: "Participare fizică",
    description: "Vii alături de Artfest și îți prezinți produsele la târg.",
  },
  {
    value: "PARTICIPARE_LA_DISTANTA",
    label: "Participare la distanță",
    description: "Ne trimiți produsele, iar acestea pot fi prezentate și vândute prin standul Artfest.",
  },
];

export const PARTICIPATION_LABEL = Object.fromEntries(
  PARTICIPATION_OPTIONS.map((option) => [option.value, option.label])
);

export const STATUS_LABEL = {
  SUBMITTED: "Înscriere trimisă",
  APPROVED: "Participare aprobată",
  REJECTED: "Înscriere respinsă",
  WITHDRAWN: "Înscriere retrasă",
  CANCELLED: "Participare anulată",
};

// ton vizual al badge-ului de status
export const STATUS_TONE = {
  SUBMITTED: "info",
  APPROVED: "success",
  REJECTED: "danger",
  WITHDRAWN: "muted",
  CANCELLED: "danger",
};

export const DEFAULT_CANCELLATION_MESSAGE =
  "Participarea ta la Târgul Artfest a fost anulată. Verifică mai jos situația produselor și, dacă ai întrebări, contactează Asistența.";

export function formatFairDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ro-RO", { day: "numeric", month: "long", year: "numeric" });
}

export function useArtfestFair() {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  const reload = useCallback(async () => {
    try {
      const data = await api(FAIR_API);
      setState({ loading: false, error: "", data });
      return data;
    } catch (error) {
      setState((prev) => ({
        loading: false,
        error: error?.message || "Nu am putut încărca informațiile despre târg.",
        data: prev.data,
      }));
      return null;
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload, setData: (data) => setState({ loading: false, error: "", data }) };
}
