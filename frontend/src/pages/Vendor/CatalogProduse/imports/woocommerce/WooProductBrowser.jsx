import { useEffect, useId, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ImageOff, Loader2, RefreshCw } from "lucide-react";

import styles from "./WooCommerceImport.module.css";
import { errorMessage, productSummary } from "./wooImportLogic.js";
import { wooApi } from "./wooApi.js";

const PER_PAGE = 20;

function ProductRow({ item, checked, onToggle }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const summary = productSummary(item);

  return (
    <li className={`${styles.productRow} ${checked ? styles.productRowSelected : ""} ${!summary.importable ? styles.productRowDim : ""}`}>
      <div className={styles.productMain}>
        <span className={styles.checkCell}>
          <input
            id={`${id}-check`}
            type="checkbox"
            className={styles.checkbox}
            checked={checked}
            disabled={!summary.importable}
            onChange={() => onToggle(item)}
            aria-describedby={`${id}-state`}
          />
        </span>

        <label htmlFor={`${id}-check`} className={styles.thumb}>
          {item.image ? (
            <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <ImageOff size={20} aria-hidden="true" />
          )}
        </label>

        <div className={styles.productText}>
          <label htmlFor={`${id}-check`} className={styles.productTitle}>
            {item.title}
          </label>
          <div className={styles.productMeta}>
            {item.sku && <span>SKU {item.sku}</span>}
            <span>{summary.priceLabel}</span>
            <span>{summary.stockLabel}</span>
            <span>{summary.availabilityLabel}</span>
            <span>{summary.shippingLabel}</span>
          </div>
          <div id={`${id}-state`} className={styles.badges}>
            {summary.imported && (
              <span className={`${styles.badge} ${styles.tone_success}`}>
                <CheckCircle2 size={13} /> Deja importat
              </span>
            )}
            {!summary.imported && summary.blocked.length > 0 && (
              <span className={`${styles.badge} ${styles.tone_error}`}>Nu poate fi importat</span>
            )}
            {summary.importable && summary.needsConfirmation && (
              <span className={`${styles.badge} ${styles.tone_warning}`}>Necesită confirmări</span>
            )}
            {summary.isVariable && <span className={styles.badge}>{summary.variants.length} variante</span>}
          </div>
        </div>

        <button
          type="button"
          className={styles.iconBtn}
          aria-expanded={open}
          aria-controls={`${id}-details`}
          aria-label={open ? `Ascunde detaliile pentru ${item.title}` : `Vezi detaliile pentru ${item.title}`}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronDown size={18} className={open ? styles.chevronOpen : ""} />
        </button>
      </div>

      {open && (
        <div id={`${id}-details`} className={styles.productDetails}>
          {summary.blocked.map((reason) => (
            <p key={reason} className={styles.fieldError}>
              {reason}
            </p>
          ))}
          {summary.warnings.map((w) => (
            <p key={w} className={styles.warningLine}>
              <AlertTriangle size={14} /> {w}
            </p>
          ))}
          {item.plan.product.description && <p className={styles.description}>{item.plan.product.description.slice(0, 400)}</p>}
          <p className={styles.muted}>{item.plan.product.images.length} imagini vor fi copiate pe Artfest.</p>
          {summary.shippingSourceLabel && (
            <p className={styles.muted}>
              {summary.shippingLabel} ({summary.shippingSourceLabel})
            </p>
          )}
          {summary.variants.length > 0 && (
            <ul className={styles.variantList} aria-label={`Variantele produsului ${item.title}`}>
              {summary.variants.map((v) => (
                <li key={v.id}>
                  <span className={styles.variantName}>
                    {v.label}
                    {v.sku && <small>{v.sku}</small>}
                  </span>
                  <span>{v.priceLabel}</span>
                  <span>{v.stockLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Catalogul WooCommerce paginat, cu selecție păstrată între pagini.
 * selected: Map(externalProductId -> item din previzualizare)
 */
export default function WooProductBrowser({ connection, selected, onToggle, onSetMany, onContinue, refreshKey }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    wooApi
      .products(connection.id, { page, perPage: PER_PAGE })
      .then((d) => {
        if (!alive) return;
        setData(d);
        // planurile proaspete înlocuiesc selecția veche a acelorași produse
        onSetMany(d.items, null);
      })
      .catch((err) => alive && setError(errorMessage(err.code, err.message)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, page, reload, refreshKey]);

  const items = data?.items || [];
  const importable = items.filter((i) => productSummary(i).importable);
  const allOnPage = importable.length > 0 && importable.every((i) => selected.has(i.externalProductId));
  const totalPages = data?.totalPages || 1;

  return (
    <section className={styles.panel} aria-labelledby="woo-products-title" aria-busy={loading}>
      <div className={styles.browserHead}>
        <div>
          <h3 id="woo-products-title">Produsele din WooCommerce</h3>
          <p className={styles.muted}>
            {data ? `${data.total} produse în magazin` : "Se încarcă produsele…"} · selecția se păstrează între pagini
          </p>
        </div>
        <label className={styles.selectAll}>
          <input
            type="checkbox"
            className={styles.checkbox}
            checked={allOnPage}
            disabled={loading || !importable.length}
            onChange={() => onSetMany(importable, !allOnPage)}
          />
          Selectează pagina
        </label>
      </div>

      {error && (
        <div className={styles.alertError} role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Produsele nu au putut fi încărcate</strong>
            <p>{error}</p>
          </div>
          <button type="button" className={styles.secondaryBtn} onClick={() => setReload((n) => n + 1)}>
            <RefreshCw size={16} /> Reîncearcă
          </button>
        </div>
      )}

      {loading && !data && (
        <ul className={styles.productList} aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className={`${styles.productRow} ${styles.skeleton}`} />
          ))}
        </ul>
      )}

      {data && !items.length && !error && <p className={styles.empty}>Magazinul nu are produse publicate.</p>}

      {data && items.length > 0 && (
        <ul className={`${styles.productList} ${loading ? styles.loadingList : ""}`}>
          {items.map((item) => (
            <ProductRow key={item.externalProductId} item={item} checked={selected.has(item.externalProductId)} onToggle={onToggle} />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className={styles.pagination} aria-label="Paginile catalogului WooCommerce">
          <button type="button" className={styles.secondaryBtn} disabled={loading || page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ArrowLeft size={16} /> <span className={styles.hideXs}>Înapoi</span>
          </button>
          <span aria-live="polite">
            {loading && <Loader2 size={15} className={styles.spin} />} Pagina {page} din {totalPages}
          </span>
          <button type="button" className={styles.secondaryBtn} disabled={loading || page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            <span className={styles.hideXs}>Înainte</span> <ArrowRight size={16} />
          </button>
        </nav>
      )}

      <div className={styles.stickyBar} role="region" aria-label="Selecția pentru import">
        <span aria-live="polite">
          <strong>{selected.size}</strong> {selected.size === 1 ? "produs selectat" : "produse selectate"}
        </span>
        <div className={styles.stickyActions}>
          {selected.size > 0 && (
            <button type="button" className={styles.linkBtn} onClick={() => onSetMany([...selected.values()], false)}>
              Golește
            </button>
          )}
          <button type="button" className={styles.primaryBtn} disabled={!selected.size} onClick={onContinue}>
            Verifică și importă <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}
