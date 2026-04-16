import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api.js";
import styles from "../AdminMaintenancePage.module.css";

function fmtPrice(value, currency = "RON") {
  const num = Number(value || 0);
  try {
    return new Intl.NumberFormat("ro-RO", {
      style: "currency",
      currency: currency || "RON",
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency || "RON"}`;
  }
}

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

function ProductRow({ item, busyId, onApprove, onReject, onHideAgain }) {
  const isBusy = busyId === item.id;
  const firstImage = Array.isArray(item.images) && item.images.length ? item.images[0] : "";

  return (
    <div className={styles.listItem} style={{ alignItems: "flex-start", gap: 16 }}>
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 12,
          overflow: "hidden",
          background: "#f3f4f6",
          flex: "0 0 auto",
        }}
      >
        {firstImage ? (
          <img
            src={firstImage}
            alt={item.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              color: "#6b7280",
            }}
          >
            Fără imagine
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16 }}>{item.title || "Produs fără titlu"}</h3>
            <p className={styles.subtle} style={{ margin: "4px 0 0" }}>
              Magazin: <strong>{item.service?.profile?.displayName || "—"}</strong>
              {" • "}
              Vendor: <strong>{item.vendor?.displayName || "—"}</strong>
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700 }}>{fmtPrice(item.price, item.currency)}</div>
            <div className={styles.subtle}>{item.category || "Fără categorie"}</div>
          </div>
        </div>

        <p style={{ margin: "10px 0", lineHeight: 1.45 }}>
          {item.description?.trim() || "Fără descriere."}
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span className={styles.badge}>Slug: {item.service?.profile?.slug || "—"}</span>
          <span className={styles.badge}>Status activ: {item.isActive ? "Da" : "Nu"}</span>
          <span className={styles.badge}>Ascuns: {item.isHidden ? "Da" : "Nu"}</span>
          <span className={styles.badge}>
            Disponibilitate: {item.availability || "—"}
          </span>
          {item.color ? <span className={styles.badge}>Culoare: {item.color}</span> : null}
          {item.materialMain ? (
            <span className={styles.badge}>Material: {item.materialMain}</span>
          ) : null}
          {item.technique ? (
            <span className={styles.badge}>Tehnică: {item.technique}</span>
          ) : null}
        </div>

        <div className={styles.subtle} style={{ marginBottom: 12 }}>
          Creat la: {fmtDate(item.createdAt)}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={isBusy}
            onClick={() => onApprove(item)}
          >
            {isBusy ? "Se salvează..." : "Aprobă produsul"}
          </button>

          <button
            type="button"
            className={styles.dangerBtn}
            disabled={isBusy}
            onClick={() => onReject(item)}
          >
            {isBusy ? "Se salvează..." : "Respinge / dezactivează"}
          </button>

          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={isBusy}
            onClick={() => onHideAgain(item)}
          >
            {isBusy ? "Se salvează..." : "Lasă ascuns"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminProductsModerationTab({ onActionDone }) {
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({
    q: "",
    storeSlug: "",
    onlyHidden: true,
    onlyInactive: false,
  });

  const loadItems = async () => {
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const params = new URLSearchParams();
      params.set("take", "100");
      params.set("sort", "new");

      if (filters.q.trim()) params.set("q", filters.q.trim());
      if (filters.storeSlug.trim()) params.set("storeSlug", filters.storeSlug.trim());

      if (filters.onlyHidden) params.set("isHidden", "true");
      if (filters.onlyInactive) params.set("isActive", "false");

      const d = await api(`/api/admin/products?${params.toString()}`);
      setItems(Array.isArray(d?.items) ? d.items : []);
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut încărca produsele pentru moderare.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingCount = useMemo(
    () => items.filter((x) => x.isHidden === true).length,
    [items]
  );

  const patchModeration = async (id, payload, successText) => {
    setActionId(id);
    setError("");
    setMessage("");

    try {
      await api(`/api/admin/products/${id}/moderation`, {
        method: "PATCH",
        body: payload,
      });

      setMessage(successText);
      await loadItems();
      await onActionDone?.();
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.message ||
        "Nu am putut salva acțiunea de moderare.";
      setError(msg);
    } finally {
      setActionId("");
    }
  };

  const handleApprove = async (item) => {
    await patchModeration(
      item.id,
      { isHidden: false, isActive: true },
      `Produsul "${item.title}" a fost aprobat și publicat.`
    );
  };

  const handleReject = async (item) => {
    if (!window.confirm(`Sigur vrei să dezactivezi produsul "${item.title}"?`)) {
      return;
    }

    await patchModeration(
      item.id,
      { isHidden: true, isActive: false },
      `Produsul "${item.title}" a fost dezactivat.`
    );
  };

  const handleHideAgain = async (item) => {
    await patchModeration(
      item.id,
      { isHidden: true },
      `Produsul "${item.title}" a rămas ascuns.`
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <p className={styles.subtle} style={{ margin: 0 }}>
          Aici verifici produsele trimise de vendori înainte să devină vizibile în
          platformă. În varianta actuală, produsele ascunse sunt considerate în așteptare.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr auto auto auto",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <input
          className={styles.input}
          type="text"
          placeholder="Caută după titlu, descriere, vendor..."
          value={filters.q}
          onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))}
        />

        <input
          className={styles.input}
          type="text"
          placeholder="Slug magazin"
          value={filters.storeSlug}
          onChange={(e) => setFilters((s) => ({ ...s, storeSlug: e.target.value }))}
        />

        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={filters.onlyHidden}
            onChange={(e) => setFilters((s) => ({ ...s, onlyHidden: e.target.checked }))}
          />
          Doar ascunse
        </label>

        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={filters.onlyInactive}
            onChange={(e) => setFilters((s) => ({ ...s, onlyInactive: e.target.checked }))}
          />
          Doar inactive
        </label>

        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={loadItems}
          disabled={loading}
        >
          {loading ? "Se încarcă..." : "Reîncarcă"}
        </button>
      </div>

      <div style={{ marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span className={styles.badge}>Total în listă: {items.length}</span>
        <span className={styles.badge}>Ascunse: {pendingCount}</span>
      </div>

      {error ? <div className={styles.errorBox}>{error}</div> : null}
      {message ? <div className={styles.successBox}>{message}</div> : null}

      {loading ? (
        <p className={styles.subtle}>Se încarcă produsele…</p>
      ) : items.length === 0 ? (
        <p className={styles.subtle}>Nu există produse pentru moderare.</p>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {items.map((item) => (
            <ProductRow
              key={item.id}
              item={item}
              busyId={actionId}
              onApprove={handleApprove}
              onReject={handleReject}
              onHideAgain={handleHideAgain}
            />
          ))}
        </div>
      )}
    </div>
  );
}