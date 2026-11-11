// src/pages/Checkout/addresses/addressBookApi.js
//
// Agenda de adrese și ultimul easybox / Sameday Point ale clientului
// autentificat (/api/me/...). Fără cache: datele sunt personale și se
// revalidează pe server la fiecare citire.

import { api } from "../../../lib/api";

const enc = encodeURIComponent;

export async function listAddresses() {
  const data = await api("/api/me/addresses");
  return Array.isArray(data?.items) ? data.items : [];
}

export async function createAddress(body) {
  return (await api("/api/me/addresses", { method: "POST", body })).address;
}

export async function updateAddress(id, body) {
  return (await api(`/api/me/addresses/${enc(id)}`, { method: "PUT", body })).address;
}

export async function deleteAddress(id) {
  return api(`/api/me/addresses/${enc(id)}`, { method: "DELETE" });
}

export async function setDefaultAddress(id) {
  return (await api(`/api/me/addresses/${enc(id)}/default`, { method: "POST" })).address;
}

/** [{ method: "LOCKER"|"PUDO", status: "ok"|"unavailable", location?, previous? }] - revalidate acum. */
export async function fetchLastOohLocations() {
  try {
    const data = await api("/api/me/ooh-locations/last");
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}
