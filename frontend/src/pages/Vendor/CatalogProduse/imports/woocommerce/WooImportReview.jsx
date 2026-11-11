import { useId, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, Loader2, Trash2, XCircle } from "lucide-react";

import { CATEGORIES_DETAILED } from "../../../../../constants/productscategories.js";
import styles from "./WooCommerceImport.module.css";
import {
  AVAILABILITY_OPTIONS,
  buildConfirmations,
  confirmationFields,
  blockedLabel,
  errorMessage,
  importInBatches,
  leadTimeRequired,
  missingConfirmations,
  productSummary,
} from "./wooImportLogic.js";
import { wooApi } from "./wooApi.js";

const CATEGORY_GROUPS = CATEGORIES_DETAILED.reduce((groups, c) => {
  (groups[c.groupLabel] ||= []).push(c);
  return groups;
}, {});
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES_DETAILED.map((c) => [c.key, c.label]));

function CategorySelect({ id, value, onChange, required = true, placeholder = "Alege categoria" }) {
  return (
    <select id={id} className={styles.input} value={value || ""} onChange={(e) => onChange(e.target.value || undefined)} required={required}>
      <option value="">{placeholder}</option>
      {Object.entries(CATEGORY_GROUPS).map(([group, list]) => (
        <optgroup key={group} label={group}>
          {list.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

const PERSONALIZATION_TYPE = { text: "Text (nume, mesaj)", file: "Fotografie / fișier", textarea: "Text lung (mesaj)", select: "Listă de opțiuni" };

function ConfirmationField({ field, value, answers, plan, onAnswer, invalid }) {
  const id = useId();
  const [draft, setDraft] = useState(() => (field.kind === "personalization" ? field.fields.map((f) => f.key) : []));

  const reason = field.reason ? <span className={styles.fieldHint}>{field.reason}</span> : null;
  const wrap = (control, extra = null) => (
    <div className={`${styles.confirmField} ${invalid ? styles.confirmFieldMissing : ""}`}>
      {control}
      {extra}
    </div>
  );

  switch (field.kind) {
    case "category":
      return wrap(
        <div className={styles.field}>
          <label htmlFor={id}>{field.label}</label>
          <CategorySelect id={id} value={value} onChange={(v) => onAnswer(field.key, v)} />
          {reason}
        </div>
      );

    case "availability":
    case "variantAvailability":
      return wrap(
        <div className={styles.field}>
          <label htmlFor={id}>{field.label}</label>
          <select id={id} className={styles.input} value={value || ""} onChange={(e) => onAnswer(field.key, e.target.value || undefined)}>
            <option value="">Alege disponibilitatea</option>
            {AVAILABILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} - {o.hint}
              </option>
            ))}
          </select>
          {reason}
        </div>
      );

    case "leadTimeDays": {
      if (!leadTimeRequired(plan, answers)) return null;
      return wrap(
        <div className={styles.field}>
          <label htmlFor={id}>{field.label}</label>
          <input
            id={id}
            className={`${styles.input} ${styles.inputNarrow}`}
            type="number"
            inputMode="numeric"
            min="1"
            max="365"
            value={Number.isInteger(value) ? value : ""}
            placeholder={field.proposal ? String(field.proposal) : "ex. 5"}
            onChange={(e) => onAnswer(field.key, e.target.value === "" ? undefined : Number(e.target.value))}
          />
          <span className={styles.fieldHint}>
            Câte zile lucrătoare îți trebuie pentru un produs realizat la comandă (1-365).
            {field.proposal ? ` În descriere apare ${field.proposal} zile.` : ""}
          </span>
        </div>
      );
    }

    case "personalization": {
      const confirmed = Array.isArray(value);
      const current = confirmed ? value : draft;
      const toggle = (key) => {
        const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
        confirmed ? onAnswer(field.key, next) : setDraft(next);
      };
      return wrap(
        <fieldset className={styles.fieldsetPlain}>
          <legend>{field.label}</legend>
          <span className={styles.fieldHint}>
            Am găsit în magazin câmpuri pe care clientul le completează. Bifează-le pe cele pe care le vrei pe Artfest.
          </span>
          {field.fields.map((f) => (
            <label key={f.key} className={styles.inlineCheck}>
              <input type="checkbox" className={styles.checkbox} checked={current.includes(f.key)} onChange={() => toggle(f.key)} />
              <span>
                {f.label} <small>· {PERSONALIZATION_TYPE[f.type] || f.type}{f.required ? " · obligatoriu" : ""}</small>
              </span>
            </label>
          ))}
          {!confirmed ? (
            <button type="button" className={styles.secondaryBtn} onClick={() => onAnswer(field.key, draft)}>
              Confirmă personalizările ({draft.length})
            </button>
          ) : (
            <span className={styles.okLine}>
              <CheckCircle2 size={14} /> Confirmat. Poți adăuga alte personalizări după import, din editorul produsului.
            </span>
          )}
        </fieldset>
      );
    }

    case "variantSkip":
      return wrap(
        <label className={styles.inlineCheck}>
          <input type="checkbox" className={styles.checkbox} checked={value === "skip"} onChange={(e) => onAnswer(field.key, e.target.checked ? "skip" : undefined)} />
          <span>
            <strong>{field.label} nu se importă automat.</strong> {field.reason ? `Motiv: ${field.reason}.` : ""} Am înțeles; o configurez
            manual după import, dacă e nevoie.
          </span>
        </label>
      );

    case "axisStock":
      return wrap(
        <label className={styles.inlineCheck}>
          <input type="checkbox" className={styles.checkbox} checked={value === "stock"} onChange={(e) => onAnswer(field.key, e.target.checked ? "stock" : undefined)} />
          <span>
            <strong>{field.label} pare o personalizare, dar în magazin are stoc separat.</strong> Confirm că este o variantă reală, cu
            stoc propriu. Dacă nu este, nu importa produsul și corectează-l mai întâi în WooCommerce.
          </span>
        </label>
      );

    default:
      return wrap(<p className={styles.fieldError}>Confirmare necunoscută ({field.key}). Produsul nu poate fi importat din interfață.</p>);
  }
}

function ReviewCard({ item, answers, onAnswer, onRemove, disabled, result }) {
  const summary = productSummary(item);
  const fields = confirmationFields(item.plan);
  const missing = missingConfirmations(item.plan, answers);

  return (
    <li className={`${styles.reviewCard} ${result ? styles[`result_${result.status}`] || "" : ""}`}>
      <div className={styles.reviewHead}>
        <div className={styles.thumbSmall}>{item.image && <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}</div>
        <div className={styles.productText}>
          <strong className={styles.productTitle}>{item.title}</strong>
          <div className={styles.productMeta}>
            <span>{summary.priceLabel}</span>
            <span>{summary.stockLabel}</span>
            {summary.isVariable && <span>{summary.variants.length} variante</span>}
            <span>{summary.shippingLabel}</span>
          </div>
        </div>
        {result ? (
          <ResultBadge result={result} />
        ) : missing.length ? (
          <span className={`${styles.badge} ${styles.tone_warning}`}>{missing.length} de confirmat</span>
        ) : (
          <span className={`${styles.badge} ${styles.tone_success}`}>
            <CheckCircle2 size={13} /> Gata
          </span>
        )}
        {!disabled && !result && (
          <button type="button" className={styles.iconBtn} aria-label={`Scoate ${item.title} din import`} onClick={() => onRemove(item)}>
            <Trash2 size={17} />
          </button>
        )}
      </div>

      {result && result.status !== "imported" && result.status !== "duplicate" && (
        <p className={styles.fieldError}>
          {result.status === "needs_confirmation"
            ? "Lipsesc confirmări (au fost cerute din nou de server)."
            : result.code === "import_blocked"
              ? (result.reasons || []).map(blockedLabel).join(" ") || errorMessage(result.code)
              : errorMessage(result.code, result.message)}
        </p>
      )}

      {!result && fields.length > 0 && (
        <fieldset className={styles.confirmGrid} disabled={disabled}>
          <legend className={styles.srOnly}>Confirmări pentru {item.title}</legend>
          {fields.map((field) => (
            <ConfirmationField
              key={field.key}
              field={field}
              value={answers[field.key]}
              answers={answers}
              plan={item.plan}
              onAnswer={(key, value) => onAnswer(item.externalProductId, key, value)}
              invalid={missing.includes(field.key)}
            />
          ))}
        </fieldset>
      )}
      {!result && !fields.length && <p className={styles.muted}>Toate informațiile sunt clare în magazin; nu e nevoie de confirmări.</p>}
    </li>
  );
}

function ResultBadge({ result }) {
  if (result.status === "imported")
    return (
      <span className={`${styles.badge} ${styles.tone_success}`}>
        <CheckCircle2 size={13} /> Importat
      </span>
    );
  if (result.status === "duplicate")
    return (
      <span className={`${styles.badge}`}>
        <CircleDashed size={13} /> Era deja importat
      </span>
    );
  return (
    <span className={`${styles.badge} ${styles.tone_error}`}>
      <XCircle size={13} /> Neimportat
    </span>
  );
}

export default function WooImportReview({
  connection,
  items: selectedItems,
  answersById,
  setAnswersById,
  services,
  serviceId,
  onServiceChange,
  onRemove,
  onBack,
  onDone,
}) {
  const id = useId();
  // după import, lista afișată rămâne cea trimisă (selecția se golește de cele importate)
  const [ranItems, setRanItems] = useState(null);
  const items = ranItems || selectedItems;
  const [bulkCategory, setBulkCategory] = useState("");
  const [progress, setProgress] = useState(null);
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState("");

  const running = Boolean(progress) && !outcome;
  const answersOf = (item) => answersById[item.externalProductId] || {};

  const missingCount = useMemo(
    () => items.reduce((sum, item) => sum + missingConfirmations(item.plan, answersById[item.externalProductId] || {}).length, 0),
    [items, answersById]
  );
  const needsCategory = items.filter((i) => confirmationFields(i.plan).some((f) => f.kind === "category"));

  function setAnswer(productId, key, value) {
    setAnswersById((prev) => {
      const next = { ...(prev[productId] || {}) };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return { ...prev, [productId]: next };
    });
  }

  function applyBulkCategory() {
    if (!bulkCategory) return;
    for (const item of needsCategory) setAnswer(item.externalProductId, "category", bulkCategory);
  }

  async function handleImport() {
    setError("");
    if (!serviceId) {
      setError("Alege magazinul Artfest în care se importă produsele.");
      return;
    }
    if (missingCount) return;

    setOutcome(null);
    setRanItems(items);
    setProgress({ done: 0, total: items.length, batch: 1, batches: Math.ceil(items.length / 10) });
    const payload = items.map((item) => ({
      externalProductId: item.externalProductId,
      confirmations: buildConfirmations(item.plan, answersOf(item)),
    }));
    const summary = await importInBatches(
      payload,
      (batch) => wooApi.importProducts(connection.id, { serviceId, items: batch }),
      setProgress
    );
    setOutcome(summary);
    onDone(summary);
  }

  const resultById = new Map((outcome?.results || []).map((r) => [r.externalProductId, r]));
  const percent = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <div className={styles.browserHead}>
        <div>
          <h3 id={`${id}-title`}>{outcome ? "Rezultatul importului" : "Verifică produsele înainte de import"}</h3>
          <p className={styles.muted}>
            {outcome
              ? "Produsele importate intră în verificarea Artfest înainte de a fi publicate."
              : "Confirmă ce nu se poate deduce sigur din magazin. Nimic nu se inventează: variantele, cantitățile și disponibilitatea vin din WooCommerce sau de la tine."}
          </p>
        </div>
        <button type="button" className={styles.backBtn} onClick={onBack} disabled={running}>
          <ArrowLeft size={16} /> {outcome ? "Înapoi la produse" : "Modifică selecția"}
        </button>
      </div>

      {!outcome && (
        <div className={styles.reviewToolbar}>
          {services.length > 1 ? (
            <div className={styles.field}>
              <label htmlFor={`${id}-service`}>Magazinul Artfest de destinație</label>
              <select id={`${id}-service`} className={styles.input} value={serviceId || ""} onChange={(e) => onServiceChange(e.target.value)} disabled={running}>
                <option value="">Alege magazinul</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || s.name || s.id}
                  </option>
                ))}
              </select>
            </div>
          ) : services.length === 1 ? (
            <p className={styles.muted}>
              Se importă în <strong>{services[0].title || services[0].name}</strong>.
            </p>
          ) : (
            <p className={styles.fieldError}>Nu ai un magazin Artfest activ în care să imporți produse.</p>
          )}

          {needsCategory.length > 1 && (
            <div className={styles.bulkRow}>
              <div className={styles.field}>
                <label htmlFor={`${id}-bulk`}>Aceeași categorie pentru toate ({needsCategory.length})</label>
                <CategorySelect id={`${id}-bulk`} value={bulkCategory} onChange={(v) => setBulkCategory(v || "")} required={false} />
              </div>
              <button type="button" className={styles.secondaryBtn} disabled={!bulkCategory || running} onClick={applyBulkCategory}>
                Aplică {bulkCategory ? `„${CATEGORY_LABEL[bulkCategory]}”` : ""}
              </button>
            </div>
          )}
        </div>
      )}

      <ul className={styles.reviewList}>
        {items.map((item) => (
          <ReviewCard
            key={item.externalProductId}
            item={item}
            answers={answersOf(item)}
            onAnswer={setAnswer}
            onRemove={onRemove}
            disabled={running}
            result={resultById.get(item.externalProductId)}
          />
        ))}
      </ul>

      {progress && (
        <div className={styles.progressBox} aria-live="polite">
          <div className={styles.progressText}>
            {outcome ? (
              <span>
                <strong>{outcome.imported}</strong> importate · <strong>{outcome.duplicate}</strong> deja existente ·{" "}
                <strong>{outcome.failed}</strong> neimportate
              </span>
            ) : (
              <span>
                <Loader2 size={15} className={styles.spin} /> Lotul {progress.batch} din {progress.batches} · {progress.done} din {progress.total} produse
                procesate
              </span>
            )}
          </div>
          <div className={styles.progressTrack} role="progressbar" aria-label="Progresul importului" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
          {!outcome && <p className={styles.fieldHint}>Copierea imaginilor poate dura câteva secunde pe produs. Nu închide pagina.</p>}
        </div>
      )}

      {error && (
        <div className={styles.alertError} role="alert">
          <AlertTriangle size={18} />
          <p>{error}</p>
        </div>
      )}

      {!outcome && (
        <div className={styles.stickyBar}>
          <span aria-live="polite">
            {missingCount ? (
              <>
                <strong>{missingCount}</strong> {missingCount === 1 ? "confirmare lipsă" : "confirmări lipsă"}
              </>
            ) : (
              <>
                <strong>{items.length}</strong> {items.length === 1 ? "produs pregătit" : "produse pregătite"}
              </>
            )}
          </span>
          <button type="button" className={styles.primaryBtn} disabled={running || missingCount > 0 || !items.length || !services.length} onClick={handleImport}>
            {running ? <Loader2 size={16} className={styles.spin} /> : null}
            {running ? "Se importă…" : `Importă ${items.length} ${items.length === 1 ? "produs" : "produse"}`}
          </button>
        </div>
      )}
    </section>
  );
}
