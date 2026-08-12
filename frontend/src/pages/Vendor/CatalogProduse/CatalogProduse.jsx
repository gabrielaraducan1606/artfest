import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./CatalogProduse.module.css";
import CatalogImports from "./imports/CatalogImports.jsx";

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

const MOCK_CAMPAIGNS = [
  {
    id: "campaign-1",
    name: "Instagram august",
    slug: "instagram-august",
    active: true,
    visits: 284,
    ordersCount: 12,
    revenue: 1840,
    commissionPercent: 6,
    normalCommissionPercent: 12,
    discountPercent: 5,
  },
  {
    id: "campaign-2",
    name: "Clienți fideli",
    slug: "clienti-fideli",
    active: false,
    visits: 91,
    ordersCount: 4,
    revenue: 610,
    commissionPercent: 6,
    normalCommissionPercent: 12,
    discountPercent: 0,
  },
];

const ORDER_MODE_LABEL = {
  DIRECT: "Cumpărare directă",
  READY_TO_BUY: "Cumpărare directă",
  OPTIONS: "Opțiuni",
  CUSTOMIZABLE: "Personalizabil",
  QUOTE_ONLY: "Cerere ofertă",
};

const IMPORT_SOURCES = [
  {
    key: "excel",
    title: "Excel / CSV",
    description:
      "Încarcă un fișier cu produsele tale și verifică datele înainte de import.",
    icon: "📊",
  },
  {
    key: "easysales",
    title: "EasySales",
    description:
      "Importă produsele existente din EasySales și păstrează informațiile importante.",
    icon: "🔄",
  },
  {
    key: "shopify",
    title: "Shopify",
    description:
      "Conectează magazinul Shopify și adu produsele în catalogul Artfest.",
    icon: "🛍️",
  },
  {
    key: "woocommerce",
    title: "WooCommerce",
    description:
      "Importă produsele din magazinul tău WooCommerce.",
    icon: "🌐",
  },
];

export default function CatalogProdusePage() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("products");

  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [orderModeFilter, setOrderModeFilter] = useState("all");

  const [products, setProducts] = useState(MOCK_PRODUCTS);
  const [campaigns, setCampaigns] = useState(MOCK_CAMPAIGNS);

  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  const [aiPrompt, setAiPrompt] = useState("");

  const [campaignForm, setCampaignForm] = useState({
    name: "",
    discountPercent: "0",
    productsScope: "all",
  });

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const q = query.trim().toLowerCase();

      const matchesQuery =
        !q ||
        String(product.title || "")
          .toLowerCase()
          .includes(q) ||
        String(product.variants || "")
          .toLowerCase()
          .includes(q) ||
        String(product.category || "")
          .toLowerCase()
          .includes(q);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && product.active) ||
        (statusFilter === "inactive" && !product.active);

      const matchesOrderMode =
        orderModeFilter === "all" ||
        product.orderMode === orderModeFilter ||
        (orderModeFilter === "DIRECT" &&
          product.orderMode === "READY_TO_BUY");

      return matchesQuery && matchesStatus && matchesOrderMode;
    });
  }, [products, query, statusFilter, orderModeFilter]);

  const allVisibleSelected =
    filteredProducts.length > 0 &&
    filteredProducts.every((product) =>
      selectedIds.includes(product.id)
    );

  function toggleSelected(id) {
    setSelectedIds((prev) =>
      prev.includes(id)
        ? prev.filter((item) => item !== id)
        : [...prev, id]
    );
  }

  function toggleSelectAllVisible() {
    if (allVisibleSelected) {
      setSelectedIds((prev) =>
        prev.filter(
          (id) =>
            !filteredProducts.some(
              (product) => product.id === id
            )
        )
      );

      return;
    }

    setSelectedIds((prev) => [
      ...new Set([
        ...prev,
        ...filteredProducts.map((product) => product.id),
      ]),
    ]);
  }

  function updateSelectedProducts(active) {
    if (!selectedIds.length) return;

    setProducts((prev) =>
      prev.map((product) =>
        selectedIds.includes(product.id)
          ? {
              ...product,
              active,
            }
          : product
      )
    );

    setSelectedIds([]);
  }

  function deleteSelectedProducts() {
    if (!selectedIds.length) return;

    const confirmed = window.confirm(
      `Sigur vrei să ștergi ${selectedIds.length} produse?`
    );

    if (!confirmed) return;

    setProducts((prev) =>
      prev.filter(
        (product) => !selectedIds.includes(product.id)
      )
    );

    setSelectedIds([]);
  }

  function handleBulkAction(action) {
    if (!selectedIds.length) {
      alert("Selectează cel puțin un produs.");
      return;
    }

    if (action === "activate") {
      updateSelectedProducts(true);
      return;
    }

    if (action === "deactivate") {
      updateSelectedProducts(false);
      return;
    }

    if (action === "delete") {
      deleteSelectedProducts();
      return;
    }

    alert(
      `Acțiunea "${action}" va fi conectată ulterior la backend.`
    );
  }

  function slugify(value = "") {
    return value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function createCampaign() {
    const name = campaignForm.name.trim();

    if (!name) {
      alert("Scrie un nume pentru campanie.");
      return;
    }

    const newCampaign = {
      id: `campaign-${Date.now()}`,
      name,
      slug:
        slugify(name) ||
        `campanie-${Date.now()}`,
      active: true,
      visits: 0,
      ordersCount: 0,
      revenue: 0,
      commissionPercent: 6,
      normalCommissionPercent: 12,
      discountPercent:
        Number(campaignForm.discountPercent) || 0,
    };

    setCampaigns((prev) => [
      newCampaign,
      ...prev,
    ]);

    setCampaignForm({
      name: "",
      discountPercent: "0",
      productsScope: "all",
    });

    setShowCampaignModal(false);
  }

  function toggleCampaign(campaignId) {
    setCampaigns((prev) =>
      prev.map((campaign) =>
        campaign.id === campaignId
          ? {
              ...campaign,
              active: !campaign.active,
            }
          : campaign
      )
    );
  }

  function copyCampaignLink(campaign) {
    const link = `${window.location.origin}/c/${campaign.slug}`;

    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(link)
        .then(() => {
          alert("Link copiat.");
        })
        .catch(() => {
          alert(link);
        });

      return;
    }

    alert(link);
  }

  function handleAiPreview() {
    if (!aiPrompt.trim()) {
      alert("Scrie mai întâi ce vrei să modifici.");
      return;
    }

    alert(
      `AI va analiza cererea:\n\n"${aiPrompt}"\n\nÎn backend vom genera mai întâi un preview, fără să modificăm direct produsele.`
    );
  }

  function renderProductsTab() {
    return (
      <>
        <section className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <input
              className={styles.searchInput}
              value={query}
              onChange={(event) =>
                setQuery(event.target.value)
              }
              placeholder="Caută produs, aromă, culoare, categorie..."
            />
          </div>

          <select
            className={styles.select}
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value)
            }
          >
            <option value="all">
              Toate statusurile
            </option>
            <option value="active">
              Active
            </option>
            <option value="inactive">
              Inactive
            </option>
          </select>

          <select
            className={styles.select}
            value={orderModeFilter}
            onChange={(event) =>
              setOrderModeFilter(event.target.value)
            }
          >
            <option value="all">
              Toate modurile
            </option>

            <option value="DIRECT">
              Cumpărare directă
            </option>

            <option value="OPTIONS">
              Opțiuni
            </option>

            <option value="CUSTOMIZABLE">
              Personalizabile
            </option>

            <option value="QUOTE_ONLY">
              Cerere ofertă
            </option>
          </select>

          <button
            type="button"
            className={styles.aiBtn}
            onClick={() => setShowAiModal(true)}
          >
            ✨ Modifică prin AI
          </button>
        </section>

        {selectedIds.length > 0 && (
          <section className={styles.bulkBar}>
            <div className={styles.bulkCount}>
              <strong>
                {selectedIds.length}
              </strong>{" "}
              produse selectate
            </div>

            <div className={styles.bulkActions}>
              <button
                type="button"
                onClick={() =>
                  handleBulkAction("activate")
                }
              >
                Activează
              </button>

              <button
                type="button"
                onClick={() =>
                  handleBulkAction("deactivate")
                }
              >
                Dezactivează
              </button>

              <button
                type="button"
                onClick={() =>
                  handleBulkAction("price")
                }
              >
                Modifică preț
              </button>

              <button
                type="button"
                onClick={() =>
                  handleBulkAction("category")
                }
              >
                Schimbă categoria
              </button>

              <button
                type="button"
                onClick={() =>
                  handleBulkAction("variants")
                }
              >
                Modifică variante
              </button>

              <button
                type="button"
                className={styles.dangerBtn}
                onClick={() =>
                  handleBulkAction("delete")
                }
              >
                Șterge
              </button>

              <button
                type="button"
                onClick={() =>
                  setSelectedIds([])
                }
              >
                Anulează
              </button>
            </div>
          </section>
        )}

        <section className={styles.tableCard}>
          <div className={styles.tableHeaderInfo}>
            <div>
              <strong>
                {filteredProducts.length}
              </strong>{" "}
              produse
            </div>

            <span>
              {products.filter((p) => p.active).length} active
            </span>
          </div>

          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={
                        toggleSelectAllVisible
                      }
                    />
                  </th>

                  <th>Produs</th>
                  <th>Preț</th>
                  <th>Stoc</th>
                  <th>Mod comandă</th>
                  <th>
                    Variante / câmpuri
                  </th>
                  <th>Status</th>
                  <th>Acțiuni</th>
                </tr>
              </thead>

              <tbody>
                {filteredProducts.map(
                  (product) => (
                    <tr key={product.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(
                            product.id
                          )}
                          onChange={() =>
                            toggleSelected(
                              product.id
                            )
                          }
                        />
                      </td>

                      <td>
                        <div
                          className={
                            styles.productCell
                          }
                        >
                          <div
                            className={
                              styles.productImage
                            }
                          >
                            {product.image ? (
                              <img
                                src={
                                  product.image
                                }
                                alt={
                                  product.title
                                }
                              />
                            ) : (
                              <span>📦</span>
                            )}
                          </div>

                          <div
                            className={
                              styles.productInfo
                            }
                          >
                            <strong>
                              {product.title}
                            </strong>

                            <span>
                              {product.category}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        {product.price !==
                        null
                          ? `${product.price} lei`
                          : "La ofertă"}
                      </td>

                      <td>
                        {product.stock ?? "—"}
                      </td>

                      <td>
                        <span
                          className={
                            styles.modeBadge
                          }
                        >
                          {ORDER_MODE_LABEL[
                            product
                              .orderMode
                          ] ||
                            product.orderMode}
                        </span>
                      </td>

                      <td>
                        <div
                          className={
                            styles.variantsText
                          }
                        >
                          {product.variants ||
                            "—"}
                        </div>
                      </td>

                      <td>
                        <span
                          className={
                            product.active
                              ? styles.activeBadge
                              : styles.inactiveBadge
                          }
                        >
                          {product.active
                            ? "Activ"
                            : "Inactiv"}
                        </span>
                      </td>

                      <td>
                        <div
                          className={
                            styles.rowActions
                          }
                        >
                          <button
                            type="button"
                            className={
                              styles.linkBtn
                            }
                            onClick={() =>
                              alert(
                                `Editare produs: ${product.title}`
                              )
                            }
                          >
                            Editează
                          </button>

                          <button
                            type="button"
                            className={
                              styles.moreBtn
                            }
                            onClick={() =>
                              alert(
                                "Aici putem pune meniul cu duplicare, dezactivare și ștergere."
                              )
                            }
                          >
                            ⋯
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}

                {!filteredProducts.length && (
                  <tr>
                    <td
                      colSpan={8}
                      className={
                        styles.emptyState
                      }
                    >
                      <div>
                        <strong>
                          Nu am găsit
                          produse.
                        </strong>

                        <p>
                          Încearcă alte
                          filtre sau adaugă
                          un produs nou.
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }

  function renderCampaignsTab() {
    return (
      <div className={styles.tabContent}>
        <section
          className={styles.sectionHeader}
        >
          <div>
            <h2>
              Campanii proprii
            </h2>

            <p>
              Adu-ți clienții pe Artfest cu
              un link propriu și beneficiază
              de un comision redus pentru
              comenzile generate de tine.
            </p>
          </div>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() =>
              setShowCampaignModal(true)
            }
          >
            + Creează campanie
          </button>
        </section>

        <section
          className={styles.campaignHero}
        >
          <div>
            <span
              className={styles.eyebrow}
            >
              Adu-ți comunitatea
            </span>

            <h3>
              Tu aduci clientul, plătești
              mai puțin.
            </h3>

            <p>
              Distribuie linkul campaniei pe
              Instagram, Facebook, TikTok,
              WhatsApp sau direct clienților
              tăi.
            </p>
          </div>

          <div
            className={
              styles.commissionBox
            }
          >
            <span>
              Comision standard
            </span>

            <strong>
              12%
            </strong>

            <div
              className={
                styles.commissionArrow
              }
            >
              →
            </div>

            <span>
              Prin campanie
            </span>

            <strong>
              6%
            </strong>
          </div>
        </section>

        {campaigns.length ? (
          <div
            className={
              styles.campaignGrid
            }
          >
            {campaigns.map(
              (campaign) => {
                const campaignUrl = `${window.location.origin}/c/${campaign.slug}`;

                return (
                  <article
                    key={
                      campaign.id
                    }
                    className={
                      styles.campaignCard
                    }
                  >
                    <div
                      className={
                        styles.campaignTop
                      }
                    >
                      <div>
                        <div
                          className={
                            styles.campaignTitleRow
                          }
                        >
                          <h3>
                            {
                              campaign.name
                            }
                          </h3>

                          <span
                            className={
                              campaign.active
                                ? styles.activeBadge
                                : styles.inactiveBadge
                            }
                          >
                            {campaign.active
                              ? "Activă"
                              : "Oprită"}
                          </span>
                        </div>

                        <p>
                          {campaignUrl}
                        </p>
                      </div>

                      <button
                        type="button"
                        className={
                          styles.secondaryBtn
                        }
                        onClick={() =>
                          toggleCampaign(
                            campaign.id
                          )
                        }
                      >
                        {campaign.active
                          ? "Oprește"
                          : "Activează"}
                      </button>
                    </div>

                    <div
                      className={
                        styles.campaignStats
                      }
                    >
                      <div>
                        <span>
                          Vizite
                        </span>
                        <strong>
                          {
                            campaign.visits
                          }
                        </strong>
                      </div>

                      <div>
                        <span>
                          Comenzi
                        </span>
                        <strong>
                          {
                            campaign.ordersCount
                          }
                        </strong>
                      </div>

                      <div>
                        <span>
                          Vânzări
                        </span>
                        <strong>
                          {
                            campaign.revenue
                          }{" "}
                          lei
                        </strong>
                      </div>

                      <div>
                        <span>
                          Comision
                        </span>
                        <strong>
                          {
                            campaign.commissionPercent
                          }
                          %
                        </strong>
                      </div>
                    </div>

                    <div
                      className={
                        styles.campaignFooter
                      }
                    >
                      <div>
                        {campaign.discountPercent >
                        0 ? (
                          <span
                            className={
                              styles.discountBadge
                            }
                          >
                            Clientul
                            primește{" "}
                            {
                              campaign.discountPercent
                            }
                            % reducere
                          </span>
                        ) : (
                          <span
                            className={
                              styles.neutralBadge
                            }
                          >
                            Fără reducere
                            client
                          </span>
                        )}
                      </div>

                      <div
                        className={
                          styles.campaignActions
                        }
                      >
                        <button
                          type="button"
                          className={
                            styles.secondaryBtn
                          }
                          onClick={() =>
                            copyCampaignLink(
                              campaign
                            )
                          }
                        >
                          Copiază link
                        </button>

                        <button
                          type="button"
                          className={
                            styles.linkBtn
                          }
                          onClick={() =>
                            alert(
                              "Aici vom deschide analytics-ul complet al campaniei."
                            )
                          }
                        >
                          Detalii
                        </button>
                      </div>
                    </div>
                  </article>
                );
              }
            )}
          </div>
        ) : (
          <div
            className={styles.emptyCard}
          >
            <strong>
              Nu ai încă nicio campanie.
            </strong>

            <p>
              Creează primul link și
              distribuie-l clienților tăi.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <button
            type="button"
            className={styles.backBtn}
            onClick={() => navigate(-1)}
          >
            ← Înapoi
          </button>

          <h1 className={styles.title}>
            Catalog produse
          </h1>

          <p className={styles.subtitle}>
            Administrează produsele,
            importurile și campaniile
            magazinului tău dintr-un singur
            loc.
          </p>
        </div>

        <div
          className={styles.headerActions}
        >
          <button
  type="button"
  className={styles.secondaryBtn}
  onClick={() => setActiveTab("imports")}
>
  Importă produse
</button>

          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() =>
              alert(
                "Exportul Excel va fi conectat la backend."
              )
            }
          >
            Exportă
          </button>

          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() =>
              alert(
                "Aici legăm ruta existentă pentru adăugarea produsului."
              )
            }
          >
            + Adaugă produs
          </button>
        </div>
      </header>

      <nav className={styles.tabs}>
        <button
          type="button"
          className={
            activeTab === "products"
              ? styles.activeTab
              : styles.tab
          }
          onClick={() =>
            setActiveTab("products")
          }
        >
          Produse
        </button>

        <button
          type="button"
          className={
            activeTab === "imports"
              ? styles.activeTab
              : styles.tab
          }
          onClick={() =>
            setActiveTab("imports")
          }
        >
          Importuri
        </button>

        <button
          type="button"
          className={
            activeTab === "campaigns"
              ? styles.activeTab
              : styles.tab
          }
          onClick={() =>
            setActiveTab("campaigns")
          }
        >
          Campanii
        </button>
      </nav>

      {activeTab === "products" &&
        renderProductsTab()}

      {activeTab === "imports" && <CatalogImports />}

      {activeTab === "campaigns" &&
        renderCampaignsTab()}

      {showCampaignModal && (
        <div
          className={styles.modalOverlay}
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setShowCampaignModal(false);
            }
          }}
        >
          <div
            className={
              styles.modalSmall
            }
          >
            <div
              className={
                styles.modalHeader
              }
            >
              <div>
                <h2>
                  Creează campanie
                </h2>

                <p>
                  Vei primi un link unic pe
                  care îl poți distribui.
                </p>
              </div>

              <button
                type="button"
                className={
                  styles.closeBtn
                }
                onClick={() =>
                  setShowCampaignModal(
                    false
                  )
                }
              >
                ×
              </button>
            </div>

            <div
              className={
                styles.formGroup
              }
            >
              <label>
                Numele campaniei
              </label>

              <input
                className={styles.input}
                value={
                  campaignForm.name
                }
                onChange={(event) =>
                  setCampaignForm(
                    (prev) => ({
                      ...prev,
                      name: event.target
                        .value,
                    })
                  )
                }
                placeholder="Ex: Instagram august"
              />
            </div>

            <div
              className={
                styles.formGroup
              }
            >
              <label>
                Produsele campaniei
              </label>

              <select
                className={styles.select}
                value={
                  campaignForm.productsScope
                }
                onChange={(event) =>
                  setCampaignForm(
                    (prev) => ({
                      ...prev,
                      productsScope:
                        event.target.value,
                    })
                  )
                }
              >
                <option value="all">
                  Toate produsele
                </option>

                <option value="selected">
                  Produse selectate
                </option>
              </select>
            </div>

            <div
              className={
                styles.formGroup
              }
            >
              <label>
                Reducere pentru client
              </label>

              <select
                className={styles.select}
                value={
                  campaignForm.discountPercent
                }
                onChange={(event) =>
                  setCampaignForm(
                    (prev) => ({
                      ...prev,
                      discountPercent:
                        event.target.value,
                    })
                  )
                }
              >
                <option value="0">
                  Fără reducere
                </option>

                <option value="5">
                  5%
                </option>

                <option value="10">
                  10%
                </option>

                <option value="15">
                  15%
                </option>
              </select>
            </div>

            <div
              className={
                styles.commissionNotice
              }
            >
              <span>💡</span>

              <div>
                <strong>
                  Comision redus
                </strong>

                <p>
                  Pentru comenzile atribuite
                  acestei campanii, exemplul
                  actual folosește un
                  comision Artfest de 6% în
                  loc de 12%.
                </p>
              </div>
            </div>

            <div
              className={
                styles.modalActions
              }
            >
              <button
                type="button"
                className={
                  styles.secondaryBtn
                }
                onClick={() =>
                  setShowCampaignModal(
                    false
                  )
                }
              >
                Anulează
              </button>

              <button
                type="button"
                className={
                  styles.primaryBtn
                }
                onClick={createCampaign}
              >
                Creează campania
              </button>
            </div>
          </div>
        </div>
      )}

      {showAiModal && (
        <div
          className={styles.modalOverlay}
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setShowAiModal(false);
            }
          }}
        >
          <div
            className={
              styles.modalSmall
            }
          >
            <div
              className={
                styles.modalHeader
              }
            >
              <div>
                <h2>
                  ✨ Modifică prin AI
                </h2>

                <p>
                  Spune ce vrei să schimbi
                  în catalog. Modificările
                  vor avea preview înainte
                  de aplicare.
                </p>
              </div>

              <button
                type="button"
                className={
                  styles.closeBtn
                }
                onClick={() =>
                  setShowAiModal(false)
                }
              >
                ×
              </button>
            </div>

            <textarea
              className={styles.aiTextarea}
              value={aiPrompt}
              onChange={(event) =>
                setAiPrompt(
                  event.target.value
                )
              }
              placeholder='Ex: „Înlocuiește aroma Vanilie cu Bumbac în toate odorizantele.”'
              rows={6}
            />

            <div
              className={
                styles.aiExamples
              }
            >
              <span>Exemple:</span>

              <button
                type="button"
                onClick={() =>
                  setAiPrompt(
                    "Mărește prețul tuturor cănilor cu 5 lei."
                  )
                }
              >
                Mărește prețurile
              </button>

              <button
                type="button"
                onClick={() =>
                  setAiPrompt(
                    "Înlocuiește aroma Vanilie cu Bumbac în toate odorizantele."
                  )
                }
              >
                Înlocuiește variantă
              </button>

              <button
                type="button"
                onClick={() =>
                  setAiPrompt(
                    "Dezactivează toate produsele fără stoc."
                  )
                }
              >
                Dezactivează fără stoc
              </button>
            </div>

            <div
              className={
                styles.modalActions
              }
            >
              <button
                type="button"
                className={
                  styles.secondaryBtn
                }
                onClick={() =>
                  setShowAiModal(false)
                }
              >
                Anulează
              </button>

              <button
                type="button"
                className={
                  styles.primaryBtn
                }
                onClick={handleAiPreview}
              >
                Previzualizează
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}