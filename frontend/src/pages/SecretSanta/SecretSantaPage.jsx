// src/pages/SecretSanta/SecretSantaPage.jsx
//
// /secret-santa - pagina publică a schimbului de cadouri între vânzătorii
// Artfest + (pentru vânzătorii autentificați) înscrierea și „Secret Santa-ul meu”.

import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Gift, Package, PartyPopper, Sparkles, Truck } from "lucide-react";
import { api } from "../../lib/api";
import { useAuth } from "../Auth/Context/context.js";
import { loginPathFor } from "../Auth/Login/loginRedirect.js";
import COUNTIES_RO from "../Vendor/Onboarding/constants/countiesRo.js";
import {
  SS_DATA_NOTICE,
  SS_PUBLIC_API,
  SS_RULES,
  SS_ADMIN_API,
  SS_OFFICIAL_OPENS_AT,
  SS_VENDOR_API,
  adminTestAvailable,
  formatSsDate,
  initialForm,
  pageMode,
  withEdition,
  participantsLabel,
} from "./secretSanta.js";
import styles from "./SecretSantaPage.module.css";

export default function SecretSantaPage() {
  const { me } = useAuth();
  const location = useLocation();
  // ediție de TEST: /secret-santa?test=<cheie> (nu apare public ca ediție oficială)
  const testKey = new URLSearchParams(location.search).get("test") || null;
  const [publicState, setPublicState] = useState({ loading: true, edition: null, error: "" });
  const [vendorState, setVendorState] = useState(null);
  const [vendorError, setVendorError] = useState("");
  // formularul de probă al Adminului (ediția TEST, fără emailuri), până la 17.11.2026
  const [adminTest, setAdminTest] = useState(null);
  const [adminTestError, setAdminTestError] = useState("");
  const openAdminTest = useCallback(async () => {
    try {
      const data = await api(`${SS_ADMIN_API}/test-form`);
      setAdminTest({ ...data, testFormUrl: `${SS_ADMIN_API}/test-form` });
      setAdminTestError("");
    } catch (error) {
      setAdminTestError(error?.message || "Nu am putut deschide formularul de probă.");
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api(withEdition(SS_PUBLIC_API, testKey))
      .then((data) => alive && setPublicState({ loading: false, edition: data?.edition || null, error: "" }))
      .catch(() => alive && setPublicState({ loading: false, edition: null, error: "" }));
    return () => {
      alive = false;
    };
  }, [testKey]);

  const reloadVendor = useCallback(async () => {
    try {
      const data = await api(withEdition(SS_VENDOR_API, testKey));
      setVendorState(data);
      setVendorError("");
      return data;
    } catch (error) {
      setVendorError(error?.message || "Nu am putut încărca înscrierea ta.");
      return null;
    }
  }, [testKey]);

  useEffect(() => {
    if (me?.role === "VENDOR") reloadVendor();
  }, [me?.role, reloadVendor]);

  const edition = vendorState?.edition || publicState.edition;
  const mode = pageMode({ edition, me, vendorState });

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.snow} aria-hidden="true">
          ❄ ✦ ❄ ✦ ❄
        </span>
        <span className={styles.heroIcon} aria-hidden="true">
          <Gift size={30} />
        </span>
        <p className={styles.kicker}>
          {edition?.test ? "MOD TEST · nu este evenimentul oficial" : "Doar pentru vânzătorii Artfest · gratuit"}
        </p>
        <h1 className={styles.title}>{edition?.title || "Secret Santa Artfest"}</h1>
        <p className={styles.subtitle}>
          Un schimb de cadouri handmade între creatorii Artfest. Tu faci pe cineva fericit, iar cineva se gândește la
          tine.
        </p>
        {edition ? (
          <div className={styles.chips}>
            {mode === "not_yet_open" ? (
              <span className={styles.chip}>Înscrierile încep pe {formatSsDate(edition.registrationOpensAt)}</span>
            ) : null}
            {edition.registrationClosesAt ? (
              <span className={styles.chip}>Înscrieri până la {formatSsDate(edition.registrationClosesAt)}</span>
            ) : null}
            {edition.shipByAt ? <span className={styles.chip}>Expediere până la {formatSsDate(edition.shipByAt)}</span> : null}
            {edition.participantCount ? <span className={styles.chip}>{participantsLabel(edition.participantCount)}</span> : null}
          </div>
        ) : null}
      </section>

      <section className={styles.steps} aria-label="Cum funcționează">
        <Step icon={<Sparkles size={20} />} title="1. Te înscrii" text="Completezi adresa de livrare și, dacă vrei, ce cadouri îți plac." />
        <Step icon={<PartyPopper size={20} />} title="2. Extragerea" text="Primești pe email vânzătorul căruia îi pregătești cadoul." />
        <Step icon={<Truck size={20} />} title="3. Trimiți cadoul" text="Îl expediezi până la termen și îl marchezi ca trimis." />
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Regulile, pe scurt</h2>
        <ol className={styles.rules}>
          {SS_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </section>

      <section className={styles.card} aria-live="polite">
        {publicState.loading ? <p className={styles.muted}>Se încarcă…</p> : null}
        {publicState.error ? <p className={styles.error}>{publicState.error}</p> : null}
        {vendorError && edition ? <p className={styles.error}>{vendorError}</p> : null}
        {adminTest ? (
          <div className={styles.form}>
            <p className={styles.testBanner} role="status">
              MOD TEST – înscriere de probă. Datele se salvează doar în ediția de test, nu se trimit emailuri.
            </p>
            {adminTest.registration ? (
              <Registered state={adminTest} onChanged={openAdminTest} />
            ) : (
              <RegistrationForm state={adminTest} onDone={openAdminTest} />
            )}
            <button type="button" className={styles.link} onClick={() => setAdminTest(null)}>
              Închide modul test
            </button>
          </div>
        ) : !publicState.loading && !publicState.error ? (
          <>
            <ActionArea mode={mode} state={vendorState} edition={edition} location={location} onChanged={reloadVendor} />
            {adminTestAvailable(me) ? (
              <div className={styles.cta}>
                <button type="button" className={styles.secondary} onClick={openAdminTest}>
                  Testează înscrierea
                </button>
                {adminTestError ? <p className={styles.error}>{adminTestError}</p> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </main>
  );
}

function Step({ icon, title, text }) {
  return (
    <div className={styles.step}>
      <span className={styles.stepIcon} aria-hidden="true">
        {icon}
      </span>
      <strong>{title}</strong>
      <span className={styles.muted}>{text}</span>
    </div>
  );
}

const testKeyOf = (state) => (state?.edition?.test ? state.edition.key : null);
// formularul de probă al Adminului folosește aceleași componente, cu alt endpoint (ediția TEST)
const registrationUrl = (state) =>
  state?.testFormUrl || withEdition(`${SS_VENDOR_API}/registration`, testKeyOf(state));
const withdrawUrl = (state) =>
  state?.testFormUrl ? `${state.testFormUrl}/withdraw` : withEdition(`${SS_VENDOR_API}/registration/withdraw`, testKeyOf(state));

function ActionArea({ mode, state, edition, location, onChanged }) {
  switch (mode) {
    case "not_yet_open":
      return (
        <p className={styles.muted}>
          Înscrierile încep pe {formatSsDate(edition?.registrationOpensAt || SS_OFFICIAL_OPENS_AT)}. Te așteptăm! 🎄
        </p>
      );
    case "no_edition":
      return <p className={styles.muted}>Înscrierile pentru Secret Santa nu sunt încă disponibile. Revino în curând, te așteptăm cu drag! 🎄</p>;
    case "login":
      return (
        <div className={styles.cta}>
          <p>Ai magazin pe Artfest? Intră în cont și înscrie-te.</p>
          <Link className={styles.primary} to={loginPathFor(location)}>
            Înscrie-te la Secret Santa
          </Link>
        </div>
      );
    case "not_vendor":
      return <p className={styles.muted}>Secret Santa este un schimb de cadouri doar între vânzătorii Artfest.</p>;
    case "loading":
      return <p className={styles.muted}>Se încarcă…</p>;
    case "not_eligible":
      return (
        <p className={styles.muted}>
          Pentru a participa ai nevoie de un cont de vânzător activ, cu cel puțin un magazin creat.
        </p>
      );
    case "missed":
      return <p className={styles.muted}>Extragerea a avut loc. Te așteptăm la ediția următoare! 🎁</p>;
    case "closed":
      return <p className={styles.muted}>Înscrierile pentru această ediție s-au închis.</p>;
    case "my_santa":
      return <MySanta state={state} onChanged={onChanged} />;
    case "registered":
      return <Registered state={state} onChanged={onChanged} />;
    case "form":
      return <RegistrationForm state={state} onDone={onChanged} />;
    default:
      return null;
  }
}

function RegistrationForm({ state, onDone, onCancel }) {
  const [form, setForm] = useState(() => initialForm(state));
  const [fields, setFields] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = Boolean(state?.registration);

  const set = (key) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setFields({});
    try {
      await api(registrationUrl(state), { method: "POST", body: form });
      await onDone?.();
      onCancel?.();
    } catch (err) {
      setFields(err?.data?.fields || {});
      setError(err?.message || "Nu am putut salva înscrierea.");
    } finally {
      setSaving(false);
    }
  };

  const input = (key, label, props = {}) => (
    <label className={styles.field}>
      <span>{label}</span>
      <input value={form[key]} onChange={set(key)} aria-invalid={Boolean(fields[key])} {...props} />
      {fields[key] ? <small className={styles.error}>{fields[key]}</small> : null}
    </label>
  );

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <h2 className={styles.cardTitle}>{editing ? "Modifică datele de livrare" : "Înscrie-te la Secret Santa"}</h2>

      {state?.stores?.length > 1 ? (
        <label className={styles.field}>
          <span>Magazinul tău Artfest</span>
          <select value={form.storeId} onChange={set("storeId")}>
            {state.stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      ) : state?.stores?.[0] ? (
        <p className={styles.muted}>
          Magazin: <strong>{state.stores[0].name}</strong>
        </p>
      ) : null}

      <div className={styles.grid}>
        {input("recipientName", "Nume și prenume destinatar", { autoComplete: "name", required: true })}
        {input("email", "Email", { type: "email", autoComplete: "email", required: true })}
        {input("phone", "Telefon pentru curier", { type: "tel", autoComplete: "tel", required: true })}
        <label className={styles.field}>
          <span>Județ</span>
          <select value={form.county} onChange={set("county")} aria-invalid={Boolean(fields.county)} required>
            <option value="">Alege județul</option>
            {COUNTIES_RO.map((county) => (
              <option key={county} value={county}>
                {county}
              </option>
            ))}
          </select>
          {fields.county ? <small className={styles.error}>{fields.county}</small> : null}
        </label>
        {input("city", "Localitate", { autoComplete: "address-level2", required: true })}
        {input("postalCode", "Cod poștal", { inputMode: "numeric", maxLength: 6, autoComplete: "postal-code", required: true })}
      </div>
      {input("address", "Adresă completă (stradă, număr, bloc, apartament)", { autoComplete: "street-address", required: true })}

      <label className={styles.field}>
        <span>Ce cadouri îți plac? (opțional)</span>
        <textarea
          rows={3}
          maxLength={500}
          value={form.preferences}
          onChange={set("preferences")}
          placeholder="Ex.: îmi plac lumânările și ceramica; evit parfumurile puternice."
        />
      </label>

      <label className={styles.check}>
        <input type="checkbox" checked={form.dataNotice} onChange={set("dataNotice")} />
        <span>
          Confirm regulile de mai sus și am citit cum sunt folosite datele de livrare:
          <small>{SS_DATA_NOTICE}</small>
        </span>
      </label>
      {fields.dataNotice ? <small className={styles.error}>{fields.dataNotice}</small> : null}

      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={saving}>
          {saving ? "Se salvează…" : editing ? "Salvează" : "Înscrie-te la Secret Santa"}
        </button>
        {onCancel ? (
          <button type="button" className={styles.secondary} onClick={onCancel} disabled={saving}>
            Renunță
          </button>
        ) : null}
      </div>
    </form>
  );
}

function Registered({ state, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reg = state.registration;
  const open = state.edition?.registrationOpen;

  if (editing) return <RegistrationForm state={state} onDone={onChanged} onCancel={() => setEditing(false)} />;

  const withdraw = async () => {
    if (!window.confirm("Sigur vrei să te retragi din Secret Santa? Datele tale de livrare vor fi șterse.")) return;
    setBusy(true);
    setError("");
    try {
      await api(withdrawUrl(state), { method: "POST" });
      await onChanged();
    } catch (err) {
      setError(err?.message || "Nu am putut anula înscrierea.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.done}>
      <h2 className={styles.cardTitle}>🎉 Ești înscris!</h2>
      <p>
        Participi cu magazinul <strong>{reg.storeName}</strong>. După extragere vezi aici (și primești pe email) vânzătorul
        căruia îi pregătești cadoul{state.edition?.shipByAt ? `, de expediat până la ${formatSsDate(state.edition.shipByAt)}` : ""}.
      </p>
      <p className={styles.muted}>
        Livrare la: {reg.recipientName}, {reg.address}, {reg.city}, jud. {reg.county}, {reg.postalCode}
      </p>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        {open ? (
          <button type="button" className={styles.secondary} onClick={() => setEditing(true)} disabled={busy}>
            Modifică datele
          </button>
        ) : null}
        <button type="button" className={styles.link} onClick={withdraw} disabled={busy}>
          Nu mai particip
        </button>
      </div>
    </div>
  );
}

function MySanta({ state, onChanged }) {
  const giving = state.giving;
  const recipient = giving?.recipient;
  const [awb, setAwb] = useState(giving?.awb || "");
  const [courierName, setCourierName] = useState(giving?.courierName || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const markShipped = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(withEdition(`${SS_VENDOR_API}/shipped`, testKeyOf(state)), { method: "POST", body: { awb, courierName } });
      await onChanged();
    } catch (err) {
      setError(err?.message || "Nu am putut salva expedierea.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.mySanta}>
      <h2 className={styles.cardTitle}>🎅 Secret Santa-ul meu</h2>
      {recipient ? (
        <div className={styles.recipient}>
          <p className={styles.muted}>Pregătești un cadou handmade (50–80 lei) pentru:</p>
          <p className={styles.recipientName}>{recipient.recipientName}</p>
          <p>
            Magazin: <strong>{recipient.storeName}</strong>
          </p>
          <p>
            {recipient.address}, {recipient.city}, jud. {recipient.county}, {recipient.postalCode}
          </p>
          <p>Telefon pentru curier: {recipient.phone}</p>
          {recipient.preferences ? (
            <p className={styles.preferences}>
              <strong>Preferințe:</strong> {recipient.preferences}
            </p>
          ) : null}
          {state.edition?.shipByAt ? (
            <p className={styles.deadline}>Expediază până la {formatSsDate(state.edition.shipByAt)}</p>
          ) : null}
        </div>
      ) : giving ? (
        <p className={styles.muted}>Ediția s-a încheiat, iar datele de livrare au fost șterse.</p>
      ) : (
        <p className={styles.muted}>Extragerea a avut loc; datele destinatarului tău apar aici în curând.</p>
      )}

      {giving && recipient ? (
        giving.shippedAt ? (
          <p className={styles.success}>
            <Package size={16} aria-hidden="true" /> Cadoul a fost marcat ca expediat pe {formatSsDate(giving.shippedAt)}
            {giving.awb ? ` (AWB ${giving.awb})` : ""}. Mulțumim! 🎄
          </p>
        ) : (
          <form className={styles.shipForm} onSubmit={markShipped}>
            <p className={styles.muted}>Ai trimis cadoul? Plătești tu transportul, fără ramburs la destinatar.</p>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span>AWB (opțional)</span>
                <input value={awb} onChange={(e) => setAwb(e.target.value)} maxLength={60} />
              </label>
              <label className={styles.field}>
                <span>Curier (opțional)</span>
                <input value={courierName} onChange={(e) => setCourierName(e.target.value)} maxLength={80} />
              </label>
            </div>
            {error ? <p className={styles.error}>{error}</p> : null}
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? "Se salvează…" : "Am expediat cadoul"}
            </button>
          </form>
        )
      ) : null}

      <div className={styles.incoming}>
        <h3>🎁 Cadoul tău</h3>
        {state.incoming?.shipped ? (
          <p>
            Secret Santa-ul tău a expediat cadoul
            {state.incoming.awb
              ? ` (AWB ${state.incoming.awb}${state.incoming.courierName ? `, ${state.incoming.courierName}` : ""})`
              : ""}
            . Surpriza e pe drum!
          </p>
        ) : (
          <p className={styles.muted}>Cadoul tău este în pregătire. Te anunțăm aici când pleacă spre tine.</p>
        )}
      </div>
    </div>
  );
}
