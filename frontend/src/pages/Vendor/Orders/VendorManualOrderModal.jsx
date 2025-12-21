// VendorManualOrderModal.jsx
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../../lib/api";
import styles from "./Orders.module.css";

function formatMoney(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
  }).format(v);
}

export default function VendorManualOrderModal({ onClose, onCreated }) {
  const [customer, setCustomer] = useState({
    name: "",
    email: "",
    phone: "",
  });

  const [address, setAddress] = useState({
    street: "",
    city: "",
    county: "",
    postalCode: "",
  });

  const [items, setItems] = useState([
    { title: "", qty: 1, price: 0 },
  ]);

  const [shippingPrice, setShippingPrice] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("COD"); 

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function updateCustomer(field, value) {
    setCustomer((prev) => ({ ...prev, [field]: value }));
  }

  function updateAddress(field, value) {
    setAddress((prev) => ({ ...prev, [field]: value }));
  }

  function updateItem(index, field, value) {
    setItems((prev) => {
      const next = [...prev];
      const it = { ...next[index] };
      if (field === "qty" || field === "price") {
        it[field] = Number(value) || 0;
      } else {
        it[field] = value;
      }
      next[index] = it;
      return next;
    });
  }

  function addItem() {
    setItems((prev) => [...prev, { title: "", qty: 1, price: 0 }]);
  }

  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function computeTotals() {
    const subtotal = items.reduce(
      (sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0),
      0
    );
    const shipping = Number(shippingPrice || 0);
    const total = subtotal + shipping;
    return { subtotal, shipping, total };
  }

  async function handleSubmit() {
  setErr("");

  const hasValidItem = items.some((it) => it.title.trim() && Number(it.qty) > 0);
  if (!hasValidItem) {
    setErr("Adaugă cel puțin un produs cu titlu și cantitate > 0.");
    return;
  }

  if (!customer.name.trim()) {
    setErr("Completează numele clientului.");
    return;
  }

  setSaving(true);
  try {
    const res = await api("/api/vendor/orders/manual", {
      method: "POST",
      body: {
        customer,
        address,
        items: items
          .filter((it) => it.title.trim() && Number(it.qty) > 0)
          .map((it) => ({
            title: it.title.trim(),
            qty: Number(it.qty) || 1,
            price: Number(it.price) || 0,
          })),
        shippingPrice: Number(shippingPrice || 0),
        paymentMethod,
      },
    });

    // ✅ refresh listă (părinte) + închidere
    onCreated?.(res);  // res conține { ok, orderId, shipmentId }
    onClose?.();
  } catch (e) {
    setErr(e?.message || "Nu am putut crea comanda. Te rugăm să încerci din nou.");
  } finally {
    setSaving(false);
  }
}

  const totals = computeTotals();

  return (
    <div
      className={styles.modalBackdrop}
      role="dialog"
      aria-modal="true"
    >
      <div className={styles.modal}>
        <div className={styles.modalHead}>
          <h3>Adaugă comandă manuală</h3>
          <button
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Închide"
            disabled={saving}
          >
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          <p className={styles.muted}>
            Creezi o comandă direct în numele clientului. Va apărea în lista de
            comenzi ca orice altă comandă normală.
          </p>

          {/* Client */}
          <fieldset className={styles.fieldset}>
            <legend>Date client</legend>
            <div className={styles.grid3}>
              <label>
                Nume client *
                <input
                  className={styles.input}
                  value={customer.name}
                  onChange={(e) =>
                    updateCustomer("name", e.target.value)
                  }
                  placeholder="Ex: Popescu Andrei"
                />
              </label>
              <label>
                Email
                <input
                  className={styles.input}
                  value={customer.email}
                  onChange={(e) =>
                    updateCustomer("email", e.target.value)
                  }
                  placeholder="client@exemplu.ro"
                />
              </label>
              <label>
                Telefon
                <input
                  className={styles.input}
                  value={customer.phone}
                  onChange={(e) =>
                    updateCustomer("phone", e.target.value)
                  }
                  placeholder="07xx xxx xxx"
                />
              </label>
            </div>
          </fieldset>

          {/* Adresă livrare */}
<fieldset className={styles.fieldset}>
  <legend>Adresă livrare</legend>

  <div className={styles.addressBlock}>
    <label className={styles.fullSpan}>
      Adresă completă (stradă, nr, bloc, scară, ap.) *
      <textarea
        className={styles.textarea}
        value={address.street}
        onChange={(e) => updateAddress("street", e.target.value)}
        placeholder="Ex: Str. Lalelelor nr. 10, bl. A3, sc. 2, ap. 14"
        rows={3}
      />
      <span className={styles.hint}>
        Recomandat: scrie adresa exact cum vrei să apară pe eticheta de livrare.
      </span>
    </label>

    <div className={styles.grid3}>
      <label>
        Oraș *
        <input
          className={styles.input}
          value={address.city}
          onChange={(e) => updateAddress("city", e.target.value)}
          placeholder="Ex: București"
        />
      </label>

      <label>
        Județ / Sector *
        <input
          className={styles.input}
          value={address.county}
          onChange={(e) => updateAddress("county", e.target.value)}
          placeholder="Ex: Sector 3 / Cluj"
        />
      </label>

      <label>
        Cod poștal
        <input
          className={styles.input}
          value={address.postalCode}
          onChange={(e) => updateAddress("postalCode", e.target.value)}
          placeholder="Ex: 030123"
        />
      </label>
    </div>
  </div>
</fieldset>

          {/* Produse */}
          <fieldset className={styles.fieldset}>
            <legend>Produse</legend>
            <div
              className={styles.tableWrap}
              style={{ maxHeight: 220 }}
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Produs / serviciu</th>
                    <th>Cant.</th>
                    <th>Preț unitar (RON)</th>
                    <th>Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const lineTotal =
                      Number(it.qty || 0) *
                      Number(it.price || 0);
                    return (
                      <tr key={idx}>
                        <td>
                          <input
                            className={styles.input}
                            value={it.title}
                            onChange={(e) =>
                              updateItem(
                                idx,
                                "title",
                                e.target.value
                              )
                            }
                            placeholder="Ex: Aranjament floral"
                          />
                        </td>
                        <td>
                          <input
                            className={styles.input}
                            type="number"
                            min={1}
                            value={it.qty}
                            onChange={(e) =>
                              updateItem(
                                idx,
                                "qty",
                                e.target.value
                              )
                            }
                          />
                        </td>
                        <td>
                          <input
                            className={styles.input}
                            type="number"
                            step="0.01"
                            min={0}
                            value={it.price}
                            onChange={(e) =>
                              updateItem(
                                idx,
                                "price",
                                e.target.value
                              )
                            }
                          />
                        </td>
                        <td>{formatMoney(lineTotal)}</td>
                        <td>
                          {items.length > 1 && (
                            <button
                              type="button"
                              className={styles.iconBtn}
                              onClick={() => removeItem(idx)}
                              title="Șterge produsul"
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className={styles.secondaryBtn}
              style={{ marginTop: 8 }}
              onClick={addItem}
            >
              + Adaugă produs
            </button>
          </fieldset>

          {/* Plată + totaluri */}
          <fieldset className={styles.fieldset}>
            <legend>Plată & total</legend>
            <div className={styles.grid3}>
              <label>
                Preț transport (RON)
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  min={0}
                  value={shippingPrice}
                  onChange={(e) =>
                    setShippingPrice(
                      Number(e.target.value) || 0
                    )
                  }
                />
              </label>
              <label>
                Metodă plată
                <select
                  className={styles.select}
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(e.target.value)
                  }
                >
                  <option value="COD">
                    Plată la livrare (ramburs)
                  </option>
                  <option value="CARD">
                    Card / transfer
                  </option>
                </select>
              </label>
              
            </div>

            <div
              style={{
                marginTop: 12,
                textAlign: "right",
              }}
            >
              <div>
                Subtotal:{" "}
                <strong>
                  {formatMoney(totals.subtotal)}
                </strong>
              </div>
              <div>
                Transport:{" "}
                <strong>
                  {formatMoney(totals.shipping)}
                </strong>
              </div>
              <div>
                Total comandă:{" "}
                <strong>
                  {formatMoney(totals.total)}
                </strong>
              </div>
            </div>
          </fieldset>

          {err && <p className={styles.error}>{err}</p>}

          <p className={styles.muted}>
            După salvare, comanda va apărea în lista de comenzi primite și o vei
            putea prelucra (curier, factură, mesaje) la fel ca pe cele din
            platformă.
          </p>
        </div>

        <div className={styles.modalActions}>
          <button
            className={styles.secondaryBtn}
            onClick={onClose}
            disabled={saving}
          >
            Anulează
          </button>
          <button
            className={styles.primaryBtn}
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2
                  size={16}
                  className={styles.spin}
                />{" "}
                Se salvează…
              </>
            ) : (
              "Salvează comanda"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
