// Importul WooCommerce din Catalog -> Importuri: conectare, setări,
// catalogul magazinului, confirmări și import pe loturi.
// Afișat doar când backend-ul are integrarea pornită
// (EXTERNAL_INTEGRATIONS_ENABLED); altfel CatalogImports arată „În curând”.

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, Package, Settings2 } from "lucide-react";

import styles from "./WooCommerceImport.module.css";
import WooConnectForm from "./WooConnectForm.jsx";
import { WooConnectionCard, WooSyncSettings } from "./WooConnectionPanel.jsx";
import WooImportReview from "./WooImportReview.jsx";
import WooProductBrowser from "./WooProductBrowser.jsx";
import { errorMessage, productSummary } from "./wooImportLogic.js";
import { wooApi } from "./wooApi.js";

export default function WooCommerceImport({ services, serviceId, onServiceChange, onBack, onImported }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [connection, setConnection] = useState(null);
  const [tab, setTab] = useState("products");
  const [view, setView] = useState("browse");
  const [selected, setSelected] = useState(() => new Map());
  const [answersById, setAnswersById] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [connectedNotice, setConnectedNotice] = useState("");

  useEffect(() => {
    let alive = true;
    wooApi
      .overview()
      .then((data) => {
        if (!alive) return;
        const active = (data?.connections || []).find((c) => c.platform === "WOOCOMMERCE" && c.status !== "DISCONNECTED");
        setConnection(active || null);
      })
      .catch((err) => alive && setLoadError(errorMessage(err.code, err.message)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback((item) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.externalProductId)) next.delete(item.externalProductId);
      else next.set(item.externalProductId, item);
      return next;
    });
  }, []);

  /** value: true = adaugă, false = scoate, null = actualizează planurile celor deja selectate */
  const setMany = useCallback((items, value) => {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const item of items) {
        const id = item.externalProductId;
        if (value === true && productSummary(item).importable) next.set(id, item);
        else if (value === false) next.delete(id);
        else if (value === null && next.has(id)) {
          if (productSummary(item).importable) next.set(id, item);
          else next.delete(id);
        }
      }
      return next;
    });
  }, []);

  function handleDone(summary) {
    // importate / existente ies din selecție; cele eșuate rămân pentru reîncercare
    const finished = new Set(summary.results.filter((r) => r.status === "imported" || r.status === "duplicate").map((r) => r.externalProductId));
    setSelected((prev) => new Map([...prev].filter(([id]) => !finished.has(id))));
    setRefreshKey((n) => n + 1);
    if (summary.imported) onImported?.();
  }

  if (loading) {
    return (
      <div className={styles.wrap}>
        <p className={styles.muted} role="status">
          <Loader2 size={16} className={styles.spin} /> Se încarcă integrarea WooCommerce…
        </p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.topBar}>
        <button type="button" className={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={16} /> Toate sursele
        </button>
        <span className={styles.eyebrow}>WooCommerce</span>
      </div>

      {loadError && (
        <div className={styles.alertError} role="alert">
          <p>{loadError}</p>
        </div>
      )}

      {!loadError && !connection && (
        <WooConnectForm
          onConnected={(conn, warnings) => {
            setConnection(conn);
            setTab("products");
            setView("browse");
            setConnectedNotice(
              warnings.includes("currency_not_ron")
                ? "Magazinul a fost conectat, dar folosește altă monedă decât RON."
                : "Magazinul a fost conectat. Alege produsele pe care vrei să le imporți."
            );
          }}
        />
      )}

      {connection && (
        <>
          {connectedNotice && (
            <div className={styles.alertSuccess} role="status">
              <CheckCircle2 size={18} />
              <p>{connectedNotice}</p>
            </div>
          )}

          <WooConnectionCard
            connection={connection}
            onChange={setConnection}
            onDisconnected={() => {
              setConnection(null);
              setSelected(new Map());
              setAnswersById({});
              setView("browse");
              setConnectedNotice("");
            }}
          />

          <div className={styles.tabs} role="tablist" aria-label="Secțiunile magazinului WooCommerce">
            {[
              { key: "products", label: "Produse", icon: Package },
              { key: "sync", label: "Sincronizare", icon: Settings2 },
            ].map((tabItem) => {
              const TabIcon = tabItem.icon;
              const { key, label } = tabItem;
              return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`woo-tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`woo-panel-${key}`}
                className={`${styles.tab} ${tab === key ? styles.tabActive : ""}`}
                onClick={() => setTab(key)}
              >
                <TabIcon size={16} /> {label}
              </button>
              );
            })}
          </div>

          <div role="tabpanel" id={`woo-panel-${tab}`} aria-labelledby={`woo-tab-${tab}`}>
            {tab === "sync" && <WooSyncSettings connection={connection} onChange={setConnection} />}

            {tab === "products" && view === "browse" && (
              <WooProductBrowser
                connection={connection}
                selected={selected}
                onToggle={toggle}
                onSetMany={setMany}
                onContinue={() => setView("review")}
                refreshKey={refreshKey}
              />
            )}

            {tab === "products" && view === "review" && (
              <WooImportReview
                connection={connection}
                items={[...selected.values()]}
                answersById={answersById}
                setAnswersById={setAnswersById}
                services={services}
                serviceId={serviceId}
                onServiceChange={onServiceChange}
                onRemove={toggle}
                onBack={() => setView("browse")}
                onDone={handleDone}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
