// src/pages/Vendor/CostsProfit/components/PendingActionCard.jsx

import { useState } from "react";
import {
  formatRon,
  formatRonFromCents,
} from "../formatMoney.js";

/*
 * before/after pentru UPDATE_COST_ITEM conțin întotdeauna
 * unitCostCents (Int, poate fi null dacă costul nu a fost
 * niciodată setat) + unit - niciodată un câmp "unitCost" deja
 * în lei. Conversia cents -> lei se face STRICT aici, o
 * singură dată; dacă valoarea lipsește, afișăm explicit
 * "cost nesetat", nu "undefined lei" / "null lei".
 */
function formatUnitCostCents(cents, unit) {
  const numeric = Number(cents);

  if (cents === null || cents === undefined || !Number.isFinite(numeric)) {
    return "cost nesetat";
  }

  const base = formatRonFromCents(numeric);

  return unit ? `${base}/${unit}` : base;
}

/**
 * Card generic de confirmare pentru orice modificare propusă
 * de asistentul conversațional Costuri & Profit (pendingAction).
 * Randează diferit după `action.kind`, dar butoanele Confirmă/
 * Renunță și structura generală sunt aceleași - un singur
 * model, nu câte o componentă separată per tip de acțiune.
 */
export default function PendingActionCard({
  action,
  busy = false,
  error = "",
  onConfirm,
  onCancel,
}) {
  const [
    acknowledgeStale,
    setAcknowledgeStale,
  ] = useState(false);

  if (!action) return null;

  const isApplyPrice =
    action.kind === "APPLY_RECOMMENDED_PRICE";

  const isCreateCostItem =
    action.kind === "CREATE_COST_ITEM";

  const needsAcknowledge =
    isApplyPrice && action.isStale;

  const confirmDisabled =
    busy ||
    (needsAcknowledge && !acknowledgeStale);

  function handleConfirm() {
    if (confirmDisabled) return;

    onConfirm?.(
      isApplyPrice
        ? { acknowledgeStaleData: acknowledgeStale }
        : {}
    );
  }

  function handleCreateCostItemChoice(scope) {
    if (busy) return;

    onConfirm?.({ scope });
  }

  return (
    <div style={cardStyle}>
      <strong style={titleStyle}>
        {ACTION_TITLES[action.kind] ||
          "Confirmă modificarea"}
      </strong>

      <div style={bodyStyle}>
        {action.kind === "UPDATE_COST_ITEM" && (
          <UpdateCostItemBody action={action} />
        )}

        {action.kind === "RECALCULATE_BATCH" && (
          <RecalculateBatchBody action={action} />
        )}

        {action.kind ===
          "UPDATE_PRODUCT_COSTING" && (
          <UpdateCostingBody action={action} />
        )}

        {isApplyPrice && (
          <ApplyPriceBody
            action={action}
            acknowledgeStale={acknowledgeStale}
            onAcknowledgeChange={
              setAcknowledgeStale
            }
          />
        )}

        {action.kind ===
          "START_CALCULATOR_FOR_PRODUCT" && (
          <p style={summaryTextStyle}>
            {action.summary}
          </p>
        )}

        {action.kind === "UPDATE_PRODUCT" && (
          <UpdateProductBody action={action} />
        )}

        {action.kind ===
          "CREATE_SUPPORT_TICKET" && (
          <CreateSupportTicketBody action={action} />
        )}

        {isCreateCostItem && (
          <CreateCostItemBody action={action} />
        )}

        {action.kind ===
          "UPDATE_STORE_PROFILE" && (
          <UpdateStoreProfileBody action={action} />
        )}

        {action.kind ===
          "UPDATE_ORDER_STATUS" && (
          <UpdateOrderStatusBody action={action} />
        )}
      </div>

      {error && (
        <div style={errorStyle}>{error}</div>
      )}

      {isCreateCostItem ? (
        <div style={actionsRowStyle}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={ghostBtnStyle}
          >
            Renunță
          </button>

          <button
            type="button"
            onClick={() =>
              handleCreateCostItemChoice("once")
            }
            disabled={busy}
            style={ghostBtnStyle}
          >
            Doar pentru calculul acesta
          </button>

          <button
            type="button"
            onClick={() =>
              handleCreateCostItemChoice("library")
            }
            disabled={busy}
            style={primaryBtnStyle}
          >
            {busy
              ? "Se salvează..."
              : "Adaugă în bibliotecă"}
          </button>
        </div>
      ) : (
        <div style={actionsRowStyle}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={ghostBtnStyle}
          >
            Renunță
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            style={primaryBtnStyle}
          >
            {busy ? "Se aplică..." : "Confirmă"}
          </button>
        </div>
      )}
    </div>
  );
}

const ACTION_TITLES = {
  UPDATE_COST_ITEM: "Modific costul din bibliotecă?",
  RECALCULATE_BATCH: "Recalculez produsele afectate?",
  UPDATE_PRODUCT_COSTING: "Modific costingul produsului?",
  APPLY_RECOMMENDED_PRICE:
    "Aplic prețul recomandat?",
  START_CALCULATOR_FOR_PRODUCT:
    "Pornesc calculatorul de preț?",
  CREATE_COST_ITEM:
    "Adaug un cost nou în bibliotecă?",
  UPDATE_PRODUCT:
    "Modific produsul?",
  CREATE_SUPPORT_TICKET:
    "Trimit către suport?",
  UPDATE_STORE_PROFILE:
    "Modific profilul magazinului?",
  UPDATE_ORDER_STATUS:
    "Schimb statusul comenzii?",
};

const PRIORITY_LABELS = {
  LOW: "Scăzută",
  MEDIUM: "Medie",
  HIGH: "Ridicată",
};

const COST_ITEM_TYPE_LABELS = {
  MATERIAL: "Material",
  PACKAGING: "Ambalaj",
  OTHER: "Alt cost",
};

/* =========================================================
   Corpuri specifice per tip de acțiune
========================================================= */

function UpdateCostItemBody({ action }) {
  return (
    <>
      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Cost vechi
        </span>
        <span>
          {formatUnitCostCents(
            action.before?.unitCostCents,
            action.before?.unit
          )}
        </span>
      </div>

      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Cost nou
        </span>
        <span style={{ fontWeight: 700 }}>
          {formatUnitCostCents(
            action.after?.unitCostCents,
            action.after?.unit
          )}
        </span>
      </div>

      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Produse afectate
        </span>
        <span>{action.affectedCount}</span>
      </div>

      {action.affectedProducts?.length > 0 && (
        <ul style={miniListStyle}>
          {action.affectedProducts.map((p) => (
            <li key={p.productId}>{p.title}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function CreateCostItemBody({ action }) {
  return (
    <>
      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>Nume</span>
        <span style={{ fontWeight: 700 }}>
          {action.name}
        </span>
      </div>

      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>Tip</span>
        <span>
          {COST_ITEM_TYPE_LABELS[action.type] ||
            action.type}
        </span>
      </div>

      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Cost propus
        </span>
        <span style={{ fontWeight: 700 }}>
          {formatUnitCostCents(
            action.unitCostCents,
            action.unit
          )}
        </span>
      </div>
    </>
  );
}

function RecalculateBatchBody({ action }) {
  return (
    <>
      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Produse de recalculat
        </span>
        <span>{action.affectedCount}</span>
      </div>

      {action.affectedProducts?.length > 0 && (
        <ul style={miniListStyle}>
          {action.affectedProducts.map((p) => (
            <li key={p.productId}>{p.title}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/*
 * action.changes e un array de {field, label, before, after}
 * construit pe backend (buildUpdateProductPendingAction) - un
 * singur card poate afișa oricâte câmpuri schimbate simultan
 * (ex: preț + stoc într-un singur mesaj al vânzătorului).
 */
function UpdateProductBody({ action }) {
  return (
    <>
      {action.productTitle && (
        <p style={summaryTextStyle}>
          <strong>{action.productTitle}</strong>
        </p>
      )}

      {Array.isArray(action.changes) &&
        action.changes.map((change) => (
          <div
            key={change.field}
            style={diffRowStyle}
          >
            <span style={diffLabelStyle}>
              {change.label}
            </span>
            <span>
              {change.before}
              {" → "}
              <strong>{change.after}</strong>
            </span>
          </div>
        ))}
    </>
  );
}

/*
 * action.changes are ACELAȘI shape ca la UPDATE_PRODUCT
 * ({field, label, before, after}) - construit de
 * handleUpdateStoreProfile din vendorAssistantCommandService.js.
 */
function UpdateStoreProfileBody({ action }) {
  return (
    <>
      {action.storeName && (
        <p style={summaryTextStyle}>
          <strong>{action.storeName}</strong>
        </p>
      )}

      {Array.isArray(action.changes) &&
        action.changes.map((change) => (
          <div
            key={change.field}
            style={diffRowStyle}
          >
            <span style={diffLabelStyle}>
              {change.label}
            </span>
            <span>
              {change.before}
              {" → "}
              <strong>{change.after}</strong>
            </span>
          </div>
        ))}
    </>
  );
}

function UpdateOrderStatusBody({ action }) {
  return (
    <>
      {action.orderNumber && (
        <p style={summaryTextStyle}>
          Comanda <strong>{action.orderNumber}</strong>
        </p>
      )}

      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>Status</span>
        <span>
          {action.before}
          {" → "}
          <strong>{action.after}</strong>
        </span>
      </div>
    </>
  );
}

/*
 * action.subject/category/priority/message vin gata construite de
 * supportEscalationService.js (buildTicketDraft) - inclusiv
 * rezumatul AI, rolul, pagina curentă și pașii încercați, deja
 * împachetate în message (SupportTicket nu are câmpuri dedicate
 * pentru acestea - vezi nota din backend).
 */
function CreateSupportTicketBody({ action }) {
  return (
    <>
      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>Subiect</span>
        <span style={{ fontWeight: 700 }}>
          {action.subject}
        </span>
      </div>

      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Prioritate
        </span>
        <span>
          {PRIORITY_LABELS[action.priority] ||
            action.priority}
        </span>
      </div>

      <details style={{ marginTop: 8 }}>
        <summary
          style={{
            cursor: "pointer",
            color: "var(--color-muted, #6b7280)",
            fontSize: 12.5,
          }}
        >
          Vezi conținutul solicitării
        </summary>

        <p
          style={{
            ...summaryTextStyle,
            whiteSpace: "pre-wrap",
            marginTop: 8,
          }}
        >
          {action.message}
        </p>
      </details>
    </>
  );
}

function UpdateCostingBody({ action }) {
  return (
    <>
      <p style={summaryTextStyle}>
        {action.summary}
      </p>

      {action.before && action.after && (
        <div style={diffGridStyle}>
          <div />
          <strong style={diffColHeadStyle}>
            Înainte
          </strong>
          <strong style={diffColHeadStyle}>
            Acum
          </strong>

          <span style={diffLabelStyle}>
            Cost real
          </span>
          <span>
            {formatRon(action.before.totalRealCost)}
          </span>
          <span>
            {formatRon(action.after.totalRealCost)}
          </span>

          <span style={diffLabelStyle}>
            Preț recomandat
          </span>
          <span>
            {formatRon(
              action.before.recommendedPrice
            )}
          </span>
          <span style={{ fontWeight: 700 }}>
            {formatRon(
              action.after.recommendedPrice
            )}
          </span>

          <span style={diffLabelStyle}>
            Profit estimat
          </span>
          <span>
            {formatRon(
              action.before.estimatedProfit
            )}
          </span>
          <span>
            {formatRon(
              action.after.estimatedProfit
            )}
          </span>
        </div>
      )}
    </>
  );
}

function ApplyPriceBody({
  action,
  acknowledgeStale,
  onAcknowledgeChange,
}) {
  return (
    <>
      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Preț actual
        </span>
        <span>
          {formatRon(
            action.currentPriceCents / 100
          )}
        </span>
      </div>

      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Preț recomandat
        </span>
        <span style={{ fontWeight: 700 }}>
          {formatRon(
            action.recommendedPriceCents / 100
          )}
        </span>
      </div>

      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Diferență
        </span>
        <span>
          {action.diffCents >= 0 ? "+" : ""}
          {formatRon(action.diffCents / 100)}
          {action.diffPercent != null
            ? ` (${action.diffPercent}%)`
            : ""}
        </span>
      </div>

      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Profit estimat
        </span>
        <span>
          {formatRon(action.estimatedProfit)}
        </span>
      </div>

      <div style={diffRowStyle}>
        <span style={diffLabelStyle}>
          Net după comision
        </span>
        <span>
          {formatRon(
            action.vendorNetAfterCommission
          )}
        </span>
      </div>

      {action.isStale && (
        <div style={warningBoxStyle}>
          <strong>Atenție:</strong>{" "}
          {action.costingStatus !== "CONFIRMED"
            ? "costing-ul nu este confirmat încă."
            : ""}{" "}
          {action.needsRecalculation
            ? "costurile nu sunt actualizate (necesită recalculare)."
            : ""}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 8,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={acknowledgeStale}
              onChange={(e) =>
                onAcknowledgeChange(
                  e.target.checked
                )
              }
            />
            Am înțeles, aplică oricum
          </label>
        </div>
      )}
    </>
  );
}

/* =========================================================
   Stiluri
========================================================= */

const cardStyle = {
  border: "1px solid var(--color-border, #e5e5e5)",
  borderRadius: 14,
  padding: 14,
  background: "var(--surface, #ffffff)",
  marginTop: 6,
  marginBottom: 12,
};

const titleStyle = {
  display: "block",
  marginBottom: 10,
  fontSize: 14,
  fontWeight: 700,
  color: "var(--color-text, #2d2d2d)",
};

const bodyStyle = {
  fontSize: 13.5,
  color: "var(--color-text, #2d2d2d)",
};

const diffRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  padding: "4px 0",
};

const diffLabelStyle = {
  color: "var(--color-muted, #6b7280)",
};

const summaryTextStyle = {
  margin: "0 0 10px",
  color: "var(--color-text, #2d2d2d)",
};

const diffGridStyle = {
  display: "grid",
  gridTemplateColumns: "1.2fr 1fr 1fr",
  rowGap: 4,
  columnGap: 8,
  fontSize: 13,
};

const diffColHeadStyle = {
  fontSize: 11,
  color: "var(--color-muted, #6b7280)",
  textTransform: "uppercase",
};

const miniListStyle = {
  margin: "6px 0 0",
  paddingLeft: 18,
  fontSize: 12.5,
  color: "var(--color-muted, #6b7280)",
};

const warningBoxStyle = {
  marginTop: 10,
  padding: 10,
  borderRadius: 10,

  background:
    "color-mix(in srgb, var(--color-warning, #f59e0b) 14%, transparent)",

  color: "var(--color-warning, #f59e0b)",
  fontSize: 12.5,
};

const errorStyle = {
  color: "var(--color-danger, #dc2626)",
  fontSize: 12.5,
  marginTop: 8,
};

const actionsRowStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 14,
};

const ghostBtnStyle = {
  border: "1px solid var(--color-border, #e5e5e5)",
  borderRadius: 10,
  padding: "9px 14px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
  background: "var(--surface, #ffffff)",
  color: "var(--color-text, #2d2d2d)",
};

const primaryBtnStyle = {
  border: 0,
  borderRadius: 10,
  padding: "9px 16px",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
  background: "var(--color-primary, #8b5cf6)",
  color: "#ffffff",
};
