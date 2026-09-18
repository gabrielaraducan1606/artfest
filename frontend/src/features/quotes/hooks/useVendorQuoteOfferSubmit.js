// frontend/src/features/quotes/hooks/useVendorQuoteOfferSubmit.js

/*
 * Logica de câmpuri/validare/submit pentru "Trimite ofertă" (vendor),
 * extrasă din handleSendQuoteOffer (Messages.jsx) - SINGURA logică de
 * submit pentru suprafețele NOI care reutilizează formularul
 * (Asistent, mini-fereastra de mesaje). Messages.jsx își păstrează
 * propriul handler, neatins (nu era permisă modificarea lui) - dar
 * validarea/payload-ul de mai jos sunt identice cu ale lui.
 *
 * Reutilizează EXACT createVendorQuoteOffer (quoteApi.js) - același
 * endpoint, același payload, nicio validare paralelă.
 */

import { useState } from "react";
import { createVendorQuoteOffer } from "../../../components/AIAssistant/quotes/quoteApi.js";

export function useVendorQuoteOfferSubmit({ quoteId, quantity }) {
  const [form, setForm] = useState({
    unitPrice: "",
    shippingPrice: "0",
    productionDays: "",
    notes: "",
  });

  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event?.preventDefault?.();

    if (!quoteId || sending) {
      return false;
    }

    const qty = Number(quantity);

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

    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Cantitatea cererii nu este validă.");
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
      await createVendorQuoteOffer(quoteId, {
        quantity: qty,
        unitPrice,
        shippingPrice,
        currency: "RON",
        productionDays,
        notes: String(form.notes || "").trim() || null,
      });

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
