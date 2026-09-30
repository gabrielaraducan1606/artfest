// src/pages/Vendor/Orders/utils/awbPanelLogic.js

/*
 * Logică pură pentru panoul AWB din detaliul comenzii vendorului.
 * Backend-ul (couriers/awb) rămâne sursa de adevăr: COD, eligibilitate,
 * adrese - aici doar decidem ce afișăm și validăm local câmpurile pe care
 * vendorul le poate completa (greutate, colete, dimensiuni, serviciu).
 */

import { hasActiveCourierAccount } from "./courierCta.js";

// câmpurile pe care vendorul le poate modifica în modal (NIMIC financiar)
export const AWB_INPUT_FIELDS = ["courierAccountId", "serviceId", "parcels", "weightKg", "lengthCm", "widthCm", "heightCm"];

// blockere pe care vendorul le poate rezolva direct în formular
const INPUT_BLOCKER_CODES = new Set([
  "weight_required",
  "weight_invalid",
  "parcels_invalid",
  "dimension_invalid",
  "service_invalid",
]);

export function isInputBlocker(b) {
  return INPUT_BLOCKER_CODES.has(b?.code);
}

/**
 * Ce afișează panoul:
 *  - "loading"   : încă încărcăm conturile
 *  - "created"   : Shipment are deja AWB -> AWB + Descarcă eticheta
 *  - "pending"   : generare în curs / rezultat neconfirmat (REQUESTED / UNKNOWN)
 *  - "connect"   : niciun cont de curier activ -> CTA „Conectează un curier”
 *  - "generate"  : buton „Generează AWB”
 *  - "hidden"    : comandă anulată / eroare la încărcare (fără CTA-uri false)
 */
export function decideAwbPanelState({ shipment, orderStatus, accounts, accountsLoading, accountsError, activeStatus }) {
  if (shipment?.awb) return "created";
  if (activeStatus === "REQUESTED" || activeStatus === "UNKNOWN") return "pending";
  if (orderStatus === "cancelled") return "hidden";
  if (accountsLoading) return "loading";
  if (accountsError || !Array.isArray(accounts)) return "hidden";
  return hasActiveCourierAccount(accounts) ? "generate" : "connect";
}

// eticheta generată de Artfest se descarcă prin ruta protejată (PDF de la curier)
export function isArtfestLabel(shipment) {
  return typeof shipment?.labelUrl === "string" && shipment.labelUrl.startsWith("/api/vendor/shipments/");
}

export function initialAwbForm(preview) {
  return {
    courierAccountId: preview?.courier?.accountId || "",
    serviceId: preview?.serviceId != null ? String(preview.serviceId) : "",
    parcels: preview?.parcels != null ? String(preview.parcels) : "1",
    weightKg: preview?.weightKg != null ? String(preview.weightKg) : "",
    lengthCm: preview?.lengthCm != null ? String(preview.lengthCm) : "",
    widthCm: preview?.widthCm != null ? String(preview.widthCm) : "",
    heightCm: preview?.heightCm != null ? String(preview.heightCm) : "",
  };
}

/**
 * Body pentru preview / create: DOAR câmpurile permise. codAmount nu se
 * trimite niciodată (e calculat pe server).
 */
export function buildAwbRequestBody(form) {
  const body = {};
  if (form?.courierAccountId) body.courierAccountId = form.courierAccountId;
  if (form?.serviceId !== "" && form?.serviceId != null) body.serviceId = form.serviceId;
  for (const key of ["parcels", "weightKg", "lengthCm", "widthCm", "heightCm"]) {
    const v = String(form?.[key] ?? "").trim().replace(",", ".");
    if (v !== "") body[key] = Number(v);
  }
  return body;
}

// validare locală, aceleași limite ca backend-ul (couriers/awb/parcels.js)
export function validateAwbForm(form) {
  const errors = {};
  const num = (k) => Number(String(form?.[k] ?? "").trim().replace(",", "."));
  const empty = (k) => String(form?.[k] ?? "").trim() === "";

  if (empty("weightKg")) errors.weightKg = "Completează greutatea totală (kg).";
  else if (!Number.isFinite(num("weightKg")) || num("weightKg") < 0.01 || num("weightKg") > 500) {
    errors.weightKg = "Greutatea trebuie să fie între 0,01 și 500 kg.";
  }

  if (!empty("parcels")) {
    const p = num("parcels");
    if (!Number.isInteger(p) || p < 1 || p > 20) errors.parcels = "Numărul de colete: între 1 și 20.";
  }

  for (const k of ["lengthCm", "widthCm", "heightCm"]) {
    if (empty(k)) continue;
    const v = num(k);
    if (!Number.isInteger(v) || v < 1 || v > 300) errors[k] = "Întreg între 1 și 300 cm.";
  }

  return errors;
}

/**
 * Blockerele rămase: cele de tip "input" dispar din listă când vendorul
 * editează câmpurile (validarea lor devine locală, apoi finală pe server).
 */
export function remainingBlockers(blockers, { inputsTouched }) {
  return (blockers || []).filter((b) => !(inputsTouched && isInputBlocker(b)));
}

export function canSubmitAwb({ blockers, inputsTouched, formErrors, submitting }) {
  if (submitting) return false;
  if (Object.keys(formErrors || {}).length) return false;
  return remainingBlockers(blockers, { inputsTouched }).length === 0;
}

// cheie de idempotență per încercare (aceeași cheie la retrimiterea după o eroare de rețea)
export function newIdempotencyKey() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `awb-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * După un răspuns de eroare: păstrăm cheia DOAR dacă nu știm dacă cererea a
 * ajuns la server (eroare de rețea, fără status) - retrimiterea e atunci
 * sigură (același rezultat). Orice răspuns HTTP => încercare nouă = cheie nouă.
 */
export function shouldKeepIdempotencyKey(error) {
  return !error?.status;
}

export function formatMoneyRon(value) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(n);
}
