import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { guestCart } from "../../lib/guestCart";
import styles from "./Checkout.module.css";

const BACKEND_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const isHttp = (u = "") => /^https?:\/\//i.test(u);
const isDataOrBlob = (u = "") => /^(data|blob):/i.test(u);
const resolveFileUrl = (u) => {
  if (!u) return "";
  if (isHttp(u) || isDataOrBlob(u)) return u;
  const path = u.startsWith("/") ? u : `/${u}`;
  return BACKEND_BASE ? `${BACKEND_BASE}${path}` : path;
};

const money = (v, currency = "RON") =>
  new Intl.NumberFormat("ro-RO", { style: "currency", currency }).format(
    v ?? 0
  );

// transport standard: 15 lei / magazin (vendor)
const SHIPPING_PER_VENDOR = 15;

const normalizeDigits = (v = "") => v.replace(/\D/g, "");

const isValidPhone = (v = "") => /^\d{10}$/.test(normalizeDigits(v));

const isValidEmail = (v = "") => {
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

export default function Checkout() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]); // [{ productId, title, image, qty, price, currency, vendorId, vendorBilling }]
  const [currency, setCurrency] = useState("RON");
  const [subtotal, setSubtotal] = useState(0);

  const [address, setAddress] = useState({
    firstName: "",
    lastName: "",
    name: "", // nume complet – pentru backend / AWB
    phone: "",
    email: "",
    county: "", // cod județ (AB, AG, B, ...)
    city: "",
    postalCode: "",
    street: "",
    notes: "",
    // date firmă (PJ) – strictul necesar
    companyName: "",
    companyCui: "",
    companyRegCom: "",
  });

  const [customerType, setCustomerType] = useState("PF"); // "PF" | "PJ"

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CARD"); // "CARD" | "COD" (ramburs)

  const [counties, setCounties] = useState([]);
  const [countiesLoading, setCountiesLoading] = useState(true);

  // ce vede userul în input la Județ (nume, nu cod)
  const [countyInput, setCountyInput] = useState("");

  // control pentru afișarea dropdown-ului de județe
  const [showCountyDropdown, setShowCountyDropdown] = useState(false);

  // erori pe câmpuri
  const [fieldErrors, setFieldErrors] = useState({});

  // stepper
  const [activeStep, setActiveStep] = useState(1);
  const addressSectionRef = useRef(null);
  const paymentSectionRef = useRef(null);

  // refs pentru focus pe primul câmp cu eroare
  const lastNameRef = useRef(null);
  const firstNameRef = useRef(null);
  const emailRef = useRef(null);
  const phoneRef = useRef(null);
  const countyRef = useRef(null);
  const cityRef = useRef(null);
  const streetRef = useRef(null);
  const companyNameRef = useRef(null);
  const companyCuiRef = useRef(null);

  const fieldRefs = {
    lastName: lastNameRef,
    firstName: firstNameRef,
    email: emailRef,
    phone: phoneRef,
    county: countyRef,
    city: cityRef,
    street: streetRef,
    companyName: companyNameRef,
    companyCui: companyCuiRef,
  };

  // listă de județe filtrată + ordonată în funcție de ce scrie userul
  const filteredCounties = useMemo(() => {
    if (!counties.length) return [];

    const q = countyInput.trim().toLowerCase();

    if (!q) {
      return [...counties].sort((a, b) =>
        a.name.localeCompare(b.name, "ro")
      );
    }

    const filtered = counties.filter((c) => {
      const name = c.name.toLowerCase();
      const code = c.code.toLowerCase();
      return name.includes(q) || code.includes(q);
    });

    return filtered.sort((a, b) => {
      const na = a.name.toLowerCase();
      const nb = b.name.toLowerCase();

      const aStarts = na.startsWith(q);
      const bStarts = nb.startsWith(q);

      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      return na.localeCompare(nb, "ro");
    });
  }, [counties, countyInput]);

  // grupare produse per vendor (magazin)
  const vendors = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const v = String(it.vendorId || "unknown");
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(it);
    }
    return Array.from(map.entries()).map(([vendorId, its]) => ({
      vendorId,
      items: its,
    }));
  }, [items]);

  // transport total = 15 lei * numărul de magazine diferite
  const shippingTotal = useMemo(
    () => vendors.length * SHIPPING_PER_VENDOR,
    [vendors.length]
  );

  // 🔹 TVA per vendor + total (pe produse)
  const vatTotals = useMemo(() => {
    const round2 = (n) =>
      Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

    let totalNet = 0;
    let totalVat = 0;
    let totalGross = 0;

    const perVendorMap = new Map();

    for (const it of items) {
      const vendorKey = String(it.vendorId || "unknown");
      if (!perVendorMap.has(vendorKey)) {
        perVendorMap.set(vendorKey, {
          vendorId: vendorKey,
          net: 0,
          vat: 0,
          gross: 0,
          billing: it.vendorBilling || null,
        });
      }

      const vendorInfo = perVendorMap.get(vendorKey);

      const lineGross = (it.price || 0) * (it.qty || 0);

      const b = it.vendorBilling || null;
      // plătitor TVA dacă:
      //  - tvaActive === true (ANAF confirmat) SAU
      //  - vatStatus === "payer" (fallback la declarația vendorului)
      const isVatPayer =
        (b?.tvaActive === true) || (b?.vatStatus === "payer");

      const rateNum = isVatPayer && b?.vatRate ? parseFloat(b.vatRate) : 0;
      const hasRate = Number.isFinite(rateNum) && rateNum > 0;

      const lineNet = hasRate
        ? lineGross / (1 + rateNum / 100)
        : lineGross;
      const lineVat = lineGross - lineNet;

      vendorInfo.net += lineNet;
      vendorInfo.vat += lineVat;
      vendorInfo.gross += lineGross;

      totalNet += lineNet;
      totalVat += lineVat;
      totalGross += lineGross;
    }

    const perVendor = Array.from(perVendorMap.values()).map((v) => ({
      vendorId: v.vendorId,
      net: round2(v.net),
      vat: round2(v.vat),
      gross: round2(v.gross),
      billing: v.billing,
    }));

    return {
      totalNet: round2(totalNet),
      totalVat: round2(totalVat),
      totalGross: round2(totalGross),
      perVendor,
    };
  }, [items]);

  // total de plată = produse (cu TVA) + transport
  const grandTotal = useMemo(
    () => vatTotals.totalGross + shippingTotal,
    [vatTotals.totalGross, shippingTotal]
  );

  // form "basic valid" pentru disable la buton
  const isFormBasicallyValid = useMemo(() => {
    const baseValid =
      address.firstName &&
      address.lastName &&
      isValidEmail(address.email) &&
      isValidPhone(address.phone) &&
      address.county &&
      address.city &&
      address.street &&
      items.length > 0;

    if (!baseValid) return false;

    if (customerType === "PJ") {
      return !!address.companyName && !!address.companyCui;
    }

    return true; // PF
  }, [address, items.length, customerType]);

  // helper pentru ștergerea erorii unui câmp când userul editează
  function clearFieldError(name) {
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  // 1) Auth + cart summary + restore address din localStorage
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const d = await api("/api/auth/me").catch(() => null);
        const me = d?.user || null;
        if (!me) {
          const redir = encodeURIComponent("/checkout");
          nav(`/autentificare?redirect=${redir}`);
          return;
        }

        const local = guestCart.list();
        if (local.length) {
          try {
            const r = await api("/api/cart/merge", {
              method: "POST",
              body: { items: local },
            });
            guestCart.clear();
            try {
              window.dispatchEvent(new CustomEvent("cart:changed"));
            } catch {
              /* ignore */
            }
            if (r?.skipped > 0) {
              alert(
                r.merged > 0
                  ? `Am adăugat ${r.merged} produse în coșul tău. ${r.skipped} produse au fost omise.`
                  : `${r.skipped} produse din coșul de vizitator au fost omise.`
              );
            }
          } catch {
            /* ignore merge errors */
          }
        }

        const s = await api("/api/checkout/summary");
        setItems(Array.isArray(s?.items) ? s.items : []);
        setCurrency(s?.currency || "RON");
        setSubtotal(s?.subtotal || 0);

        // restore adresă + tip client din localStorage (dacă există)
        try {
          const saved = localStorage.getItem("checkoutAddress");
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === "object") {
              const { customerType: savedType, ...savedAddress } = parsed;
              setAddress((prev) => ({
                ...prev,
                ...savedAddress,
              }));
              if (savedType === "PF" || savedType === "PJ") {
                setCustomerType(savedType);
              }
            }
          }
        } catch {
          // ignore
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [nav]);

  // 2) Fetch județe
  useEffect(() => {
    let cancelled = false;
    setCountiesLoading(true);

    api("/api/geo/ro/counties")
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.items) ? res.items : [];
        setCounties(items);
      })
      .catch(() => {
        if (cancelled) return;
        setCounties([]);
      })
      .finally(() => {
        if (cancelled) return;
        setCountiesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // sincronizăm countyInput (label) cu codul din address.county când avem lista
  useEffect(() => {
    if (!address.county || !counties.length) return;
    const found = counties.find((c) => c.code === address.county);
    if (found) {
      setCountyInput(found.name);
    }
  }, [address.county, counties]);

  // salvare adresă + tip client în localStorage la fiecare modificare
  useEffect(() => {
    try {
      const data = JSON.stringify({ ...address, customerType });
      localStorage.setItem("checkoutAddress", data);
    } catch {
      // ignore
    }
  }, [address, customerType]);

  // selectare județ din dropdown
  function handleSelectCounty(county) {
    setCountyInput(county.name);
    setShowCountyDropdown(false);
    setAddress((prev) => ({
      ...prev,
      county: county.code,
    }));
    clearFieldError("county");
  }

  async function placeOrder() {
    if (!items.length) {
      setError("Coșul este gol.");
      return;
    }

    const newFieldErrors = {};

    if (!address.lastName) newFieldErrors.lastName = "Completează numele.";
    if (!address.firstName)
      newFieldErrors.firstName = "Completează prenumele.";
    if (!address.email) {
      newFieldErrors.email = "Completează adresa de email.";
    } else if (!isValidEmail(address.email)) {
      newFieldErrors.email = "Adresa de email nu este validă.";
    }

    if (!address.phone) {
      newFieldErrors.phone = "Completează telefonul.";
    } else if (!isValidPhone(address.phone)) {
      newFieldErrors.phone = "Numărul de telefon trebuie să aibă 10 cifre.";
    }

    if (!address.county) newFieldErrors.county = "Alege județul.";
    if (!address.city)
      newFieldErrors.city = "Completează orașul / localitatea.";
    if (!address.street)
      newFieldErrors.street = "Completează strada și numărul.";

    if (customerType === "PJ") {
      if (!address.companyName) {
        newFieldErrors.companyName = "Completează denumirea firmei.";
      }
      if (!address.companyCui) {
        newFieldErrors.companyCui = "Completează CUI-ul.";
      }
    }

    if (Object.keys(newFieldErrors).length > 0) {
      setFieldErrors(newFieldErrors);
      setError("Te rugăm să corectezi câmpurile marcate.");
      setActiveStep(1);

      // focus pe primul câmp cu eroare
      const firstKey = Object.keys(newFieldErrors)[0];
      const ref = fieldRefs[firstKey];
      const el = ref?.current;
      if (el && typeof el.focus === "function") {
        el.focus();
      }

      return;
    }

    setPlacing(true);
    setError("");
    setFieldErrors({});
    try {
      const fullName =
        address.name ||
        `${address.lastName || ""} ${address.firstName || ""}`.trim();

      const body = {
        address: {
          ...address,
          name: fullName,
        },
        customerType, // "PF" sau "PJ"
        paymentMethod, // "CARD" sau "COD" (ramburs)
        // shipping info rămâne cum îl ai în backend (poți să-l trimiți sau nu)
      };

      const r = await api("/api/checkout/place", {
        method: "POST",
        body,
      });

      try {
        window.dispatchEvent(new CustomEvent("cart:changed"));
      } catch {
        /* ignore */
      }

      if (paymentMethod === "CARD" && r?.payment?.redirectUrl) {
        window.location.href = r.payment.redirectUrl;
        return;
      }

      if (r?.orderId) {
        return nav(`/multumim?order=${encodeURIComponent(r.orderId)}`);
      }

      alert("Comanda a fost înregistrată.");
      nav("/comenzile-mele");
    } catch (e) {
      setError(e?.message || "Plasarea comenzii a eșuat.");
    } finally {
      setPlacing(false);
    }
  }

  // handlers pentru stepper (scroll la secțiuni)
  const goToStep1 = () => {
    setActiveStep(1);
    addressSectionRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const goToStep2 = () => {
    setActiveStep(2);
    paymentSectionRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  if (loading)
    return (
      <div className={styles.container}>
        Se încarcă detaliile comenzii…
      </div>
    );

  return (
    <div className={styles.container}>
      <h2 className={styles.pageTitle}>Checkout</h2>

      {/* stepper interactiv */}
      <div className={styles.steps}>
        <button
          type="button"
          className={`${styles.step} ${
            activeStep === 1 ? styles.stepActive : ""
          }`}
          onClick={goToStep1}
        >
          <span>1</span> Date livrare
        </button>
        <button
          type="button"
          className={`${styles.step} ${
            activeStep === 2 ? styles.stepActive : ""
          }`}
          onClick={goToStep2}
        >
          <span>2</span> Plată & confirmare
        </button>
      </div>

      {error && <div className={styles.alert}>{error}</div>}

      {items.length === 0 ? (
        <div className={styles.empty}>
          Coșul tău este gol.{" "}
          <a href="/produse" className={styles.linkPrimary}>
            Mergi la produse
          </a>
        </div>
      ) : (
        <div className={styles.layout}>
          {/* Stânga: produse + adresă + livrare per vendor */}
          <div className={styles.left}>
            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Produsele tale</h3>
              <p className={styles.muted}>
                Produsele sunt realizate de artizani independenți, special
                pentru evenimentul tău.
              </p>
              <ul className={styles.itemsList}>
                {items.map((it) => (
                  <li key={`${it.productId}`} className={styles.itemRow}>
                    <div className={styles.itemMedia}>
                      {it.image ? (
                        <img
                          src={resolveFileUrl(it.image)}
                          alt={it.title}
                          className={styles.thumb}
                        />
                      ) : (
                        <div className={styles.thumbPlaceholder} />
                      )}
                    </div>
                    <div className={styles.itemTitle}>{it.title}</div>
                    <div className={styles.itemQty}>x{it.qty}</div>
                    <div className={styles.itemPrice}>
                      {money(it.price * it.qty, it.currency || currency)}
                    </div>
                  </li>
                ))}
              </ul>
              <div className={styles.divider} />
              <div className={styles.summaryRow}>
                <span>Produse (total cu TVA)</span>
                <strong>{money(subtotal, currency)}</strong>
              </div>
            </section>

            <section
              ref={addressSectionRef}
              className={styles.card}
            >
              <h3 className={styles.cardTitle}>Adresă livrare</h3>

              {/* Tip client PF / PJ */}
              <div className={styles.customerTypeRow}>
                <span className={styles.customerTypeLabel}>Tip client</span>
                <div className={styles.customerTypeOptions}>
                  <label className={styles.radio}>
                    <input
                      type="radio"
                      name="customerType"
                      value="PF"
                      checked={customerType === "PF"}
                      onChange={() => setCustomerType("PF")}
                    />
                    <span>Persoană fizică</span>
                  </label>
                  <label className={styles.radio}>
                    <input
                      type="radio"
                      name="customerType"
                      value="PJ"
                      checked={customerType === "PJ"}
                      onChange={() => setCustomerType("PJ")}
                    />
                    <span>Persoană juridică (firmă)</span>
                  </label>
                </div>
              </div>

              <div className={styles.formGrid}>
                {/* NUME */}
                <label className={styles.field}>
                  <span>Nume*</span>
                  <input
                    ref={lastNameRef}
                    value={address.lastName}
                    onChange={(e) => {
                      const value = e.target.value;
                      clearFieldError("lastName");
                      setAddress((prev) => ({
                        ...prev,
                        lastName: value,
                        name: `${value} ${prev.firstName}`.trim(),
                      }));
                    }}
                    placeholder="Ex: Popescu"
                    aria-invalid={!!fieldErrors.lastName}
                    aria-describedby={
                      fieldErrors.lastName ? "error-lastName" : undefined
                    }
                  />
                  {fieldErrors.lastName && (
                    <span
                      id="error-lastName"
                      className={styles.fieldError}
                    >
                      {fieldErrors.lastName}
                    </span>
                  )}
                </label>

                {/* PRENUME */}
                <label className={styles.field}>
                  <span>Prenume*</span>
                  <input
                    ref={firstNameRef}
                    value={address.firstName}
                    onChange={(e) => {
                      const value = e.target.value;
                      clearFieldError("firstName");
                      setAddress((prev) => ({
                        ...prev,
                        firstName: value,
                        name: `${prev.lastName} ${value}`.trim(),
                      }));
                    }}
                    placeholder="Ex: Ana"
                    aria-invalid={!!fieldErrors.firstName}
                    aria-describedby={
                      fieldErrors.firstName ? "error-firstName" : undefined
                    }
                  />
                  {fieldErrors.firstName && (
                    <span
                      id="error-firstName"
                      className={styles.fieldError}
                    >
                      {fieldErrors.firstName}
                    </span>
                  )}
                </label>

                {/* EMAIL */}
                <label className={styles.field}>
                  <span>Email*</span>
                  <input
                    ref={emailRef}
                    type="email"
                    value={address.email}
                    onChange={(e) => {
                      clearFieldError("email");
                      setAddress({ ...address, email: e.target.value });
                    }}
                    placeholder="exemplu@domeniu.ro"
                    aria-invalid={!!fieldErrors.email}
                    aria-describedby={
                      fieldErrors.email ? "error-email" : undefined
                    }
                  />
                </label>
                {fieldErrors.email && (
                  <span id="error-email" className={styles.fieldError}>
                    {fieldErrors.email}
                  </span>
                )}

                {/* TELEFON */}
                <label className={styles.field}>
                  <span>Telefon*</span>
                  <input
                    ref={phoneRef}
                    type="tel"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={10}
                    value={address.phone}
                    onChange={(e) => {
                      const digits = normalizeDigits(e.target.value).slice(
                        0,
                        10
                      );
                      clearFieldError("phone");
                      setAddress({ ...address, phone: digits });
                    }}
                    placeholder="07xxxxxxxx"
                    aria-invalid={!!fieldErrors.phone}
                    aria-describedby={
                      fieldErrors.phone ? "error-phone" : undefined
                    }
                  />
                  {fieldErrors.phone && (
                    <span id="error-phone" className={styles.fieldError}>
                      {fieldErrors.phone}
                    </span>
                  )}
                </label>

                {/* JUDEȚ cu autosuggest */}
                <label className={styles.field}>
                  <span>Județ*</span>
                  {countiesLoading ? (
                    <div className={styles.selectPlaceholder}>
                      Se încarcă județele…
                    </div>
                  ) : (
                    <div className={styles.autocomplete}>
                      <input
                        ref={countyRef}
                        value={countyInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          clearFieldError("county");
                          setCountyInput(val);
                          setShowCountyDropdown(true);
                          setAddress((prev) => ({
                            ...prev,
                            county: "",
                          }));
                        }}
                        onFocus={() => {
                          if (counties.length) setShowCountyDropdown(true);
                        }}
                        onBlur={() => {
                          setTimeout(
                            () => setShowCountyDropdown(false),
                            150
                          );
                        }}
                        placeholder="Scrie numele județului..."
                        autoComplete="off"
                        aria-invalid={!!fieldErrors.county}
                        aria-describedby={
                          fieldErrors.county ? "error-county" : undefined
                        }
                      />

                      {showCountyDropdown &&
                        filteredCounties.length > 0 && (
                          <ul className={styles.autocompleteList}>
                            {filteredCounties.map((c) => (
                              <li
                                key={c.code}
                                className={styles.autocompleteItem}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleSelectCounty(c);
                                }}
                              >
                                {c.name}{" "}
                                <span className={styles.autocompleteCode}>
                                  ({c.code})
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
                  )}
                  {fieldErrors.county && (
                    <span
                      id="error-county"
                      className={styles.fieldError}
                    >
                      {fieldErrors.county}
                    </span>
                  )}
                </label>

                {/* LOCALITATE */}
                <label className={styles.field}>
                  <span>Oraș / Localitate*</span>
                  <input
                    ref={cityRef}
                    value={address.city}
                    onChange={(e) => {
                      clearFieldError("city");
                      setAddress((prev) => ({
                        ...prev,
                        city: e.target.value,
                      }));
                    }}
                    placeholder="Ex: București"
                    aria-invalid={!!fieldErrors.city}
                    aria-describedby={
                      fieldErrors.city ? "error-city" : undefined
                    }
                  />
                  {fieldErrors.city && (
                    <span id="error-city" className={styles.fieldError}>
                      {fieldErrors.city}
                    </span>
                  )}
                </label>

                {/* COD POȘTAL */}
                <label className={styles.field}>
                  <span>Cod poștal</span>
                  <input
                    value={address.postalCode}
                    onChange={(e) =>
                      setAddress((prev) => ({
                        ...prev,
                        postalCode: e.target.value,
                      }))
                    }
                    placeholder="Ex: 040011"
                  />
                </label>

                {/* STRADĂ */}
                <label className={styles.fieldFull}>
                  <span>Stradă și număr*</span>
                  <input
                    ref={streetRef}
                    value={address.street}
                    onChange={(e) => {
                      clearFieldError("street");
                      setAddress({ ...address, street: e.target.value });
                    }}
                    placeholder="Ex: Șos. Olteniței 123"
                    aria-invalid={!!fieldErrors.street}
                    aria-describedby={
                      fieldErrors.street ? "error-street" : undefined
                    }
                  />
                  {fieldErrors.street && (
                    <span
                      id="error-street"
                      className={styles.fieldError}
                    >
                      {fieldErrors.street}
                    </span>
                  )}
                </label>

                {/* OBSERVAȚII */}
                <label className={styles.fieldFull}>
                  <span>Observații (opțional)</span>
                  <textarea
                    value={address.notes}
                    onChange={(e) =>
                      setAddress({ ...address, notes: e.target.value })
                    }
                    placeholder="Detalii pentru curier (interfon, interval orar, persoană de contact la eveniment etc.)"
                    rows={3}
                  />
                </label>

                {/* DATE FIRMĂ – doar dacă este persoană juridică */}
                {customerType === "PJ" && (
                  <>
                    <div className={styles.fieldFull}>
                      <span className={styles.sectionLabel}>
                        Date facturare firmă
                      </span>
                    </div>

                    <label className={styles.fieldFull}>
                      <span>Denumire firmă*</span>
                      <input
                        ref={companyNameRef}
                        value={address.companyName}
                        onChange={(e) => {
                          const value = e.target.value;
                          clearFieldError("companyName");
                          setAddress((prev) => ({
                            ...prev,
                            companyName: value,
                          }));
                        }}
                        placeholder="Ex: SC Exemplu SRL"
                        aria-invalid={!!fieldErrors.companyName}
                        aria-describedby={
                          fieldErrors.companyName
                            ? "error-companyName"
                            : undefined
                        }
                      />
                      {fieldErrors.companyName && (
                        <span
                          id="error-companyName"
                          className={styles.fieldError}
                        >
                          {fieldErrors.companyName}
                        </span>
                      )}
                    </label>

                    <label className={styles.field}>
                      <span>CUI*</span>
                      <input
                        ref={companyCuiRef}
                        value={address.companyCui}
                        onChange={(e) => {
                          const value = e.target.value;
                          clearFieldError("companyCui");
                          setAddress((prev) => ({
                            ...prev,
                            companyCui: value,
                          }));
                        }}
                        placeholder="Ex: RO12345678"
                        aria-invalid={!!fieldErrors.companyCui}
                        aria-describedby={
                          fieldErrors.companyCui
                            ? "error-companyCui"
                            : undefined
                        }
                      />
                      {fieldErrors.companyCui && (
                        <span
                          id="error-companyCui"
                          className={styles.fieldError}
                        >
                          {fieldErrors.companyCui}
                        </span>
                      )}
                    </label>

                    <label className={styles.field}>
                      <span>Nr. Reg. Comerțului</span>
                      <input
                        value={address.companyRegCom}
                        onChange={(e) =>
                          setAddress((prev) => ({
                            ...prev,
                            companyRegCom: e.target.value,
                          }))
                        }
                        placeholder="Ex: J40/1234/2024"
                      />
                    </label>
                  </>
                )}
              </div>
            </section>

            {/* livrare per vendor – simplu, 15 lei / magazin */}
            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Metodă de livrare</h3>
              <p className={styles.muted}>
                Livrare standard prin curier:{" "}
                <strong>15 lei / magazin</strong>. Dacă ai produse de la
                mai mulți artizani, costul de transport se calculează
                separat pentru fiecare, astfel încât să ajungă la timp
                pentru eveniment.
              </p>

              <div className={styles.shipGrid}>
                {vendors.map((g) => {
                  const key = String(g.vendorId);
                  return (
                    <div key={key} className={styles.vendorBox}>
                      <div className={styles.vendorHead}>
                        <strong>Magazin #{key.slice(0, 6)}…</strong>
                        <span>{g.items.length} produse</span>
                      </div>
                      <div className={styles.summaryRow}>
                        <span>Curier standard</span>
                        <strong>
                          {money(SHIPPING_PER_VENDOR, currency)}
                        </strong>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.divider} />
              <div className={styles.summaryRow}>
                <span>Transport total</span>
                <strong>{money(shippingTotal, currency)}</strong>
              </div>
            </section>
          </div>

          {/* Dreapta: sumar + plată + plasare */}
          <aside className={styles.right}>
            <div
              ref={paymentSectionRef}
              className={styles.card}
            >
              <h3 className={styles.cardTitle}>Sumar comandă</h3>
              <p className={styles.muted}>
                Ai produse de la{" "}
                <strong>{vendors.length}</strong>{" "}
                {vendors.length === 1
                  ? "magazin (artizan)."
                  : "magazine (artizani)."}{" "}
                Fiecare pregătește și trimite produsele separat.
              </p>

              <div className={styles.summaryRow}>
                <span>Produse (fără TVA)</span>
                <strong>{money(vatTotals.totalNet, currency)}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>TVA produse</span>
                <strong>{money(vatTotals.totalVat, currency)}</strong>
              </div>
              <div className={styles.summaryRow}>
                <span>Transport</span>
                <strong>{money(shippingTotal, currency)}</strong>
              </div>

              <div className={styles.divider} />

              <div className={styles.summaryRow}>
                <span>Metodă de plată</span>
              </div>
              <div className={styles.paymentMethods}>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="CARD"
                    checked={paymentMethod === "CARD"}
                    onChange={() => setPaymentMethod("CARD")}
                  />
                  <span>Card online</span>
                </label>
                <label className={styles.radio}>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="COD"
                    checked={paymentMethod === "COD"}
                    onChange={() => setPaymentMethod("COD")}
                  />
                  <span>Plată la livrare (ramburs)</span>
                </label>
              </div>

              <div className={styles.divider} />
              <div className={styles.totalRow}>
                <span>Total de plată</span>
                <strong>{money(grandTotal, currency)}</strong>
              </div>

              <button
                className={styles.primaryBtn}
                onClick={placeOrder}
                disabled={placing || !isFormBasicallyValid}
                type="button"
              >
                {placing
                  ? paymentMethod === "CARD"
                    ? "Redirecționăm către procesatorul de plăți…"
                    : "Se plasează…"
                  : "Plasează comanda"}
              </button>

              {!isFormBasicallyValid && !placing && (
                <p className={styles.helperText}>
                  Completează câmpurile obligatorii marcate cu * pentru a
                  continua.
                </p>
              )}

              <p className={styles.legalNote}>
                Continuând, accepți{" "}
                <a href="/termeni" target="_blank" rel="noreferrer">
                  Termenii
                </a>{" "}
                și confirmi că ai citit{" "}
                <a
                  href="/confidentialitate"
                  target="_blank"
                  rel="noreferrer"
                >
                  Politica de confidențialitate
                </a>
                .
              </p>
            </div>

            <div className={styles.card}>
              <h4 className={styles.cardTitleSmall}>Retur & GDPR</h4>
              <ul className={styles.bullets}>
                <li>
                  Vezi{" "}
                  <a
                    href="/politica-de-retur"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Politica de retur
                  </a>
                  .
                </li>
                <li>
                  La generarea AWB, datele de livrare sunt transmise
                  curierului.
                </li>
              </ul>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
