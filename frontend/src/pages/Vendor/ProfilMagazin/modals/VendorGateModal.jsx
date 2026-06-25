import { useMemo, useState } from "react";
import Modal from "../ui/Modal";
import styles from "../ProfilMagazin.module.css";

const isPhoneIntl = (v) =>
  /^\+[1-9]\d{7,14}$/.test((v || "").replace(/\s+/g, ""));

const isEmail = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((v || "").trim());

function legalHref(pathname) {
  const p = (pathname || "").trim();
  if (!p) return "#";
  if (/^https?:\/\//i.test(p)) return p;

  const rel = p.startsWith("/") ? p : `/${p}`;

  const map = {
    "/legal/tos.html": "/termenii-si-conditiile",
    "/legal/privacy.html": "/confidentialitate",
    "/legal/cookies.html": "/cookies",
    "/legal/returns_policy_ack.html": "/politica-retur",
    "/legal/shipping_addendum.html": "/anexa-expediere",
    "/legal/products_addendum.html": "/anexa-produse",
  };

  return map[rel] || rel;
}

function ronToCents(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function centsToRon(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(n / 100);
}

export default function VendorGateModal({
  open,
  onClose,
  gateDocs,
  onAccept,
  serviceId,
  profile,
  sellerData,
}) {
  const initialProfile = profile || sellerData?.profile || sellerData || {};

  const [gateChecks, setGateChecks] = useState({
    declaration: false,
    returns: false,
  });

  const [shipping, setShipping] = useState({
    address: initialProfile?.address || "",
    phone: initialProfile?.phone || "",
    email: initialProfile?.email || "",
    estimatedShippingFeeRon: centsToRon(
      sellerData?.estimatedShippingFeeCents ??
        sellerData?.service?.estimatedShippingFeeCents
    ),
    freeShippingThresholdRon: centsToRon(
      sellerData?.freeShippingThresholdCents ??
        sellerData?.service?.freeShippingThresholdCents
    ),
    shippingNotes:
      sellerData?.shippingNotes || sellerData?.service?.shippingNotes || "",
  });

  const [localLoading, setLocalLoading] = useState(false);
  const [localErr, setLocalErr] = useState(null);

  const canClose = !localLoading;

  const handleClose = () => {
    if (canClose) onClose?.();
  };

  const declarationText =
    "Declar pe propria răspundere că toate produsele pe care le listez pe platforma Artfest: " +
    "(1) respectă legislația aplicabilă și nu sunt produse interzise sau periculoase; " +
    "(2) nu încalcă drepturi de autor, mărci sau alte drepturi de proprietate intelectuală și dețin toate drepturile/licențele necesare; " +
    "(3) sunt descrise corect și complet (titlu, descriere, imagini, preț, stoc, termene de livrare); " +
    "(4) sunt realizate, ambalate și livrate cu bună-credință, conform Anexei Produse. " +
    "Înțeleg și accept că răspund integral pentru orice prejudiciu, sancțiune, reclamație sau cost rezultat din încălcarea celor declarate și că voi despăgubi Artfest pentru orice sume sau costuri suportate din această cauză. " +
    "Sunt de acord că Artfest poate delista produse și/sau suspenda contul meu în caz de încălcări sau suspiciuni rezonabile, pentru protecția clienților și a platformei.";

  const productsAddendumUrl = legalHref(
    gateDocs?.products_addendum?.url || "/anexa-produse"
  );

  const returnsPolicyUrl = legalHref(
    gateDocs?.returns_policy_ack?.url ||
      gateDocs?.returns?.url ||
      "/politica-retur"
  );

  const shippingAddendumUrl = legalHref(
    gateDocs?.shipping_addendum?.url || "/anexa-expediere"
  );

  const productsAddendumVersion = gateDocs?.products_addendum?.version || "";
  const returnsPolicyVersion =
    gateDocs?.returns_policy_ack?.version || gateDocs?.returns?.version || "";
  const productDeclVersion = gateDocs?.product_declaration?.version || "1.0.0";

  const phoneValue = (shipping.phone || "").replace(/\s+/g, "");
  const emailValue = (shipping.email || "").trim();

  const errors = useMemo(() => {
    const list = [];

    if (!shipping.address.trim()) {
      list.push("Completează adresa pentru retururi.");
    }

    if (!phoneValue) {
      list.push("Completează telefonul pentru retururi.");
    }

    if (phoneValue && !isPhoneIntl(phoneValue)) {
      list.push(
        "Telefonul trebuie să fie în format internațional, ex: +40712345678."
      );
    }

    if (!emailValue) {
      list.push("Completează emailul pentru retururi.");
    }

    if (emailValue && !isEmail(emailValue)) {
      list.push("Emailul pentru retururi nu este valid.");
    }

    if (shipping.estimatedShippingFeeRon === "") {
      list.push("Completează costul estimativ de livrare.");
    }

    if (Number(shipping.estimatedShippingFeeRon) < 0) {
      list.push("Costul de livrare nu poate fi negativ.");
    }

    if (Number(shipping.freeShippingThresholdRon) < 0) {
      list.push("Pragul pentru transport gratuit nu poate fi negativ.");
    }

    if (!gateChecks.declaration) {
      list.push("Confirmă declarația privind produsele.");
    }

    if (!gateChecks.returns) {
      list.push("Confirmă politica de retur.");
    }

    return list;
  }, [shipping, phoneValue, emailValue, gateChecks]);

  const canConfirm = errors.length === 0 && !localLoading;

  function updateShipping(key, value) {
    setShipping((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  async function saveShippingData() {
    if (!serviceId) {
      throw new Error("Lipsește serviceId pentru salvarea datelor de livrare.");
    }

    const profileRes = await fetch(
      `/api/vendors/vendor-services/${encodeURIComponent(serviceId)}/profile`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          address: shipping.address.trim(),
          phone: phoneValue,
          email: emailValue,
          mirrorVendor: true,
        }),
      }
    );

    if (!profileRes.ok) {
      const data = await profileRes.json().catch(() => ({}));
      throw new Error(data?.message || data?.error || "profile_save_failed");
    }

    const serviceRes = await fetch(
      `/api/vendors/me/services/${encodeURIComponent(serviceId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          estimatedShippingFeeCents: ronToCents(
            shipping.estimatedShippingFeeRon
          ),
          freeShippingThresholdCents: ronToCents(
            shipping.freeShippingThresholdRon
          ),
          shippingNotes: shipping.shippingNotes?.trim() || null,
        }),
      }
    );

    if (!serviceRes.ok) {
      const data = await serviceRes.json().catch(() => ({}));
      throw new Error(data?.message || data?.error || "shipping_save_failed");
    }
  }

 const handleConfirm = async () => {
  if (!serviceId) {
    setLocalErr("Lipsește serviceId. Nu pot salva datele de livrare.");
    return;
  }

  if (errors.length > 0) {
    setLocalErr(errors[0]);
    return;
  }

  setLocalErr(null);
  setLocalLoading(true);

  try {
      await saveShippingData();

      const declarationRes = await fetch(
        "/api/vendor/product-declaration/accept",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            version: productDeclVersion,
            textSnapshot: declarationText,
          }),
        }
      );

      if (!declarationRes.ok) {
        const data = await declarationRes.json().catch(() => ({}));
        throw new Error(data?.error || "product_declaration_failed");
      }

      const acceptRes = await fetch("/api/legal/vendor-accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accept: [{ type: "returns" }],
        }),
      });

      if (!acceptRes.ok) {
        const data = await acceptRes.json().catch(() => ({}));
        throw new Error(data?.message || data?.error || "vendor_accept_failed");
      }

      if (typeof onAccept === "function") {
        await onAccept();
      }

      onClose?.();
    } catch (e) {
      console.error("VendorGateModal accept error:", e);
      setLocalErr(
        e?.message === "profile_save_failed" ||
          e?.message === "shipping_save_failed"
          ? "Nu am putut salva datele de livrare. Te rugăm să încerci din nou."
          : "A apărut o eroare la salvare. Te rugăm să încerci din nou."
      );
    } finally {
      setLocalLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} maxWidth={760}>
      <div className={styles.modalHeader}>
        <h3 className={styles.modalTitle}>Înainte să adaugi primul produs</h3>

        <button
          className={styles.modalClose}
          onClick={handleClose}
          disabled={localLoading}
          type="button"
          aria-label="Închide"
        >
          ×
        </button>
      </div>

      <div className={styles.modalBody} aria-busy={localLoading}>
        {localLoading ? (
          <p className={styles.vendorGateSaving}>Se salvează datele…</p>
        ) : (
          <>
            <p className={styles.vendorGateIntro}>
              Pentru primul produs avem nevoie de câteva informații
              operaționale: livrare, retururi și confirmarea regulilor pentru
              produse.
            </p>

            <div className={styles.vendorGateGrid}>
              <section className={styles.vendorGateSection}>
                <h4 className={styles.vendorGateSectionTitle}>
                  Date pentru retururi
                </h4>

                <label className={styles.vendorGateField}>
                  Adresă retururi / punct de lucru *
                  <input
                    className={styles.input}
                    value={shipping.address}
                    onChange={(e) => updateShipping("address", e.target.value)}
                    placeholder="Localitate, stradă și număr, județ"
                    autoComplete="street-address"
                  />
                  <small className={styles.vendorGateHelp}>
                    Folosită intern pentru retururi. Nu este afișată public.
                  </small>
                </label>

                <div className={styles.vendorGateFields2}>
                  <label className={styles.vendorGateField}>
                    Telefon retururi *
                    <input
                      className={styles.input}
                      value={shipping.phone}
                      onChange={(e) =>
                        updateShipping(
                          "phone",
                          e.target.value.replace(/\s+/g, "")
                        )
                      }
                      placeholder="ex: +40712345678"
                      inputMode="tel"
                      autoComplete="tel"
                    />
                  </label>

                  <label className={styles.vendorGateField}>
                    Email retururi *
                    <input
                      className={styles.input}
                      value={shipping.email}
                      onChange={(e) => updateShipping("email", e.target.value)}
                      placeholder="retururi@brand.ro"
                      type="email"
                      autoComplete="email"
                    />
                  </label>
                </div>
              </section>

              <section className={styles.vendorGateSection}>
                <h4 className={styles.vendorGateSectionTitle}>
                  Informații livrare
                </h4>

                <div className={styles.vendorGateFields2}>
                  <label className={styles.vendorGateField}>
                    Cost estimativ livrare *
                    <input
                      className={styles.input}
                      type="number"
                      min="0"
                      step="0.01"
                      value={shipping.estimatedShippingFeeRon}
                      onChange={(e) =>
                        updateShipping(
                          "estimatedShippingFeeRon",
                          e.target.value
                        )
                      }
                      placeholder="25"
                    />
                  </label>

                  <label className={styles.vendorGateField}>
                    Transport gratuit de la *
                    <input
                      className={styles.input}
                      type="number"
                      min="0"
                      step="0.01"
                      value={shipping.freeShippingThresholdRon}
                      onChange={(e) =>
                        updateShipping(
                          "freeShippingThresholdRon",
                          e.target.value
                        )
                      }
                      placeholder="Ex: 300 sau lasă gol"
                    />
                  </label>
                </div>

                <label className={styles.vendorGateField}>
                  Mențiuni livrare (opțional)
                  <textarea
                    className={styles.input}
                    rows={3}
                    value={shipping.shippingNotes}
                    onChange={(e) =>
                      updateShipping("shippingNotes", e.target.value)
                    }
                    placeholder="Ex: Livrare estimativă în 1–3 zile lucrătoare. Pentru produse voluminoase, costul poate diferi."
                  />
                </label>

                <p className={styles.vendorGateNote}>
                  Vezi{" "}
                  <a
                    href={shippingAddendumUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Anexa de expediere
                  </a>
                  .
                </p>
              </section>

              <section className={styles.vendorGateSection}>
                <h4 className={styles.vendorGateSectionTitle}>
                  Confirmări necesare
                </h4>

                <p className={styles.vendorGateNote}>
                  Declarația este complementară{" "}
                  <a
                    href={productsAddendumUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Anexei Produse
                    {productsAddendumVersion
                      ? ` (v${productsAddendumVersion})`
                      : ""}
                  </a>
                  .
                </p>

                <label className={styles.vendorGateCheck}>
                  <input
                    type="checkbox"
                    checked={!!gateChecks.declaration}
                    onChange={(e) =>
                      setGateChecks((prev) => ({
                        ...prev,
                        declaration: e.target.checked,
                      }))
                    }
                    required
                  />

                  <span>
                    Declar că toate produsele pe care le listez pe Artfest:
                    <ul>
                      <li>respectă legislația în vigoare;</li>
                      <li>
                        nu încalcă drepturi de autor, mărci sau alte drepturi
                        de proprietate intelectuală;
                      </li>
                      <li>
                        sunt descrise corect: titlu, descriere, imagini, preț,
                        stoc și termene de livrare;
                      </li>
                      <li>
                        sunt realizate și livrate cu bună-credință, conform
                        Anexei Produse.
                      </li>
                    </ul>
                  </span>
                </label>

                <label className={styles.vendorGateCheck}>
                  <input
                    type="checkbox"
                    checked={!!gateChecks.returns}
                    onChange={(e) =>
                      setGateChecks((prev) => ({
                        ...prev,
                        returns: e.target.checked,
                      }))
                    }
                    required
                  />

                  <span>
                    Confirm că am citit și accept{" "}
                    <a
                      href={returnsPolicyUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Politica de retur pentru vânzători
                      {returnsPolicyVersion
                        ? ` (v${returnsPolicyVersion})`
                        : ""}
                    </a>
                    .
                  </span>
                </label>
              </section>
            </div>

            {localErr && <div className={styles.error}>{localErr}</div>}

            {!localErr && errors.length > 0 && (
              <small className={styles.vendorGateHelp}>
                Mai ai: {errors[0]}
              </small>
            )}

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={handleClose}
                disabled={localLoading}
              >
                Renunță
              </button>

              <button
                type="button"
                className={styles.primaryBtn}
                onClick={handleConfirm}
                disabled={localLoading || !canConfirm}
                title={!canConfirm ? errors.join(" ") : undefined}
              >
                Confirm și continui
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}