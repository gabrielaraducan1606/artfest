// frontend/src/pages/Checkout/Checkout.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { guestCart } from "../../lib/guestCart";
import styles from "./Checkout.module.css";

const BACKEND_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const isHttp = (u = "") => /^https?:\/\//i.test(u);
const isDataOrBlob = (u = "") => /^(data|blob):/i.test(u);
const resolveFileUrl = (u) => {
  if (!u) return "";
  if (isHttp(u) || isDataOrBlob(u)) return u;
  const path = u.startsWith("/") ? u : `/${u}`;
  return BACKEND_BASE ? `${BACKEND_BASE}${path}` : path;
};

const money = (v, currency = "RON") =>
  new Intl.NumberFormat("ro-RO", { style: "currency", currency }).format(v ?? 0);

export default function Checkout() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);  // [{ productId, title, image, qty, price, currency, vendorId }]
  const [currency, setCurrency] = useState("RON");
  const [subtotal, setSubtotal] = useState(0);

  // address + geo dropdowns
  const [counties, setCounties] = useState([]);
  const [localities, setLocalities] = useState([]);

  const [address, setAddress] = useState({
    name: "",
    phone: "",
    county: "",
    locality: "",   // folosim "locality" în UI
    postalCode: "",
    street: "",
    notes: "",
  });

  // per-vendor selections: { [vendorId]: { method: "COURIER"|"LOCKER", lockerId?:string, lockerLabel?:string } }
  const [selections, setSelections] = useState({});

  const [quoting, setQuoting] = useState(false);
  const [quote, setQuote] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");

  const grandTotal = useMemo(
    () => (quote ? subtotal + (quote.totalShipping || 0) : subtotal),
    [subtotal, quote]
  );

  // item groups by vendor
  const vendors = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const v = String(it.vendorId || "unknown");
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(it);
    }
    return Array.from(map.entries()).map(([vendorId, its]) => ({ vendorId, items: its }));
  }, [items]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        // 1) Auth
        const d = await api("/api/auth/me").catch(() => null);
        const me = d?.user || null;
        if (!me) {
          const redir = encodeURIComponent("/checkout");
          nav(`/autentificare?redirect=${redir}`);
          return;
        }

        // 2) MERGE guest → server
        const local = guestCart.list();
        if (local.length) {
          try {
            const r = await api("/api/cart/merge", {
              method: "POST",
              body: { items: local },
            });
            guestCart.clear();
            try { window.dispatchEvent(new CustomEvent("cart:changed")); } catch {""}
            if (r?.skipped > 0) {
              alert(
                r.merged > 0
                  ? `Am adăugat ${r.merged} produse în coșul tău. ${r.skipped} produse au fost omise.`
                  : `${r.skipped} produse din coșul de vizitator au fost omise.`
              );
            }
          } catch {""}
        }

        // 3) Summary (include imagine)
        const s = await api("/api/checkout/summary");
        setItems(Array.isArray(s?.items) ? s.items : []);
        setCurrency(s?.currency || "RON");
        setSubtotal(s?.subtotal || 0);

        // 4) load counties
        const c = await api("/api/shipping/sameday/counties").catch(() => ({ items: [] }));
        setCounties(c?.items || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [nav]);

  // load localities when county changes
  useEffect(() => {
    (async () => {
      if (!address.county) {
        setLocalities([]);
        setAddress((a) => ({ ...a, locality: "", postalCode: "" }));
        return;
      }
      const res = await api(`/api/shipping/sameday/localities?county=${encodeURIComponent(address.county)}`)
        .catch(() => ({ items: [] }));
      setLocalities(res?.items || []);
      setAddress((a) => ({ ...a, locality: "", postalCode: "" }));
    })();
  }, [address.county]);

  // auto postal code when locality changes
  useEffect(() => {
    (async () => {
      if (!address.county || !address.locality) {
        setAddress((a) => ({ ...a, postalCode: "" }));
        return;
      }
      const res = await api(`/api/shipping/sameday/postal-code?county=${encodeURIComponent(address.county)}&locality=${encodeURIComponent(address.locality)}`)
        .catch(() => ({ postalCode: "" }));
      setAddress((a) => ({ ...a, postalCode: res?.postalCode || "" }));
    })();
  }, [address.locality, address.county]);

  // defaults selections to courier per vendor
  useEffect(() => {
    setSelections((prev) => {
      const next = { ...prev };
      for (const g of vendors) {
        const key = String(g.vendorId);
        if (!next[key]) next[key] = { method: "COURIER" };
      }
      return next;
    });
  }, [vendors]);

  async function getQuote() {
    setQuoting(true);
    setError("");
    try {
      // mapăm locality -> city pentru API-ul backend
      const addressForApi = { ...address, city: address.locality };
      const q = await api("/api/checkout/quote", {
        method: "POST",
        body: { address: addressForApi, selections },
      });
      setQuote(q);
    } catch (e) {
      setQuote(null);
      setError(e?.message || "Nu am putut calcula transportul. Verifică adresa.");
    } finally {
      setQuoting(false);
    }
  }

  async function placeOrder() {
    if (!items.length) {
      setError("Coșul este gol.");
      return;
    }
    // validare corectă ↴ (folosim locality, nu city)
    if (!address.name || !address.phone || !address.locality || !address.street) {
      setError("Completează nume, telefon, oraș și stradă pentru livrare.");
      return;
    }

    setPlacing(true);
    setError("");
    try {
      const addressForApi = { ...address, city: address.locality };
      const r = await api("/api/checkout/place", {
        method: "POST",
        body: { address: addressForApi, quoteId: quote?.id || null, selections },
      });

      try { window.dispatchEvent(new CustomEvent("cart:changed")); } catch {""}

      if (r?.orderId) {
        return nav(`/multumim?order=${encodeURIComponent(r.orderId)}`);
      }
      alert("Comanda a fost înregistrată.");
      nav("/comenzile-mele");
    } catch (e) {
      setError(e?.message || "Plasarea comenzii a eșuat.");
    } finally {
      setPlacing(false);
    }
  }

  async function pickLocker(vendorId) {
    try {
      const res = await api("/api/shipping/sameday/lockers").catch(() => ({ items: [] }));
      const list = res?.items || [];
      if (!list.length) {
        alert("Nu am găsit lockere în zonă.");
        return;
      }
      const label = list.map((l, i) => `${i + 1}. ${l.name} — ${l.address}`).join("\n");
      const input = prompt(`Alege locker (1-${list.length}):\n\n${label}`);
      const idx = Number(input) - 1;
      if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return;
      const chosen = list[idx];
      setSelections((s) => ({
        ...s,
        [String(vendorId)]: { method: "LOCKER", lockerId: chosen.id, lockerLabel: `${chosen.name} — ${chosen.address}` },
      }));
    } catch {
      alert("Nu am putut încărca lockerele.");
    }
  }

  if (loading) return <div className={styles.container}>Se încarcă…</div>;

  return (
    <div className={styles.container}>
      <h2 className={styles.pageTitle}>Checkout</h2>

      {error && <div className={styles.alert}>{error}</div>}

      {items.length === 0 ? (
        <div className={styles.empty}>
          Coșul tău este gol.{" "}
          <a href="/produse" className={styles.linkPrimary}>Mergi la produse</a>
        </div>
      ) : (
        <div className={styles.layout}>
          {/* Stânga: produse + adresă + livrare per vendor */}
          <div className={styles.left}>
            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Produsele tale</h3>
              <ul className={styles.itemsList}>
                {items.map((it) => (
                  <li key={`${it.productId}`} className={styles.itemRow}>
                    <div className={styles.itemMedia}>
                      {it.image ? (
                        <img
                          src={resolveFileUrl(it.image)}
                          alt={it.title}
                          className={styles.thumb}
                        />
                      ) : (
                        <div className={styles.thumbPlaceholder} />
                      )}
                    </div>
                    <div className={styles.itemTitle}>{it.title}</div>
                    <div className={styles.itemQty}>x{it.qty}</div>
                    <div className={styles.itemPrice}>
                      {money(it.price * it.qty, it.currency || currency)}
                    </div>
                  </li>
                ))}
              </ul>
              <div className={styles.divider} />
              <div className={styles.summaryRow}>
                <span>Subtotal</span>
                <strong>{money(subtotal, currency)}</strong>
              </div>
            </section>

            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Adresă livrare</h3>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  <span>Nume și prenume*</span>
                  <input
                    value={address.name}
                    onChange={(e) => setAddress({ ...address, name: e.target.value })}
                    placeholder="Ex: Popescu Ana"
                  />
                </label>
                <label className={styles.field}>
                  <span>Telefon*</span>
                  <input
                    value={address.phone}
                    onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                    placeholder="07xx xxx xxx"
                  />
                </label>
                <label className={styles.field}>
                  <span>Județ*</span>
                  <select
                    value={address.county}
                    onChange={(e) => setAddress({ ...address, county: e.target.value })}
                  >
                    <option value="">Alege județ</option>
                    {counties.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Localitate*</span>
                  <select
                    value={address.locality}
                    onChange={(e) => setAddress({ ...address, locality: e.target.value })}
                    disabled={!address.county}
                  >
                    <option value="">Alege localitate</option>
                    {localities.map((l) => (
                      <option key={l.name} value={l.name}>{l.name}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>Cod poștal</span>
                  <input value={address.postalCode} readOnly placeholder="auto" />
                </label>
                <label className={styles.fieldFull}>
                  <span>Stradă și număr*</span>
                  <input
                    value={address.street}
                    onChange={(e) => setAddress({ ...address, street: e.target.value })}
                    placeholder="Ex: Șos. Olteniței 123"
                  />
                </label>
                <label className={styles.fieldFull}>
                  <span>Observații (opțional)</span>
                  <textarea
                    value={address.notes}
                    onChange={(e) => setAddress({ ...address, notes: e.target.value })}
                    placeholder="Interfon, interval preferat, etc."
                    rows={3}
                  />
                </label>
              </div>
            </section>

            {/* livrare per vendor */}
            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Metodă de livrare</h3>
              <div className={styles.shipGrid}>
                {vendors.map((g) => {
                  const key = String(g.vendorId);
                  const sel = selections[key] || { method: "COURIER" };
                  return (
                    <div key={key} className={styles.vendorBox}>
                      <div className={styles.vendorHead}>
                        <strong>Magazin {key.slice(0, 6)}…</strong>
                        <span>{g.items.length} produse</span>
                      </div>
                      <div className={styles.radioRow}>
                        <label className={styles.radio}>
                          <input
                            type="radio"
                            name={`ship_${key}`}
                            checked={sel.method === "COURIER"}
                            onChange={() =>
                              setSelections((s) => ({ ...s, [key]: { method: "COURIER" } }))
                            }
                          />
                          <span>Curier</span>
                        </label>
                        <label className={styles.radio}>
                          <input
                            type="radio"
                            name={`ship_${key}`}
                            checked={sel.method === "LOCKER"}
                            onChange={() =>
                              setSelections((s) => ({ ...s, [key]: { method: "LOCKER" } }))
                            }
                          />
                          <span>Easybox</span>
                        </label>
                        {sel.method === "LOCKER" && (
                          <div className={styles.lockerRow}>
                            <button
                              type="button"
                              className={styles.secondaryBtn}
                              onClick={() => pickLocker(key)}
                            >
                              Alege locker
                            </button>
                            {sel.lockerLabel && (
                              <span className={styles.lockerChosen}>{sel.lockerLabel}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.actionsRow}>
                <button
                  className={styles.secondaryBtn}
                  onClick={getQuote}
                  disabled={quoting}
                  type="button"
                >
                  {quoting ? "Se calculează…" : "Calculează livrarea"}
                </button>
              </div>

              {quote && (
                <>
                  <div className={styles.divider} />
                  <div className={styles.shipments}>
                    <div className={styles.shipTitle}>Livrare</div>
                    <ul className={styles.shipList}>
                      {quote.shipments.map((s, idx) => (
                        <li key={`${s.vendorId}-${idx}`} className={styles.shipRow}>
                          <span>Magazin {String(s.vendorId).slice(0, 6)}…</span>
                          <span>{s.method === "LOCKER" ? "Easybox" : "Curier"}</span>
                          <strong>{money(s.price, quote.currency || "RON")}</strong>
                        </li>
                      ))}
                    </ul>
                    <div className={styles.summaryRow}>
                      <span>Transport total</span>
                      <strong>{money(quote.totalShipping, quote.currency || "RON")}</strong>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>

          {/* Dreapta: sumar + plasare */}
          <aside className={styles.right}>
            <div className={styles.card}>
              <h3 className={styles.cardTitle}>Sumar comandă</h3>
              <div className={styles.summaryRow}>
                <span>Produse</span>
                <strong>{money(subtotal, currency)}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Transport</span>
                <strong>{money(quote?.totalShipping || 0, quote?.currency || currency)}</strong>
              </div>
              <div className={styles.divider} />
              <div className={styles.totalRow}>
                <span>Total</span>
                <strong>{money(grandTotal, currency)}</strong>
              </div>

              <button
                className={styles.primaryBtn}
                onClick={placeOrder}
                disabled={placing}
                type="button"
              >
                {placing ? "Se plasează…" : "Plasează comanda"}
              </button>

              <p className={styles.legalNote}>
                Continuând, accepți <a href="/termeni" target="_blank" rel="noreferrer">Termenii</a> și
                confirmi că ai citit <a href="/confidentialitate" target="_blank" rel="noreferrer">Politica de confidențialitate</a>.
              </p>
            </div>

            <div className={styles.card}>
              <h4 className={styles.cardTitleSmall}>Retur & GDPR</h4>
              <ul className={styles.bullets}>
                <li>Vezi <a href="/politica-de-retur" target="_blank" rel="noreferrer">Politica de retur</a>.</li>
                <li>La generarea AWB, datele de livrare sunt transmise curierului.</li>
              </ul>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
