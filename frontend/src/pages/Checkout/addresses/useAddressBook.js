// src/pages/Checkout/addresses/useAddressBook.js
//
// Starea agendei de adrese din checkout (doar client autentificat):
//  - la pornire: alegerea din tab (refresh) > o singură adresă > implicita;
//    fără adrese -> se deschide direct „Adaugă adresă”;
//  - o adresă tastată înainte de login (guest) NU se înlocuiește și NU se
//    salvează automat: rămâne folosită, cu oferta „Salvează această adresă în cont”;
//  - CRUD prin /api/me/addresses; serverul revalidează județ / localitate Sameday.

import { useCallback, useEffect, useRef, useState } from "react";
import * as addressApi from "./addressBookApi.js";
import { findMatchingAddress, isShippingComplete, pickInitialAddress, shippingToAddressInput } from "./addressBook.js";

export default function useAddressBook({ enabled, shippingAddress, applyAddress, initialSelectedId = null }) {
  const [addresses, setAddresses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [drawer, setDrawer] = useState(null); // null | { mode: "list" } | { mode: "form", address }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState(null);
  // adresa tastată ca guest, păstrată după login (nu e în agendă)
  const [typedKept, setTypedKept] = useState(false);

  const shippingRef = useRef(shippingAddress);
  shippingRef.current = shippingAddress;
  const applyRef = useRef(applyAddress);
  applyRef.current = applyAddress;

  const resetErrors = () => {
    setError("");
    setFieldErrors(null);
  };

  const select = useCallback((address) => {
    setSelectedId(address?.id || null);
    setTypedKept(false);
    if (address) applyRef.current(address);
  }, []);

  // încărcare + alegerea de pornire (o dată per autentificare)
  useEffect(() => {
    if (!enabled) {
      setAddresses([]);
      setLoaded(false);
      return undefined;
    }
    let cancelled = false;
    addressApi
      .listAddresses()
      .then((list) => {
        if (cancelled) return;
        setAddresses(list);
        setLoaded(true);

        const kept = list.find((a) => a.id === initialSelectedId);
        if (kept) return select(kept);

        const typed = shippingRef.current;
        if (isShippingComplete(typed)) {
          const match = findMatchingAddress(list, typed);
          if (match) return select(match);
          // guest -> login: păstrăm ce a tastat; salvarea în cont e opțională
          setSelectedId(null);
          setTypedKept(true);
          return undefined;
        }

        const initial = pickInitialAddress(list, null);
        if (initial) return select(initial);
        setDrawer({ mode: "form", address: null });
        return undefined;
      })
      .catch(() => {
        if (!cancelled) {
          setLoaded(true);
          setError("Nu am putut încărca adresele salvate. Poți completa adresa mai jos.");
        }
      });
    return () => {
      cancelled = true;
    };
    // initialSelectedId / select: doar la pornire
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const reload = useCallback(async () => {
    const list = await addressApi.listAddresses();
    setAddresses(list);
    return list;
  }, []);

  const failWith = (e, fallback) => {
    setFieldErrors(e?.data?.fields || null);
    setError(e?.data?.message || e?.message || fallback);
  };

  const save = useCallback(
    async (form, editingId) => {
      resetErrors();
      setBusy(true);
      try {
        const body = { ...shippingToAddressInput(form, form.label), isDefault: Boolean(form.isDefault) };
        const saved = editingId ? await addressApi.updateAddress(editingId, body) : await addressApi.createAddress(body);
        await reload();
        // adresă nouă sau cea folosită acum -> devine adresa de livrare
        if (!editingId || editingId === selectedId || typedKept) select(saved);
        setDrawer(null);
        return saved;
      } catch (e) {
        failWith(e, "Nu am putut salva adresa.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [reload, select, selectedId, typedKept]
  );

  const remove = useCallback(
    async (address) => {
      resetErrors();
      setBusy(true);
      try {
        await addressApi.deleteAddress(address.id);
        const list = await reload();
        if (address.id === selectedId) {
          const next = pickInitialAddress(list, null);
          if (next) select(next);
          else {
            setSelectedId(null);
            setDrawer({ mode: "form", address: null });
          }
        }
      } catch (e) {
        failWith(e, "Nu am putut șterge adresa.");
      } finally {
        setBusy(false);
      }
    },
    [reload, select, selectedId]
  );

  const makeDefault = useCallback(
    async (address) => {
      resetErrors();
      setBusy(true);
      try {
        await addressApi.setDefaultAddress(address.id);
        await reload();
      } catch (e) {
        failWith(e, "Nu am putut seta adresa implicită.");
      } finally {
        setBusy(false);
      }
    },
    [reload]
  );

  /** „Salvează această adresă în cont” - adresa tastată înainte de login. */
  const saveTyped = useCallback(async () => {
    resetErrors();
    setBusy(true);
    try {
      const saved = await addressApi.createAddress(shippingToAddressInput(shippingRef.current));
      await reload();
      select(saved);
      return saved;
    } catch (e) {
      failWith(e, "Nu am putut salva adresa.");
      // câmpuri invalide -> formularul, precompletat cu ce a tastat
      if (e?.data?.fields) setDrawer({ mode: "form", address: { ...shippingToAddressInput(shippingRef.current), id: null } });
      return null;
    } finally {
      setBusy(false);
    }
  }, [reload, select]);

  const selected = addresses.find((a) => a.id === selectedId) || null;

  return {
    addresses,
    loaded,
    selected,
    selectedId,
    typedKept,
    drawer,
    busy,
    error,
    fieldErrors,
    openList: () => {
      resetErrors();
      setDrawer(addresses.length ? { mode: "list" } : { mode: "form", address: null });
    },
    openForm: (address = null) => {
      resetErrors();
      setDrawer({ mode: "form", address });
    },
    showList: () => {
      resetErrors();
      setDrawer({ mode: "list" });
    },
    close: () => {
      resetErrors();
      setDrawer(null);
    },
    select: (address) => {
      select(address);
      setDrawer(null);
    },
    save,
    remove,
    makeDefault,
    saveTyped,
  };
}
