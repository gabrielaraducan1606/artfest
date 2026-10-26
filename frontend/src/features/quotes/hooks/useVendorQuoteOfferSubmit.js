// frontend/src/features/quotes/hooks/useVendorQuoteOfferSubmit.js

/*
 * Logica de câmpuri/validare/submit pentru "Trimite ofertă" (vendor) -
 * SINGURA logică de submit, folosită de pagina Mesaje, mini-fereastra
 * de mesaje și Asistent.
 *
 * Reutilizează EXACT createVendorQuoteOffer (quoteApi.js) - același
 * endpoint, același payload, nicio validare paralelă.
 *
 * conversationMode: ofertă pornită direct din conversație (fără „Cere
 * ofertă”) - vendorul alege și descrierea + cantitatea, iar oferta se
 * trimite pe thread (clientul e luat server-side din conversație).
 */

import { useEffect, useState } from "react";
import { createVendorQuoteOffer } from "../../../components/AIAssistant/quotes/quoteApi.js";

export const CONVERSATION_OFFER_TITLE_MIN = 3;

function emptyOfferForm() {
  return {
    unitPrice: "",
    shippingPrice: "0",
    productionDays: "",
    notes: "",
    // doar pentru oferta din conversație
    title: "",
    quantity: "1",
  };
}

export function useVendorQuoteOfferSubmit({
  quoteId,
  quantity,
  threadId = null,
  conversationMode = false,
}) {
  const [form, setForm] = useState(emptyOfferForm);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // altă conversație / cerere -> formular gol
  useEffect(() => {
    setForm(emptyOfferForm());
    setError("");
  }, [threadId, quoteId]);

  async function submit(event) {
    event?.preventDefault?.();

    if (sending || (conversationMode ? !threadId : !quoteId)) {
      return false;
    }

    const qty = Number(conversationMode ? form.quantity : quantity);
    const title = String(form.title || "").replace(/\s+/g, " ").trim();

    const unitPrice = Number(
      String(form.unitPrice || "")
        .trim()
        .replace(",", ".")
    );

    const shippingPrice = Number(
      String(form.shippingPrice || "0")
        .trim()
        .replace(",", ".")
    );

    const productionDays = Number.parseInt(
      form.productionDays,
      10
    );

    if (conversationMode && title.length < CONVERSATION_OFFER_TITLE_MIN) {
      setError(`Descrie pe scurt produsul oferit (minimum ${CONVERSATION_OFFER_TITLE_MIN} caractere).`);
      return false;
    }

    if (!Number.isInteger(qty) || qty <= 0) {
      setError(
        conversationMode
          ? "Introdu o cantitate validă (număr întreg, minimum 1)."
          : "Cantitatea cererii nu este validă."
      );
      return false;
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setError("Introdu un preț unitar valid.");
      return false;
    }

    if (!Number.isFinite(shippingPrice) || shippingPrice < 0) {
      setError("Introdu un cost de transport valid.");
      return false;
    }

    if (!Number.isFinite(productionDays) || productionDays <= 0) {
      setError("Introdu un termen de producție valid.");
      return false;
    }

    setSending(true);
    setError("");

    try {
      await createVendorQuoteOffer(
        quoteId,
        {
          quantity: qty,
          unitPrice,
          shippingPrice,
          currency: "RON",
          productionDays,
          notes: String(form.notes || "").trim() || null,
        },
        conversationMode ? { threadId, title } : undefined
      );

      setForm(emptyOfferForm());

      return true;
    } catch (err) {
      setError(
        err?.data?.message ||
          err?.message ||
          "Oferta nu a putut fi trimisă."
      );

      return false;
    } finally {
      setSending(false);
    }
  }

  return {
    form,
    setForm,
    sending,
    error,
    setError,
    submit,
  };
}
