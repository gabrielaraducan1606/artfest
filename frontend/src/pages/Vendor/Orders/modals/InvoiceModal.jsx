// frontend/src/pages/Vendor/Orders/modals/InvoiceModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Loader2, FileText, Send } from "lucide-react";
import { api } from "../../../../lib/api";
import styles from "../Orders.module.css";

/* Utils */
function formatMoney(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency: "RON",
  }).format(v);
}

function computeTotals(invoice) {
  const lines = invoice?.lines || [];
  let baseTotal = 0;
  let vatTotal = 0;

  lines.forEach((ln) => {
    const qty = Number(ln.qty || 0);
    const price = Number(ln.unitPrice || 0);
    const vatRate = Number(ln.vatRate || 0);
    const base = qty * price;
    const vat = (base * vatRate) / 100;
    baseTotal += base;
    vatTotal += vat;
  });

  return {
    baseTotal,
    vatTotal,
    grandTotal: baseTotal + vatTotal,
  };
}

export default function InvoiceModal({ order, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [invoice, setInvoice] = useState(null);

  useEffect(() => {
    if (!order) return;
    let alive = true;

    async function loadInvoice() {
      setLoading(true);
      setErr("");

      try {
        const res = await api(`/api/vendor/orders/${order.id}/invoice`, {
          method: "GET",
        });

        const addr = order.address || {};
        const isCompany = !!(addr.companyName || addr.companyCui);
        const defaultLegalType = isCompany ? "PJ" : "PF";

        if (res?.invoice) {
          const inv = res.invoice;
          const prevCustomer = inv.customer || {};
          const legalType = prevCustomer.legalType || defaultLegalType;

          const resolvedName = isCompany
            ? addr.companyName ||
              prevCustomer.name ||
              addr.name ||
              order.customerName ||
              ""
            : prevCustomer.name || addr.name || order.customerName || "";

          if (!alive) return;

          setInvoice({
            ...inv,
            customer: {
              ...prevCustomer,
              legalType,
              name: resolvedName,
              companyCui: prevCustomer.companyCui || addr.companyCui || "",
              companyRegCom: prevCustomer.companyRegCom || addr.companyRegCom || "",
              address:
                prevCustomer.address ||
                addr.address ||
                [addr.street, addr.city, addr.county, addr.postalCode]
                  .filter(Boolean)
                  .join(", "),
            },
          });
        } else {
          const baseCustomerAddress =
            addr.address ||
            [addr.street, addr.city, addr.county, addr.postalCode]
              .filter(Boolean)
              .join(", ");

          const legalType = defaultLegalType;

          if (!alive) return;

          setInvoice({
            series: "FA",
            number: "",
            issueDate: new Date().toISOString().slice(0, 10),
            dueDate: new Date().toISOString().slice(0, 10),
            currency: "RON",
            vendor: {
              name: order.vendorName || "",
              cui: order.vendorCui || "",
              regCom: order.vendorRegCom || "",
              address: order.vendorAddress || "",
              iban: order.vendorIban || "",
              bank: order.vendorBank || "",
            },
            customer: {
              legalType,
              name:
                (isCompany && (addr.companyName || addr.name)) ||
                addr.name ||
                order.customerName ||
                "",
              email: order.customerEmail || addr.email || "",
              phone: order.customerPhone || addr.phone || "",
              companyCui: addr.companyCui || "",
              companyRegCom: addr.companyRegCom || "",
              address: baseCustomerAddress,
            },
            lines: Array.isArray(order.items)
              ? order.items.map((it) => ({
                  description: it.title,
                  qty: it.qty || 1,
                  unitPrice: it.price || 0,
                  vatRate: 19,
                }))
              : [
                  {
                    description: "Produse comandă",
                    qty: 1,
                    unitPrice: order.total || 0,
                    vatRate: 19,
                  },
                ],
            notes: "",
          });
        }
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Nu am putut încărca draftul de factură.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadInvoice();
    return () => {
      alive = false;
    };
  }, [order]);

  const totals = useMemo(() => (invoice ? computeTotals(invoice) : null), [invoice]);
  const legalType = invoice?.customer?.legalType || "PF";

  if (!order) return null;

  function updateHeaderField(field, value) {
    setInvoice((prev) => ({ ...prev, [field]: value }));
  }

  function updateCustomerField(field, value) {
    setInvoice((prev) => ({
      ...prev,
      customer: { ...(prev.customer || {}), [field]: value },
    }));
  }

  function updateLine(index, field, value) {
    setInvoice((prev) => {
      const lines = Array.from(prev.lines || []);
      const line = { ...(lines[index] || {}) };

      if (field === "qty" || field === "unitPrice" || field === "vatRate") {
        line[field] = Number(value) || 0;
      } else {
        line[field] = value;
      }

      lines[index] = line;
      return { ...prev, lines };
    });
  }

  function addLine() {
    setInvoice((prev) => ({
      ...prev,
      lines: [
        ...(prev.lines || []),
        {
          description: "",
          qty: 1,
          unitPrice: 0,
          vatRate: 19,
        },
      ],
    }));
  }

  function removeLine(index) {
    setInvoice((prev) => ({
      ...prev,
      lines: (prev.lines || []).filter((_, i) => i !== index),
    }));
  }

  async function handleSaveAndSend() {
    if (!invoice) return;
    setSaving(true);
    setErr("");

    try {
      const res = await api(`/api/vendor/orders/${order.id}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice, sendEmail: true }),
      });

      if (res?.pdfUrl) {
        window.open(res.pdfUrl, "_blank");
      }

      onSaved?.(order.id);
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Nu am putut salva sau trimite factura.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} role="dialog" aria-modal="true">
      <div className={`${styles.modal} ${styles.invoiceModal}`}>
        <div className={styles.modalHead}>
          <h3>
            Factură pentru comanda{" "}
            <code>{order.orderNumber || order.shortId || order.id}</code>
          </h3>
          <button className={styles.iconBtn} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </div>

        <div className={styles.modalBody}>
          {loading && (
            <div style={{ padding: 16 }}>
              <Loader2 size={16} className={styles.spin} /> Se încarcă draftul de factură…
            </div>
          )}

          {!loading && invoice && (
            <>
              <fieldset className={styles.fieldset}>
                <legend>Detalii factură</legend>

                <div className={styles.grid3}>
                  <label>
                    Serie
                    <input
                      className={styles.input}
                      value={invoice.series || ""}
                      onChange={(e) => updateHeaderField("series", e.target.value)}
                    />
                  </label>

                  <label>
                    Număr
                    <input
                      className={styles.input}
                      value={invoice.number || ""}
                      onChange={(e) => updateHeaderField("number", e.target.value)}
                    />
                  </label>

                  <label>
                    Dată emitere
                    <input
                      type="date"
                      className={styles.input}
                      value={invoice.issueDate || new Date().toISOString().slice(0, 10)}
                      onChange={(e) => updateHeaderField("issueDate", e.target.value)}
                    />
                  </label>
                </div>

                <div className={styles.grid3}>
                  <label>
                    Dată scadență
                    <input
                      type="date"
                      className={styles.input}
                      value={
                        invoice.dueDate ||
                        invoice.issueDate ||
                        new Date().toISOString().slice(0, 10)
                      }
                      onChange={(e) => updateHeaderField("dueDate", e.target.value)}
                    />
                  </label>

                  <label>
                    Monedă
                    <input
                      className={styles.input}
                      value={invoice.currency || "RON"}
                      onChange={(e) => updateHeaderField("currency", e.target.value)}
                    />
                  </label>

                  <label>
                    Notă pe factură (opțional)
                    <input
                      className={styles.input}
                      value={invoice.notes || ""}
                      onChange={(e) => updateHeaderField("notes", e.target.value)}
                      placeholder="Ex: Vă mulțumim pentru comandă!"
                    />
                  </label>
                </div>

                <p className={styles.invoiceHint}>
                  <strong>Notă:</strong> Dacă lași câmpul <strong>Număr</strong> gol,
                  platforma va genera automat următorul număr de factură, pe baza
                  ultimei facturi emise.
                </p>
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend>Client</legend>

                <div className={styles.grid3}>
                  <label>
                    Tip client
                    <select
                      className={styles.select}
                      value={legalType}
                      onChange={(e) => updateCustomerField("legalType", e.target.value)}
                    >
                      <option value="PF">Persoană fizică</option>
                      <option value="PJ">Persoană juridică</option>
                    </select>
                  </label>
                </div>

                <div className={styles.grid3}>
                  <label>
                    {legalType === "PJ" ? "Denumire firmă" : "Nume și prenume"}
                    <input
                      className={styles.input}
                      value={invoice.customer?.name || ""}
                      onChange={(e) => updateCustomerField("name", e.target.value)}
                    />
                  </label>

                  <label>
                    Email
                    <input
                      className={styles.input}
                      value={invoice.customer?.email || ""}
                      onChange={(e) => updateCustomerField("email", e.target.value)}
                    />
                  </label>

                  <label>
                    Telefon
                    <input
                      className={styles.input}
                      value={invoice.customer?.phone || ""}
                      onChange={(e) => updateCustomerField("phone", e.target.value)}
                    />
                  </label>
                </div>

                {legalType === "PJ" && (
                  <div className={styles.grid3}>
                    <label>
                      CUI
                      <input
                        className={styles.input}
                        value={invoice.customer?.companyCui || ""}
                        onChange={(e) => updateCustomerField("companyCui", e.target.value)}
                      />
                    </label>

                    <label>
                      Nr. Reg. Com.
                      <input
                        className={styles.input}
                        value={invoice.customer?.companyRegCom || ""}
                        onChange={(e) =>
                          updateCustomerField("companyRegCom", e.target.value)
                        }
                      />
                    </label>

                    <div />
                  </div>
                )}

                <label>
                  Adresă
                  <input
                    className={styles.input}
                    value={invoice.customer?.address || ""}
                    onChange={(e) => updateCustomerField("address", e.target.value)}
                    placeholder={
                      legalType === "PJ"
                        ? "Adresă sediu (stradă, oraș, județ, cod poștal)"
                        : "Adresă livrare / domiciliu"
                    }
                  />
                </label>
              </fieldset>

              <fieldset className={styles.fieldset}>
                <legend>Produse / Servicii</legend>

                <div className={styles.tableWrap} style={{ maxHeight: 260 }}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Descriere</th>
                        <th>Cant.</th>
                        <th>Preț unitar</th>
                        <th>TVA %</th>
                        <th>Total (cu TVA)</th>
                        <th></th>
                      </tr>
                    </thead>

                    <tbody>
                      {(invoice.lines || []).map((ln, idx) => {
                        const qty = Number(ln.qty || 0);
                        const unit = Number(ln.unitPrice || 0);
                        const vatRate = Number(ln.vatRate || 0);
                        const base = qty * unit;
                        const vat = (base * vatRate) / 100;
                        const total = base + vat;

                        return (
                          <tr key={idx}>
                            <td>
                              <input
                                className={styles.input}
                                value={ln.description || ""}
                                onChange={(e) => updateLine(idx, "description", e.target.value)}
                              />
                            </td>

                            <td>
                              <input
                                className={styles.input}
                                type="number"
                                min={0}
                                value={ln.qty ?? 0}
                                onChange={(e) => updateLine(idx, "qty", e.target.value)}
                              />
                            </td>

                            <td>
                              <input
                                className={styles.input}
                                type="number"
                                step="0.01"
                                min={0}
                                value={ln.unitPrice ?? 0}
                                onChange={(e) => updateLine(idx, "unitPrice", e.target.value)}
                              />
                            </td>

                            <td>
                              <input
                                className={styles.input}
                                type="number"
                                step="0.1"
                                min={0}
                                value={ln.vatRate ?? 0}
                                onChange={(e) => updateLine(idx, "vatRate", e.target.value)}
                              />
                            </td>

                            <td>{formatMoney(total)}</td>

                            <td>
                              <button
                                type="button"
                                className={styles.iconBtn}
                                onClick={() => removeLine(idx)}
                                title="Șterge linia"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {(!invoice.lines || invoice.lines.length === 0) && (
                        <tr>
                          <td colSpan={6} className={styles.emptyCell}>
                            Nu există linii. Adaugă cel puțin una.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <button
                  type="button"
                  className={styles.secondaryBtn}
                  style={{ marginTop: 8 }}
                  onClick={addLine}
                >
                  + Adaugă linie
                </button>
              </fieldset>

              {totals && (
                <div className={styles.fieldset} style={{ border: "none" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <div>
                        Bază (fără TVA): <strong>{formatMoney(totals.baseTotal)}</strong>
                      </div>
                      <div>
                        TVA total: <strong>{formatMoney(totals.vatTotal)}</strong>
                      </div>
                      <div>
                        Total de plată: <strong>{formatMoney(totals.grandTotal)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {err && <p className={styles.error}>{err}</p>}
        </div>

        <div className={styles.modalActions}>
          <button className={styles.secondaryBtn} onClick={onClose} disabled={saving}>
            Închide
          </button>

          <button
            className={styles.primaryBtn}
            onClick={handleSaveAndSend}
            disabled={saving || loading || !invoice}
            title="Salvează și trimite factura"
          >
            {saving ? (
              <>
                <Loader2 size={16} className={styles.spin} /> Se salvează & trimite…
              </>
            ) : (
              <>
                <Send size={16} /> Salvează & trimite factura
              </>
            )}
          </button>
        </div>

        <p className={styles.muted}>
          La salvare, factura va fi generată și trimisă pe email clientului (dacă backend-ul este configurat astfel).
        </p>
      </div>
    </div>
  );
}
