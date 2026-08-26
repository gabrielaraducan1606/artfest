import { useEffect, useMemo, useState } from "react";
import styles from "./CampaignsTab.module.css";

const EMPTY_FORM = {
  name: "",
  discountPercent: "0",
  productsScope: "all",
  selectedProductIds: [],
  startsAt: "",
  endsAt: "",
};

function money(value) {
  const number = Number(value || 0);

  return new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(number) ? number : 0);
}

function toDateTimeLocal(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (part) => String(part).padStart(2, "0");

  return [
    date.getFullYear(),
    "-",
    pad(date.getMonth() + 1),
    "-",
    pad(date.getDate()),
    "T",
    pad(date.getHours()),
    ":",
    pad(date.getMinutes()),
  ].join("");
}

async function campaignRequest(path = "", options = {}) {
  const response = await fetch(`/api/vendor/campaigns${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message || data?.error || "Operațiunea nu a putut fi efectuată."
    );

    error.data = data;
    throw error;
  }

  return data;
}

export default function CampaignsTab({ products = [] }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null);
  const [openingCampaignId, setOpeningCampaignId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyCampaignId, setBusyCampaignId] = useState(null);
  const [productQuery, setProductQuery] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);

  const filteredProducts = useMemo(() => {
    const query = productQuery.trim().toLowerCase();

    if (!query) {
      return products;
    }

    return products.filter((product) => {
      return [
        product?.title,
        product?.category,
        product?.store?.title,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [products, productQuery]);

  async function loadCampaigns() {
    setLoading(true);
    setError("");

    try {
      const data = await campaignRequest("/", {
        method: "GET",
      });

      setCampaigns(Array.isArray(data?.items) ? data.items : []);
    } catch (requestError) {
      console.error("[CampaignsTab] loadCampaigns:", requestError);
      setCampaigns([]);
      setError(
        requestError?.message || "Campaniile nu au putut fi încărcate."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCampaigns();
  }, []);

  function resetCampaignModal() {
    setShowCreateModal(false);
    setEditingCampaign(null);
    setProductQuery("");
    setForm(EMPTY_FORM);
  }

  function openCreateModal() {
    setEditingCampaign(null);
    setForm(EMPTY_FORM);
    setProductQuery("");
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    if (saving) {
      return;
    }

    resetCampaignModal();
  }

  async function openEditModal(campaign) {
    if (!campaign?.id || saving || openingCampaignId) {
      return;
    }

    setOpeningCampaignId(campaign.id);

    try {
      const data = await campaignRequest(
        `/${encodeURIComponent(campaign.id)}`,
        {
          method: "GET",
        }
      );

      const fullCampaign = data?.campaign;

      if (!fullCampaign?.id) {
        throw new Error("Campania nu a putut fi încărcată pentru editare.");
      }

      setEditingCampaign(fullCampaign);
      setProductQuery("");
      setForm({
        name: fullCampaign.name || "",
        discountPercent: String(fullCampaign.discountPercent ?? 0),
        productsScope:
          fullCampaign.scope === "SELECTED_PRODUCTS" ? "selected" : "all",
        selectedProductIds: Array.isArray(fullCampaign.productIds)
          ? fullCampaign.productIds
          : [],
        startsAt: toDateTimeLocal(fullCampaign.startsAt),
        endsAt: toDateTimeLocal(fullCampaign.endsAt),
      });
      setShowCreateModal(true);
    } catch (requestError) {
      console.error("[CampaignsTab] openEditModal:", requestError);
      alert(
        requestError?.message ||
          "Campania nu a putut fi încărcată pentru editare."
      );
    } finally {
      setOpeningCampaignId(null);
    }
  }

  function toggleSelectedProduct(productId) {
    setForm((current) => {
      const exists = current.selectedProductIds.includes(productId);

      return {
        ...current,
        selectedProductIds: exists
          ? current.selectedProductIds.filter((id) => id !== productId)
          : [...current.selectedProductIds, productId],
      };
    });
  }

  function selectAllVisibleProducts() {
    const visibleIds = filteredProducts.map((product) => product.id);

    setForm((current) => ({
      ...current,
      selectedProductIds: Array.from(
        new Set([...current.selectedProductIds, ...visibleIds])
      ),
    }));
  }

  function clearSelectedProducts() {
    setForm((current) => ({
      ...current,
      selectedProductIds: [],
    }));
  }

  async function saveCampaign() {
    const name = form.name.trim();

    if (!name) {
      alert("Scrie un nume pentru campanie.");
      return;
    }

    const scope =
      form.productsScope === "selected"
        ? "SELECTED_PRODUCTS"
        : "ALL_PRODUCTS";

    if (scope === "SELECTED_PRODUCTS" && !form.selectedProductIds.length) {
      alert("Selectează cel puțin un produs pentru campanie.");
      return;
    }

    if (form.startsAt && form.endsAt) {
      const start = new Date(form.startsAt);
      const end = new Date(form.endsAt);

      if (end <= start) {
        alert("Data de final trebuie să fie după data de început.");
        return;
      }
    }

    setSaving(true);

    try {
      if (editingCampaign?.id) {
        /*
         * 1. Salvăm datele generale.
         */
        await campaignRequest(
          `/${encodeURIComponent(editingCampaign.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              name,
              discountPercent: Number(form.discountPercent || 0),
              startsAt: form.startsAt || null,
              endsAt: form.endsAt || null,
            }),
          }
        );

        /*
         * 2. Salvăm separat scope-ul și produsele.
         * Backend-ul are deja endpoint dedicat pentru asta.
         */
        await campaignRequest(
          `/${encodeURIComponent(editingCampaign.id)}/products`,
          {
            method: "PUT",
            body: JSON.stringify({
              scope,
              productIds:
                scope === "SELECTED_PRODUCTS"
                  ? form.selectedProductIds
                  : [],
            }),
          }
        );
      } else {
        await campaignRequest("/", {
          method: "POST",
          body: JSON.stringify({
            name,
            discountPercent: Number(form.discountPercent || 0),
            scope,
            productIds:
              scope === "SELECTED_PRODUCTS" ? form.selectedProductIds : [],
            startsAt: form.startsAt || null,
            endsAt: form.endsAt || null,
          }),
        });
      }

      await loadCampaigns();
      resetCampaignModal();
    } catch (requestError) {
      console.error(
        editingCampaign?.id
          ? "[CampaignsTab] updateCampaign:"
          : "[CampaignsTab] createCampaign:",
        requestError
      );

      alert(
        requestError?.message ||
          (editingCampaign?.id
            ? "Campania nu a putut fi modificată."
            : "Campania nu a putut fi creată.")
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleCampaign(campaign) {
    if (!campaign?.id || busyCampaignId) {
      return;
    }

    setBusyCampaignId(campaign.id);

    try {
      const result = await campaignRequest(
        `/${encodeURIComponent(campaign.id)}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({
            active: !campaign.isActive,
          }),
        }
      );

      if (result?.campaign) {
        setCampaigns((current) =>
          current.map((item) =>
            item.id === campaign.id ? result.campaign : item
          )
        );
      } else {
        await loadCampaigns();
      }
    } catch (requestError) {
      console.error("[CampaignsTab] toggleCampaign:", requestError);
      alert(
        requestError?.message || "Statusul campaniei nu a putut fi modificat."
      );
    } finally {
      setBusyCampaignId(null);
    }
  }

  async function deleteCampaign(campaign) {
    if (!campaign?.id || busyCampaignId) {
      return;
    }

    const confirmed = window.confirm(
      `Sigur vrei să ștergi campania „${campaign.name || "Campanie"}”?`
    );

    if (!confirmed) {
      return;
    }

    setBusyCampaignId(campaign.id);

    try {
      await campaignRequest(`/${encodeURIComponent(campaign.id)}`, {
        method: "DELETE",
      });

      setCampaigns((current) =>
        current.filter((item) => item.id !== campaign.id)
      );
    } catch (requestError) {
      console.error("[CampaignsTab] deleteCampaign:", requestError);
      alert(requestError?.message || "Campania nu a putut fi ștearsă.");
    } finally {
      setBusyCampaignId(null);
    }
  }

  async function copyCampaignLink(campaign) {
    const link = `${window.location.origin}/c/${campaign.slug}`;

    try {
      await navigator.clipboard.writeText(link);
      alert("Link copiat.");
    } catch {
      window.prompt("Copiază linkul campaniei:", link);
    }
  }

  if (loading) {
    return (
      <div className={styles.stateCard}>
        <strong>Se încarcă campaniile...</strong>
        <p>Pregătim campaniile magazinului tău.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.stateCard}>
        <strong>Nu am putut încărca campaniile.</strong>
        <p>{error}</p>
        <button type="button" className={styles.secondaryBtn} onClick={loadCampaigns}>
          Încearcă din nou
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <section className={styles.sectionHeader}>
        <div>
          <span className={styles.eyebrow}>Campanii proprii</span>
          <h2>Adu-ți clienții pe Artfest</h2>
          <p>
            Creează un link propriu, distribuie-l comunității tale și beneficiază
            de comision Artfest redus pentru comenzile atribuite campaniei.
          </p>
        </div>

        <button type="button" className={styles.primaryBtn} onClick={openCreateModal}>
          + Creează campanie
        </button>
      </section>

      <section className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>Tu aduci clientul</span>
          <h3>Distribui linkul. Clientul cumpără. Comisionul tău scade.</h3>
          <p>
            Poți folosi linkul pe Instagram, Facebook, TikTok, WhatsApp sau îl
            poți trimite direct clienților tăi.
          </p>
        </div>

        <div className={styles.commissionBox}>
          <div>
            <span>Standard</span>
            <strong>12%</strong>
          </div>
          <div className={styles.commissionArrow}>→</div>
          <div>
            <span>Prin campanie</span>
            <strong>5%</strong>
          </div>
        </div>
      </section>

      {campaigns.length ? (
        <div className={styles.grid}>
          {campaigns.map((campaign) => {
            const campaignUrl = `${window.location.origin}/c/${campaign.slug}`;
            const busy = busyCampaignId === campaign.id;

            return (
              <article key={campaign.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.cardTitleWrap}>
                    <div className={styles.titleRow}>
                      <h3>{campaign.name}</h3>
                      <span
                        className={
                          campaign.isActive ? styles.activeBadge : styles.inactiveBadge
                        }
                      >
                        {campaign.isActive ? "Activă" : "Oprită"}
                      </span>
                    </div>

                    <p className={styles.linkText}>{campaignUrl}</p>
                  </div>

                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={busy}
                    onClick={() => toggleCampaign(campaign)}
                  >
                    {busy
                      ? "Se salvează..."
                      : campaign.isActive
                        ? "Oprește"
                        : "Activează"}
                  </button>
                </div>

                <div className={styles.stats}>
                  <div>
                    <span>Vizite</span>
                    <strong>{campaign.visits ?? 0}</strong>
                  </div>
                  <div>
                    <span>Comenzi</span>
                    <strong>{campaign.attributedOrdersCount ?? 0}</strong>
                  </div>
                  <div>
                    <span>Vânzări</span>
                    <strong>{money(campaign.attributedRevenue)} lei</strong>
                  </div>
                  <div>
                    <span>Comision</span>
                    <strong>{campaign.commissionPercent ?? 5}%</strong>
                  </div>
                </div>

                <div className={styles.metaRow}>
                  <span className={styles.scopeBadge}>
                    {campaign.scope === "SELECTED_PRODUCTS"
                      ? `${campaign.productsCount ?? campaign.productIds?.length ?? 0} produse selectate`
                      : "Toate produsele"}
                  </span>

                  {Number(campaign.discountPercent || 0) > 0 ? (
                    <span className={styles.discountBadge}>
                      {campaign.discountPercent}% reducere client
                    </span>
                  ) : (
                    <span className={styles.neutralBadge}>Fără reducere client</span>
                  )}
                </div>

                <div className={styles.cardFooter}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    disabled={busy || openingCampaignId === campaign.id}
                    onClick={() => openEditModal(campaign)}
                  >
                    {openingCampaignId === campaign.id
                      ? "Se deschide..."
                      : "Editează"}
                  </button>

                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => copyCampaignLink(campaign)}
                  >
                    Copiază link
                  </button>

                  <button
                    type="button"
                    className={styles.dangerLink}
                    disabled={busy}
                    onClick={() => deleteCampaign(campaign)}
                  >
                    Șterge
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyCard}>
          <div className={styles.emptyIcon}>📣</div>
          <strong>Nu ai încă nicio campanie.</strong>
          <p>
            Creează primul link de campanie și distribuie-l comunității tale.
          </p>
          <button type="button" className={styles.primaryBtn} onClick={openCreateModal}>
            Creează prima campanie
          </button>
        </div>
      )}

      {showCreateModal && (
        <div
          className={styles.modalOverlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeCreateModal();
            }
          }}
        >
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div>
                <span className={styles.eyebrow}>
                  {editingCampaign ? "Editează campania" : "Campanie nouă"}
                </span>
                <h2>
                  {editingCampaign
                    ? "Modifică setările campaniei"
                    : "Creează un link pentru comunitatea ta"}
                </h2>
                <p>
                  Comisionul redus este stabilit de Artfest. Tu alegi numele,
                  produsele, perioada și eventuala reducere pentru client.
                </p>
              </div>

              <button
                type="button"
                className={styles.closeBtn}
                onClick={closeCreateModal}
                aria-label="Închide"
              >
                ×
              </button>
            </div>

            <div className={styles.formGrid}>
              <label className={styles.formGroup}>
                <span>Numele campaniei</span>
                <input
                  className={styles.input}
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Ex: Instagram august"
                  maxLength={160}
                />
              </label>

              <label className={styles.formGroup}>
                <span>Reducere pentru client</span>
                <select
                  className={styles.select}
                  value={form.discountPercent}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      discountPercent: event.target.value,
                    }))
                  }
                >
                  <option value="0">Fără reducere</option>
                  <option value="5">5%</option>
                  <option value="10">10%</option>
                  <option value="15">15%</option>
                </select>
              </label>

              <label className={`${styles.formGroup} ${styles.fullWidth}`}>
                <span>Produsele campaniei</span>
                <select
                  className={styles.select}
                  value={form.productsScope}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      productsScope: event.target.value,
                      selectedProductIds:
                        event.target.value === "all"
                          ? []
                          : current.selectedProductIds,
                    }))
                  }
                >
                  <option value="all">Toate produsele</option>
                  <option value="selected">Doar produse selectate</option>
                </select>
              </label>

              {form.productsScope === "selected" && (
                <div className={`${styles.productPicker} ${styles.fullWidth}`}>
                  <div className={styles.productPickerTop}>
                    <div>
                      <strong>Selectează produsele</strong>
                      <span>
                        {form.selectedProductIds.length} selectate din {products.length}
                      </span>
                    </div>

                    <div className={styles.productPickerActions}>
                      <button type="button" onClick={selectAllVisibleProducts}>
                        Selectează vizibile
                      </button>
                      <button type="button" onClick={clearSelectedProducts}>
                        Golește
                      </button>
                    </div>
                  </div>

                  <input
                    className={styles.input}
                    value={productQuery}
                    onChange={(event) => setProductQuery(event.target.value)}
                    placeholder="Caută produs..."
                  />

                  <div className={styles.productList}>
                    {filteredProducts.length ? (
                      filteredProducts.map((product) => {
                        const selected = form.selectedProductIds.includes(product.id);

                        return (
                          <label key={product.id} className={styles.productOption}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleSelectedProduct(product.id)}
                            />

                            <div className={styles.productThumb}>
                              {product.image ? (
                                <img src={product.image} alt="" />
                              ) : (
                                <span>📦</span>
                              )}
                            </div>

                            <div className={styles.productOptionText}>
                              <strong>{product.title}</strong>
                              <span>
                                {product.category || "Fără categorie"}
                                {product.store?.title
                                  ? ` · ${product.store.title}`
                                  : ""}
                              </span>
                            </div>
                          </label>
                        );
                      })
                    ) : (
                      <div className={styles.noProducts}>Nu am găsit produse.</div>
                    )}
                  </div>
                </div>
              )}

              <label className={styles.formGroup}>
                <span>Începe la</span>
                <input
                  type="datetime-local"
                  className={styles.input}
                  value={form.startsAt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      startsAt: event.target.value,
                    }))
                  }
                />
                <small>Opțional. Dacă lași gol, campania poate începe imediat.</small>
              </label>

              <label className={styles.formGroup}>
                <span>Se termină la</span>
                <input
                  type="datetime-local"
                  className={styles.input}
                  value={form.endsAt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      endsAt: event.target.value,
                    }))
                  }
                />
                <small>Opțional. Poți opri campania și manual oricând.</small>
              </label>
            </div>

            <div className={styles.commissionNotice}>
              <span>💡</span>
              <div>
                <strong>Comision Artfest redus</strong>
                <p>
                  Pentru comenzile atribuite campaniei se aplică 5% în loc de
                  12%. Vendorul nu poate modifica acest procent.
                </p>
              </div>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={closeCreateModal}
                disabled={saving}
              >
                Anulează
              </button>

              <button
                type="button"
                className={styles.primaryBtn}
                onClick={saveCampaign}
                disabled={saving}
              >
                {saving
                  ? editingCampaign
                    ? "Se salvează..."
                    : "Se creează..."
                  : editingCampaign
                    ? "Salvează modificările"
                    : "Creează campania"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}