import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./CatalogProdusePage.module.css";

const MOCK_PRODUCTS = [
  {
    id: "1",
    title: "Odorizant dulap",
    image: "",
    price: 35,
    stock: 12,
    orderMode: "OPTIONS",
    variants: "Aromă: Lavandă, Vanilie · Culoare: Alb, Roz",
    category: "Casă",
    active: true,
  },
  {
    id: "2",
    title: "Cană personalizată",
    image: "",
    price: 45,
    stock: 8,
    orderMode: "CUSTOMIZABLE",
    variants: "Text, Poză",
    category: "Cadouri",
    active: true,
  },
  {
    id: "3",
    title: "Cutie botez personalizată",
    image: "",
    price: null,
    stock: null,
    orderMode: "QUOTE_ONLY",
    variants: "Deadline, Buget, Poză inspirație",
    category: "Botez",
    active: false,
  },
];

const ORDER_MODE_LABEL = {
  DIRECT: "Cumpărare directă",
  OPTIONS: "Opțiuni",
  CUSTOMIZABLE: "Personalizabil",
  QUOTE_ONLY: "Cerere ofertă",
};

export default function CatalogProdusePage() {
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [orderModeFilter, setOrderModeFilter] = useState("all");

  const products = MOCK_PRODUCTS;

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const q = query.trim().toLowerCase();

      const matchesQuery =
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.variants.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && p.active) ||
        (statusFilter === "inactive" && !p.active);

      const matchesOrderMode =
        orderModeFilter === "all" || p.orderMode === orderModeFilter;

      return matchesQuery && matchesStatus && matchesOrderMode;
    });
  }, [products, query, statusFilter, orderModeFilter]);

  const allVisibleSelected =
    filteredProducts.length > 0 &&
    filteredProducts.every((p) => selectedIds.includes(p.id));

  function toggleSelected(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedIds((prev) =>
        prev.filter((id) => !filteredProducts.some((p) => p.id === id))
      );
    } else {
      setSelectedIds((prev) => [
        ...new Set([...prev, ...filteredProducts.map((p) => p.id)]),
      ]);
    }
  }

  function handleBulkAction(action) {
    if (!selectedIds.length) {
      alert("Selectează cel puțin un produs.");
      return;
    }

    alert(`${action} pentru ${selectedIds.length} produse - urmează implementarea.`);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Catalog produse</h1>
          <p className={styles.subtitle}>
            Administrează produsele, variantele, importurile și modificările în masă.
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => alert("Import inteligent urmează să fie implementat.")}
          >
            Import inteligent
          </button>

          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => alert("Export Excel urmează să fie implementat.")}
          >
            Export Excel
          </button>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => navigate(-1)}
          >
            + Creează produs
          </button>
        </div>
      </header>

      <section className={styles.aiBox}>
        <div>
          <h2>AI pentru catalog</h2>
          <p>
            Exemplu: „Înlocuiește aroma Vanilie cu Bumbac în toate odorizantele.”
          </p>
        </div>

        <div className={styles.aiInputRow}>
          <input
            className={styles.input}
            placeholder="Scrie ce vrei să modifici..."
          />
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => alert("AI preview urmează să fie implementat.")}
          >
            Previzualizează
          </button>
        </div>
      </section>

      <section className={styles.toolbar}>
        <input
          className={styles.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Caută produs, aromă, culoare, categorie..."
        />

        <select
          className={styles.select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">Toate statusurile</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        <select
          className={styles.select}
          value={orderModeFilter}
          onChange={(e) => setOrderModeFilter(e.target.value)}
        >
          <option value="all">Toate modurile</option>
          <option value="DIRECT">Cumpărare directă</option>
          <option value="OPTIONS">Opțiuni</option>
          <option value="CUSTOMIZABLE">Personalizabile</option>
          <option value="QUOTE_ONLY">Cerere ofertă</option>
        </select>
      </section>

      {selectedIds.length > 0 && (
        <section className={styles.bulkBar}>
          <strong>{selectedIds.length} selectate</strong>

          <button type="button" onClick={() => handleBulkAction("Activează")}>
            Activează
          </button>

          <button type="button" onClick={() => handleBulkAction("Dezactivează")}>
            Dezactivează
          </button>

          <button type="button" onClick={() => handleBulkAction("Înlocuiește variantă")}>
            Înlocuiește variantă
          </button>

          <button type="button" onClick={() => setSelectedIds([])}>
            Anulează selecția
          </button>
        </section>
      )}

      <section className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                />
              </th>
              <th>Produs</th>
              <th>Preț</th>
              <th>Stoc</th>
              <th>Mod comandă</th>
              <th>Variante / câmpuri</th>
              <th>Status</th>
              <th>Acțiuni</th>
            </tr>
          </thead>

          <tbody>
            {filteredProducts.map((product) => (
              <tr key={product.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(product.id)}
                    onChange={() => toggleSelected(product.id)}
                  />
                </td>

                <td>
                  <div className={styles.productCell}>
                    <div className={styles.productImage}>
                      {product.image ? (
                        <img src={product.image} alt={product.title} />
                      ) : (
                        "📦"
                      )}
                    </div>

                    <div>
                      <strong>{product.title}</strong>
                      <span>{product.category}</span>
                    </div>
                  </div>
                </td>

                <td>{product.price ? `${product.price} lei` : "La ofertă"}</td>
                <td>{product.stock ?? "—"}</td>
                <td>{ORDER_MODE_LABEL[product.orderMode]}</td>
                <td>{product.variants}</td>

                <td>
                  <span
                    className={
                      product.active ? styles.activeBadge : styles.inactiveBadge
                    }
                  >
                    {product.active ? "Activ" : "Inactiv"}
                  </span>
                </td>

                <td>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => alert("Editare produs urmează.")}
                  >
                    Editează
                  </button>
                </td>
              </tr>
            ))}

            {!filteredProducts.length && (
              <tr>
                <td colSpan={8} className={styles.emptyState}>
                  Nu am găsit produse pentru filtrele selectate.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}