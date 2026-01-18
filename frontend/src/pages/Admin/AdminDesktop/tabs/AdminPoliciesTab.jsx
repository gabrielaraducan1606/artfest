// AdminPoliciesTab.jsx
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "../AdminDesktop.module.css";

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

const PAGE_SIZE = 50;

function createDefaultUserFilters() {
  return {
    q: "",
    hasTos: "ALL", // ALL | YES | NO
    hasPrivacy: "ALL",
    hasMarketing: "ALL",
  };
}

function createDefaultVendorFilters() {
  return {
    q: "",
    hasVendorTerms: "ALL", // ALL | YES | NO
    hasShipping: "ALL",
    hasReturns: "ALL",

    // ✅ NOU: Anexa Produse
    hasProductsAddendum: "ALL",

    hasProductDecl: "ALL",
  };
}

// ✅ Tab keys
const TABS = {
  USERS: "USERS",
  VENDORS: "VENDORS",
  NOTIFY: "NOTIFY",
};

export default function AdminPoliciesTab({
  userConsents = [],
  vendorAgreements = [],
}) {
  // ✅ NEW: active tab
  const [activeTab, setActiveTab] = useState(TABS.USERS);

  // user filters + paginație
  const [userFilters, setUserFilters] = useState(createDefaultUserFilters);
  const [userPage, setUserPage] = useState(1);

  // vendor filters + paginație
  const [vendorFilters, setVendorFilters] = useState(
    createDefaultVendorFilters
  );
  const [vendorPage, setVendorPage] = useState(1);

  // vendor selectat pentru drawer
  const [selectedVendor, setSelectedVendor] = useState(null);

  /* ========== USERS ========== */

  const handleUserFilterChange = (updater) => {
    setUserFilters((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
    setUserPage(1);
  };

  const resetUserFilters = () => {
    setUserFilters(createDefaultUserFilters());
    setUserPage(1);
  };

  const filteredUserRows = useMemo(() => {
    let list = [...(userConsents || [])];

    const q = userFilters.q.trim().toLowerCase();
    if (q) {
      list = list.filter((row) => {
        const email = row.email?.toLowerCase() || "";
        const userId = row.userId?.toLowerCase() || "";
        return email.includes(q) || userId.includes(q);
      });
    }

    if (userFilters.hasTos === "YES") {
      list = list.filter((r) => r.tosAccepted);
    } else if (userFilters.hasTos === "NO") {
      list = list.filter((r) => !r.tosAccepted);
    }

    if (userFilters.hasPrivacy === "YES") {
      list = list.filter((r) => r.privacyAccepted);
    } else if (userFilters.hasPrivacy === "NO") {
      list = list.filter((r) => !r.privacyAccepted);
    }

    if (userFilters.hasMarketing === "YES") {
      list = list.filter((r) => r.marketingOptIn);
    } else if (userFilters.hasMarketing === "NO") {
      list = list.filter((r) => !r.marketingOptIn);
    }

    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  }, [userConsents, userFilters]);

  const userTotalItems = filteredUserRows.length;
  const userTotalPages = userTotalItems
    ? Math.ceil(userTotalItems / PAGE_SIZE)
    : 1;
  const userCurrentPage = Math.min(userPage, userTotalPages);
  const userStartIndex = (userCurrentPage - 1) * PAGE_SIZE;
  const userEndIndex = userStartIndex + PAGE_SIZE;
  const userPaginatedRows = filteredUserRows.slice(userStartIndex, userEndIndex);

  /* ========== VENDORS ========== */

  const handleVendorFilterChange = (updater) => {
    setVendorFilters((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      return next;
    });
    setVendorPage(1);
  };

  const resetVendorFilters = () => {
    setVendorFilters(createDefaultVendorFilters());
    setVendorPage(1);
  };

  const filteredVendorRows = useMemo(() => {
    let list = [...(vendorAgreements || [])];

    const q = vendorFilters.q.trim().toLowerCase();
    if (q) {
      list = list.filter((row) => {
        const vendorName = row.vendorName?.toLowerCase() || "";
        const vendorEmail = row.vendorEmail?.toLowerCase() || "";
        const userEmail = row.userEmail?.toLowerCase() || "";
        const vendorId = row.vendorId?.toLowerCase() || "";
        return (
          vendorName.includes(q) ||
          vendorEmail.includes(q) ||
          userEmail.includes(q) ||
          vendorId.includes(q)
        );
      });
    }

    if (vendorFilters.hasVendorTerms === "YES") {
      list = list.filter((r) => r.vendorTermsAccepted);
    } else if (vendorFilters.hasVendorTerms === "NO") {
      list = list.filter((r) => !r.vendorTermsAccepted);
    }

    if (vendorFilters.hasShipping === "YES") {
      list = list.filter((r) => r.shippingAccepted);
    } else if (vendorFilters.hasShipping === "NO") {
      list = list.filter((r) => !r.shippingAccepted);
    }

    if (vendorFilters.hasReturns === "YES") {
      list = list.filter((r) => r.returnsAccepted);
    } else if (vendorFilters.hasReturns === "NO") {
      list = list.filter((r) => !r.returnsAccepted);
    }

    // ✅ NOU: Anexa Produse
    if (vendorFilters.hasProductsAddendum === "YES") {
      list = list.filter((r) => r.productsAddendumAccepted);
    } else if (vendorFilters.hasProductsAddendum === "NO") {
      list = list.filter((r) => !r.productsAddendumAccepted);
    }

    if (vendorFilters.hasProductDecl === "YES") {
      list = list.filter((r) => r.productDeclarationAccepted);
    } else if (vendorFilters.hasProductDecl === "NO") {
      list = list.filter((r) => !r.productDeclarationAccepted);
    }

    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return list;
  }, [vendorAgreements, vendorFilters]);

  const vendorTotalItems = filteredVendorRows.length;
  const vendorTotalPages = vendorTotalItems
    ? Math.ceil(vendorTotalItems / PAGE_SIZE)
    : 1;
  const vendorCurrentPage = Math.min(vendorPage, vendorTotalPages);
  const vendorStartIndex = (vendorCurrentPage - 1) * PAGE_SIZE;
  const vendorEndIndex = vendorStartIndex + PAGE_SIZE;
  const vendorPaginatedRows = filteredVendorRows.slice(
    vendorStartIndex,
    vendorEndIndex
  );

  return (
    <>
      {/* ✅ NEW: Tabs header */}
      <div
        className={styles.filtersRow}
        style={{ alignItems: "flex-end", marginBottom: 14 }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`${styles.paginationBtn} ${
              activeTab === TABS.USERS ? styles.paginationBtnActive : ""
            }`}
            onClick={() => setActiveTab(TABS.USERS)}
          >
            Consimțăminte user
          </button>

          <button
            type="button"
            className={`${styles.paginationBtn} ${
              activeTab === TABS.VENDORS ? styles.paginationBtnActive : ""
            }`}
            onClick={() => setActiveTab(TABS.VENDORS)}
          >
            Acorduri vendori
          </button>

          <button
            type="button"
            className={`${styles.paginationBtn} ${
              activeTab === TABS.NOTIFY ? styles.paginationBtnActive : ""
            }`}
            onClick={() => setActiveTab(TABS.NOTIFY)}
          >
            Informare versiuni
          </button>
        </div>
      </div>

      {/* ====== User consents ====== */}
      {activeTab === TABS.USERS && (
        <section style={{ marginBottom: 32 }}>
          <h3 className={styles.sectionTitle}>Consimțăminte user</h3>

          <div className={styles.filtersRow}>
            <label>
              <span>Caută</span>
              <input
                type="text"
                placeholder="Email sau User ID"
                value={userFilters.q}
                onChange={(e) =>
                  handleUserFilterChange((f) => ({
                    ...f,
                    q: e.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Termeni &amp; condiții (TOS)</span>
              <select
                value={userFilters.hasTos}
                onChange={(e) =>
                  handleUserFilterChange((f) => ({
                    ...f,
                    hasTos: e.target.value,
                  }))
                }
              >
                <option value="ALL">Toți</option>
                <option value="YES">Doar cu TOS acceptat</option>
                <option value="NO">Fără TOS</option>
              </select>
            </label>

            <label>
              <span>Politica de confidențialitate</span>
              <select
                value={userFilters.hasPrivacy}
                onChange={(e) =>
                  handleUserFilterChange((f) => ({
                    ...f,
                    hasPrivacy: e.target.value,
                  }))
                }
              >
                <option value="ALL">Toți</option>
                <option value="YES">Doar cu Privacy acceptată</option>
                <option value="NO">Fără Privacy</option>
              </select>
            </label>

            <label>
              <span>Marketing</span>
              <select
                value={userFilters.hasMarketing}
                onChange={(e) =>
                  handleUserFilterChange((f) => ({
                    ...f,
                    hasMarketing: e.target.value,
                  }))
                }
              >
                <option value="ALL">Toți</option>
                <option value="YES">Doar cu opt-in</option>
                <option value="NO">Doar fără opt-in</option>
              </select>
            </label>

            <div className={styles.filtersActions}>
              <button
                type="button"
                className={styles.resetBtn}
                onClick={resetUserFilters}
              >
                Reset
              </button>
              <span className={styles.filtersCount}>
                {userTotalItems} rezultate
              </span>
            </div>
          </div>

          <UserConsentsTable rows={userPaginatedRows} totalItems={userTotalItems} />

          <Pagination
            page={userCurrentPage}
            totalPages={userTotalPages}
            totalItems={userTotalItems}
            onPageChange={setUserPage}
          />
        </section>
      )}

      {/* ====== Vendor agreements ====== */}
      {activeTab === TABS.VENDORS && (
        <section>
          <h3 className={styles.sectionTitle}>Acorduri vendori</h3>

          <div className={styles.filtersRow}>
            <label>
              <span>Caută</span>
              <input
                type="text"
                placeholder="Nume vendor, email, Vendor ID"
                value={vendorFilters.q}
                onChange={(e) =>
                  handleVendorFilterChange((f) => ({
                    ...f,
                    q: e.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>Acord Master vânzători</span>
              <select
                value={vendorFilters.hasVendorTerms}
                onChange={(e) =>
                  handleVendorFilterChange((f) => ({
                    ...f,
                    hasVendorTerms: e.target.value,
                  }))
                }
              >
                <option value="ALL">Toți</option>
                <option value="YES">Doar cu acord</option>
                <option value="NO">Fără acord</option>
              </select>
            </label>

            <label>
              <span>Shipping addendum</span>
              <select
                value={vendorFilters.hasShipping}
                onChange={(e) =>
                  handleVendorFilterChange((f) => ({
                    ...f,
                    hasShipping: e.target.value,
                  }))
                }
              >
                <option value="ALL">Toți</option>
                <option value="YES">Doar cu acceptare</option>
                <option value="NO">Fără</option>
              </select>
            </label>

            <label>
              <span>Politică retur</span>
              <select
                value={vendorFilters.hasReturns}
                onChange={(e) =>
                  handleVendorFilterChange((f) => ({
                    ...f,
                    hasReturns: e.target.value,
                  }))
                }
              >
                <option value="ALL">Toți</option>
                <option value="YES">Doar cu acceptare</option>
                <option value="NO">Fără</option>
              </select>
            </label>

            {/* ✅ NOU: Anexa Produse */}
            <label>
              <span>Anexa Produse</span>
              <select
                value={vendorFilters.hasProductsAddendum}
                onChange={(e) =>
                  handleVendorFilterChange((f) => ({
                    ...f,
                    hasProductsAddendum: e.target.value,
                  }))
                }
              >
                <option value="ALL">Toți</option>
                <option value="YES">Doar cu acceptare</option>
                <option value="NO">Fără</option>
              </select>
            </label>

            <label>
              <span>Declarație produse</span>
              <select
                value={vendorFilters.hasProductDecl}
                onChange={(e) =>
                  handleVendorFilterChange((f) => ({
                    ...f,
                    hasProductDecl: e.target.value,
                  }))
                }
              >
                <option value="ALL">Toți</option>
                <option value="YES">Doar cu declarație</option>
                <option value="NO">Fără declarație</option>
              </select>
            </label>

            <div className={styles.filtersActions}>
              <button
                type="button"
                className={styles.resetBtn}
                onClick={resetVendorFilters}
              >
                Reset
              </button>
              <span className={styles.filtersCount}>
                {vendorTotalItems} rezultate
              </span>
            </div>
          </div>

          <VendorAgreementsTable
            rows={vendorPaginatedRows}
            totalItems={vendorTotalItems}
            onShowVendorDetails={setSelectedVendor}
          />

          <Pagination
            page={vendorCurrentPage}
            totalPages={vendorTotalPages}
            totalItems={vendorTotalItems}
            onPageChange={setVendorPage}
          />

          {selectedVendor && (
            <VendorDetailsDrawer
              vendor={selectedVendor}
              onClose={() => setSelectedVendor(null)}
            />
          )}
        </section>
      )}

      {/* ✅ NEW: Notify tab */}
      {activeTab === TABS.NOTIFY && (
        <section>
          <h3 className={styles.sectionTitle}>Informare versiuni</h3>
          <p className={styles.subtle} style={{ marginTop: -6 }}>
            Creează o informare in-app (și opțional email) când schimbi versiuni
            pentru documentele legale.
          </p>
          <PolicyNotificationsTab />
        </section>
      )}
    </>
  );
}
const DOC_LABELS = {
    // users
    TOS: "Termeni și condiții",
    PRIVACY: "Politica de confidențialitate",
    MARKETING: "Preferințe marketing",

    // vendors
    VENDOR_TERMS: "Acord master vânzători",
    SHIPPING_ADDENDUM: "Anexă livrare (shipping)",
    RETURNS_POLICY_ACK: "Politică retur",
    PRODUCTS_ADDENDUM: "Anexa Produse",
    PRODUCT_DECLARATION: "Declarație produse",
  };

  const DOC_URLS = {
    // placeholders (poți ajusta după rutele tale reale)
    TOS: "/legal/tos",
    PRIVACY: "/legal/privacy",
    MARKETING: "/legal/marketing",

    VENDOR_TERMS: "/vendor/legal/vendor-terms",
    SHIPPING_ADDENDUM: "/vendor/legal/shipping-addendum",
    RETURNS_POLICY_ACK: "/vendor/legal/returns-policy",
    PRODUCTS_ADDENDUM: "/vendor/legal/products-addendum",
    PRODUCT_DECLARATION: "/vendor/legal/product-declaration",
  };
/* ===================== NEW COMPONENT ===================== */
function PolicyNotificationsTab() {
  const [scope, setScope] = useState("VENDORS"); // VENDORS | USERS

  const DOCS_BY_SCOPE = {
    VENDORS: {
      VENDOR_TERMS: true,
      SHIPPING_ADDENDUM: false,
      RETURNS_POLICY_ACK: false,
      PRODUCTS_ADDENDUM: false,
      PRODUCT_DECLARATION: false,
    },
    USERS: {
      TOS: true,
      PRIVACY: false,
      MARKETING: false,
    },
  };

  // bifezi documentele vizate (dinamic după scope)
  const [documents, setDocuments] = useState(DOCS_BY_SCOPE.VENDORS);

  // ✅ NEW: preview modal state
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleScopeChange = (nextScope) => {
    setScope(nextScope);
    setDocuments(DOCS_BY_SCOPE[nextScope] || {});
  };

  const [requiresAction, setRequiresAction] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);

  const [title, setTitle] = useState("Au fost actualizate documentele legale");
  const [message, setMessage] = useState(
    "Am actualizat versiunea unuia sau mai multor documente. Te rugăm să le consulți și să le accepți pentru a continua."
  );

  const [emailSubject, setEmailSubject] = useState("Actualizare documente legale");
  const [emailBody, setEmailBody] = useState(
    "Salut! Am actualizat documentele legale. Te rugăm să intri în cont și să le accepți pentru a continua."
  );

  const [loading, setLoading] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");

  const selectedDocs = Object.entries(documents)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const toggleDoc = (k) => {
    setDocuments((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const previewPayload = useMemo(() => {
    const docs = selectedDocs.map((k) => ({
      key: k,
      title: DOC_LABELS[k] || k,
      version: "X.Y.Z", // placeholder; real vine din backend
      url: DOC_URLS[k] || null,
      required: true,
      alreadyAccepted: false, // preview
    }));

    return {
      scope,
      requiresAction,
      title,
      message,
      documents: docs,
    };
  }, [scope, requiresAction, title, message, selectedDocs]);

  const handleSubmit = async () => {
    setOkMsg("");
    setErrMsg("");

    if (!title.trim() || !message.trim()) {
      setErrMsg("Completează titlul și mesajul pentru notificare.");
      return;
    }
    if (!selectedDocs.length) {
      setErrMsg("Selectează cel puțin un document.");
      return;
    }
    if (sendEmail && (!emailSubject.trim() || !emailBody.trim())) {
      setErrMsg("Completează subiectul și corpul emailului.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/policy-notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          scope,
          documents: selectedDocs,
          requiresAction,
          inApp: { title, message },
          email: sendEmail ? { subject: emailSubject, body: emailBody } : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "server_error");
      }

      const data = await res.json().catch(() => ({}));
      setOkMsg(
        `Trimis cu succes. Target: ${data?.targetCount ?? "?"} · Notificări create: ${
          data?.createdCount ?? "?"
        }${
          data?.emailQueued != null
            ? ` · Email trimise: ${data.emailQueued}${
                data.emailFailed ? ` · Eșuate: ${data.emailFailed}` : ""
              }`
            : ""
        }`
      );
    } catch (e) {
      console.error("policy notify send error:", e);
      setErrMsg(
        "Eroare la trimitere. Verifică endpoint-ul din backend și încearcă din nou."
      );
    } finally {
      setLoading(false);
    }
  };

  const docKeys = Object.keys(documents);

  return (
    <div className={styles.card} style={{ padding: 14 }}>
      <div className={styles.filtersRow}>
        <label>
          <span>Audiență</span>
          <select value={scope} onChange={(e) => handleScopeChange(e.target.value)}>
            <option value="VENDORS">Vendori</option>
            <option value="USERS">Useri</option>
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={requiresAction}
            onChange={(e) => setRequiresAction(e.target.checked)}
          />
          <span style={{ margin: 0 }}>Necesită acțiune (gate)</span>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
          />
          <span style={{ margin: 0 }}>Trimite și email</span>
        </label>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Documente vizate</div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {docKeys.map((k) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={!!documents[k]} onChange={() => toggleDoc(k)} />
              <span style={{ margin: 0 }}>{k}</span>
            </label>
          ))}
        </div>
      </div>

      <div className={styles.filtersRow} style={{ marginTop: 14 }}>
        <label style={{ flex: 1, minWidth: 260 }}>
          <span>Titlu (in-app)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label style={{ flex: 1, minWidth: 260 }}>
          <span>Mesaj (in-app)</span>
          <input value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
      </div>

      {sendEmail && (
        <div className={styles.filtersRow} style={{ marginTop: 14 }}>
          <label style={{ flex: 1, minWidth: 260 }}>
            <span>Subiect email</span>
            <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
          </label>

          <label style={{ flex: 1, minWidth: 260 }}>
            <span>Corp email</span>
            <textarea
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={4}
              style={{ width: "100%" }}
            />
          </label>
        </div>
      )}

      {errMsg && (
        <div className={styles.error} style={{ marginTop: 10 }}>
          {errMsg}
        </div>
      )}
      {okMsg && <div style={{ marginTop: 10, opacity: 0.9 }}>{okMsg}</div>}

      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className={styles.primaryBtn} onClick={handleSubmit} disabled={loading}>
          {loading ? "Se trimite…" : "Trimite informarea"}
        </button>

        <button
          type="button"
          className={styles.paginationBtn}
          onClick={() => setPreviewOpen(true)}
          disabled={!title.trim() || !message.trim()}
        >
          Preview gate
        </button>
      </div>

      <p className={styles.subtle} style={{ marginTop: 10 }}>
        * Necesită backend: <code>POST /api/admin/policy-notifications/send</code>
      </p>

      <PolicyGatePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        preview={previewPayload}
      />
    </div>
  );
}

/* ===================== PREVIEW MODAL ===================== */
function PolicyGatePreviewModal({ open, onClose, preview }) {
  if (!open) return null;
  if (typeof document === "undefined") return null;

  const {
    scope,
    requiresAction,
    title,
    message,
    documents = [],
  } = preview || {};

  const blocked =
    !!requiresAction && documents.some((d) => d.required && !d.alreadyAccepted);

  const node = (
    <div className={styles.drawerOverlay} onClick={onClose} style={{ zIndex: 9999 }}>
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        aria-label="Preview gate"
        style={{ maxWidth: 760, width: "min(760px, 100%)" }}
      >
        <header className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>Preview gate (modal)</h3>
            <p className={styles.drawerSub}>
              Scope: <code>{scope}</code> · {blocked ? "Blochează acțiunile" : "Nu blochează"}
            </p>
          </div>
          <button type="button" className={styles.drawerClose} onClick={onClose} aria-label="Închide">
            ×
          </button>
        </header>

        <div className={styles.drawerBody}>
          <div className={styles.card} style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>
                  {title || "—"}
                </div>
                <div className={styles.subtle} style={{ marginTop: 6 }}>
                  {message || "—"}
                </div>
              </div>

              {blocked && (
                <span
                  style={{
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid var(--color-border)",
                    background: "color-mix(in srgb, var(--color-warning) 18%, transparent)",
                    whiteSpace: "nowrap",
                    height: "fit-content",
                  }}
                >
                  Necesită acceptare
                </span>
              )}
            </div>

            <div style={{ marginTop: 12, fontWeight: 700 }}>Documente vizate</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {documents.length ? (
                documents.map((d) => (
                  <div
                    key={d.key}
                    style={{
                      border: "1px solid var(--color-border)",
                      borderRadius: 12,
                      padding: 12,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontWeight: 800 }}>{d.title || d.key}</span>
                        <span className={styles.subtle}>v{d.version || "?"}</span>
                        {d.required ? (
                          <span
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 999,
                              border: "1px solid var(--color-border)",
                            }}
                          >
                            Obligatoriu
                          </span>
                        ) : null}
                        {d.alreadyAccepted ? (
                          <span
                            style={{
                              fontSize: 11,
                              padding: "2px 8px",
                              borderRadius: 999,
                              border: "1px solid color-mix(in srgb, var(--color-success) 30%, transparent)",
                              background: "color-mix(in srgb, var(--color-success) 12%, transparent)",
                            }}
                          >
                            Acceptat
                          </span>
                        ) : null}
                      </div>

                      {d.url ? (
                        <div className={styles.subtle} style={{ marginTop: 6 }}>
                          Link: <code>{d.url}</code>
                        </div>
                      ) : (
                        <div className={styles.subtle} style={{ marginTop: 6 }}>
                          Link lipsă
                        </div>
                      )}
                    </div>

                    {!d.alreadyAccepted && d.required ? (
                      <span
                        style={{
                          fontSize: 12,
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)",
                          background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        În așteptare
                      </span>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className={styles.subtle} style={{ margin: 0 }}>
                  Selectează cel puțin un document ca să vezi preview.
                </p>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
              <button type="button" className={styles.primaryBtn} disabled={!blocked}>
                Acceptă și continuă
              </button>
              <button type="button" className={styles.resetBtn}>
                Reîncarcă
              </button>
            </div>

            {blocked ? (
              <p className={styles.subtle} style={{ marginTop: 10 }}>
                * În preview, butoanele sunt “mock”. În gate-ul real, acceptarea va face POST și va debloca.
              </p>
            ) : null}
          </div>
        </div>

        <footer className={styles.drawerFooter}>
          <button type="button" className={styles.drawerBtnSecondary} onClick={onClose}>
            Închide preview
          </button>
        </footer>
      </aside>
    </div>
  );

  return createPortal(node, document.body);
}

/* ========== User table ========== */

function UserConsentsTable({ rows, totalItems }) {
  if (!rows?.length) {
    return (
      <p className={styles.subtle}>
        {totalItems
          ? "Nu există rezultate pe această pagină."
          : "Nu există înregistrări de consimțământ."}
      </p>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>User ID</th>
            <th>Email</th>
            <th>Creat la</th>
            <th>TOS</th>
            <th>Privacy</th>
            <th>Marketing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId}>
              <td>
                <code>{r.userId}</code>
              </td>
              <td>{r.email}</td>
              <td>{formatDate(r.createdAt)}</td>
              <td>
                {r.tosAccepted
                  ? `Da (v${r.tosVersion || "?"}, ${formatDate(r.tosGivenAt)})`
                  : "Nu"}
              </td>
              <td>
                {r.privacyAccepted
                  ? `Da (v${r.privacyVersion || "?"}, ${formatDate(r.privacyGivenAt)})`
                  : "Nu"}
              </td>
              <td>
                {r.marketingOptIn
                  ? `Da (v${r.marketingVersion || "?"}, ${formatDate(r.marketingGivenAt)})`
                  : "Nu"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========== Vendor table ========== */

function VendorAgreementsTable({ rows, totalItems, onShowVendorDetails }) {
  if (!rows?.length) {
    return (
      <p className={styles.subtle}>
        {totalItems
          ? "Nu există rezultate pe această pagină."
          : "Nu există înregistrări de acorduri vendor."}
      </p>
    );
  }

  return (
    <div className={styles.tableWrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Vendor ID</th>
            <th>Nume vendor</th>
            <th>Email vendor</th>
            <th>Email user</th>
            <th>Creat la</th>
            <th>Acord Master</th>
            <th>Shipping addendum</th>
            <th>Politică retur</th>
            <th>Anexa Produse</th>
            <th>Declarație produse</th>
            <th>Detalii</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.vendorId}>
              <td>
                <code>{r.vendorId}</code>
              </td>
              <td>{r.vendorName || "—"}</td>
              <td>{r.vendorEmail || "—"}</td>
              <td>{r.userEmail || "—"}</td>
              <td>{formatDate(r.createdAt)}</td>

              <td>
                {r.vendorTermsAccepted
                  ? `Da (v${r.vendorTermsVersion || "?"}, ${formatDate(r.vendorTermsAcceptedAt)})`
                  : "Nu"}
              </td>

              <td>
                {r.shippingAccepted
                  ? `Da (v${r.shippingVersion || "?"}, ${formatDate(r.shippingAcceptedAt)})`
                  : "Nu"}
              </td>

              <td>
                {r.returnsAccepted
                  ? `Da (v${r.returnsVersion || "?"}, ${formatDate(r.returnsAcceptedAt)})`
                  : "Nu"}
              </td>

              <td>
                {r.productsAddendumAccepted
                  ? `Da (v${r.productsAddendumVersion || "?"}, ${formatDate(r.productsAddendumAcceptedAt)})`
                  : "Nu"}
              </td>

              <td>
                {r.productDeclarationAccepted
                  ? `Da (v${r.productDeclarationVersion || "?"}, ${formatDate(r.productDeclarationAcceptedAt)})`
                  : "Nu"}
              </td>

              <td>
                <button
                  type="button"
                  className={styles.emailBtn}
                  onClick={() => onShowVendorDetails?.(r)}
                >
                  Detalii
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========== Pagination ========== */

function Pagination({ page, totalPages, totalItems, onPageChange }) {
  if (!totalItems || totalPages <= 1) return null;

  const canPrev = page > 1;
  const canNext = page < totalPages;

  const handlePrev = () => {
    if (canPrev) onPageChange(page - 1);
  };

  const handleNext = () => {
    if (canNext) onPageChange(page + 1);
  };

  const pages = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let p = start; p <= end; p++) pages.push(p);

  return (
    <div className={styles.pagination}>
      <div className={styles.paginationInfo}>
        Pagina {page} din {totalPages} · {totalItems} rezultate
      </div>
      <div className={styles.paginationControls}>
        <button
          type="button"
          className={styles.paginationBtn}
          onClick={handlePrev}
          disabled={!canPrev}
        >
          ‹ Înapoi
        </button>

        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.paginationBtn} ${
              p === page ? styles.paginationBtnActive : ""
            }`}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ))}

        <button
          type="button"
          className={styles.paginationBtn}
          onClick={handleNext}
          disabled={!canNext}
        >
          Înainte ›
        </button>
      </div>
    </div>
  );
}

/* ========== VendorDetailsDrawer ========== */

function VendorDetailsDrawer({ vendor, onClose }) {
  if (!vendor) return null;
  if (typeof document === "undefined") return null;

  const {
    vendorName,
    vendorEmail,
    userEmail,
    vendorId,
    createdAt,

    wantsCourier,
    courierAddendumToggleAccepted,
    courierServicesCount,
    courierSample,

    vendorTermsAccepted,
    vendorTermsVersion,
    vendorTermsAcceptedAt,

    shippingAccepted,
    shippingVersion,
    shippingAcceptedAt,

    returnsAccepted,
    returnsVersion,
    returnsAcceptedAt,

    productsAddendumAccepted,
    productsAddendumVersion,
    productsAddendumAcceptedAt,

    productDeclarationAccepted,
    productDeclarationVersion,
    productDeclarationAcceptedAt,
  } = vendor;

  const node = (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        aria-label="Detalii vendor"
      >
        <header className={styles.drawerHeader}>
          <div>
            <h3 className={styles.drawerTitle}>
              {vendorName || "Vendor fără nume"}
            </h3>
            <p className={styles.drawerSub}>
              {vendorEmail || "—"} {userEmail && <>· User: {userEmail}</>}
            </p>
          </div>
          <button
            type="button"
            className={styles.drawerClose}
            onClick={onClose}
            aria-label="Închide"
          >
            ×
          </button>
        </header>

        <div className={styles.drawerBody}>
          <section className={styles.drawerSection}>
            <h4>Identitate</h4>
            <div className={styles.drawerField}>
              <span>Vendor ID</span>
              <code>{vendorId}</code>
            </div>
            <div className={styles.drawerField}>
              <span>Nume vendor</span>
              <span>{vendorName || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Email vendor</span>
              <span>{vendorEmail || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Email user</span>
              <span>{userEmail || "—"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Creat la</span>
              <span>{formatDate(createdAt)}</span>
            </div>
          </section>

          <section className={styles.drawerSection}>
            <h4>Curierat integrat (profil servicii)</h4>
            <div className={styles.drawerField}>
              <span>courierEnabled (profil servicii)</span>
              <span>{wantsCourier ? "Da" : "Nu"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Anexă curierat bifată (profil)</span>
              <span>{courierAddendumToggleAccepted ? "Da" : "Nu"}</span>
            </div>
            <div className={styles.drawerField}>
              <span>Număr servicii</span>
              <span>
                {courierServicesCount != null ? courierServicesCount : "—"}
              </span>
            </div>

            {courierSample && (
              <div className={styles.drawerField}>
                <span>Exemplu serviciu</span>
                <span>
                  ID serviciu: <code>{courierSample.id}</code>
                  <br />
                  courierEnabled: {courierSample.courierEnabled ? "Da" : "Nu"}
                  <br />
                  courierAddendumAccepted:{" "}
                  {courierSample.courierAddendumAccepted ? "Da" : "Nu"}
                  <br />
                  Versiune anexă: {courierSample.courierAddendumVersion || "—"}
                  <br />
                  Acceptată la:{" "}
                  {courierSample.courierAddendumAcceptedAt
                    ? formatDate(courierSample.courierAddendumAcceptedAt)
                    : "—"}
                </span>
              </div>
            )}

            <p className={styles.subtle}>
              * Valorile de mai sus vin din <code>VendorService.attributes</code>{" "}
              (checkbox-urile din onboarding), nu din istoricul legal (
              <code>VendorAcceptance</code>).
            </p>
          </section>

          <section className={styles.drawerSection}>
            <h4>Acorduri legale (VendorAcceptance)</h4>

            <div className={styles.drawerField}>
              <span>Acord Master vânzători</span>
              <span>
                {vendorTermsAccepted
                  ? `Da (v${vendorTermsVersion || "?"}, ${formatDate(vendorTermsAcceptedAt)})`
                  : "Nu"}
              </span>
            </div>

            <div className={styles.drawerField}>
              <span>Shipping addendum</span>
              <span>
                {shippingAccepted
                  ? `Da (v${shippingVersion || "?"}, ${formatDate(shippingAcceptedAt)})`
                  : "Nu"}
              </span>
            </div>

            <div className={styles.drawerField}>
              <span>Politică retur</span>
              <span>
                {returnsAccepted
                  ? `Da (v${returnsVersion || "?"}, ${formatDate(returnsAcceptedAt)})`
                  : "Nu"}
              </span>
            </div>

            <div className={styles.drawerField}>
              <span>Anexa Produse</span>
              <span>
                {productsAddendumAccepted
                  ? `Da (v${productsAddendumVersion || "?"}, ${formatDate(productsAddendumAcceptedAt)})`
                  : "Nu"}
              </span>
            </div>

            <div className={styles.drawerField}>
              <span>Declarație produse</span>
              <span>
                {productDeclarationAccepted
                  ? `Da (v${productDeclarationVersion || "?"}, ${formatDate(productDeclarationAcceptedAt)})`
                  : "Nu"}
              </span>
            </div>
          </section>
        </div>

        <footer className={styles.drawerFooter}>
          <button
            type="button"
            className={styles.drawerBtnSecondary}
            onClick={onClose}
          >
            Închide
          </button>
        </footer>
      </aside>
    </div>
  );

  return createPortal(node, document.body);
}
