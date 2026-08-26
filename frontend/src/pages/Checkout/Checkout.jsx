import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { api } from "../../lib/api";
import {
  trackBeginCheckout,
} from "../../../services/analytics.js";
import {
  getGuestCart,
  clearGuestCart,
} from "../../utils/guestCart";
import { getAttributionsForCheckout } from "../../utils/campaignAttribution.js";
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
  new Intl.NumberFormat("ro-RO", {
    style: "currency",
    currency,
  }).format(v ?? 0);

const normalizeDigits = (v = "") => v.replace(/\D/g, "");
const normalizeText = (v = "") => String(v || "").trim();
const normalizeCui = (v = "") =>
  String(v || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "")
    .trim();

const isValidPhone = (v = "") => /^\d{10}$/.test(normalizeDigits(v));

const isValidEmail = (v = "") => {
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

const isValidPostalCode = (v = "") => {
  const trimmed = String(v || "").trim();
  return !trimmed || /^\d{6}$/.test(trimmed);
};

const isValidCui = (v = "") => {
  const cui = normalizeCui(v);

  if (!cui) return false;

  if (cui.startsWith("RO")) {
    return /^RO\d{2,10}$/.test(cui);
  }

  return /^\d{2,10}$/.test(cui);
};

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function buildFullName(address) {
  if (normalizeText(address.name)) return normalizeText(address.name);
  return `${normalizeText(address.lastName)} ${normalizeText(
    address.firstName
  )}`.trim();
}

function getGroupSubtotal(group) {
  return round2(
    (group?.items || []).reduce(
      (sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0),
      0
    )
  );
}

function getGroupShipping(group) {
  const subtotal = getGroupSubtotal(group);

  const estimated = Number(group?.estimatedShippingFee ?? 0);
  const freeThreshold =
    group?.freeShippingThreshold !== null &&
    group?.freeShippingThreshold !== undefined
      ? Number(group.freeShippingThreshold)
      : null;

  const qualifiesFreeShipping =
    freeThreshold !== null && subtotal >= freeThreshold;

  return {
    subtotal,
    estimatedShippingFee: round2(estimated),
    freeShippingThreshold:
      freeThreshold !== null ? round2(freeThreshold) : null,
    qualifiesFreeShipping,
    finalShipping: qualifiesFreeShipping ? 0 : round2(estimated),
  };
}

function validateCheckoutForm({
  shippingAddress,
  billingCompany,
  contactPerson,
  customerType,
  items,
  shipToDifferentAddress,
}) {
  const errors = {};

  if (!items.length) {
    return {
      formError: "Coșul este gol.",
      errors,
    };
  }

  if (customerType === "PF") {
    if (!normalizeText(shippingAddress.lastName)) {
      errors.lastName = "Completează numele.";
    }

    if (!normalizeText(shippingAddress.firstName)) {
      errors.firstName = "Completează prenumele.";
    }

    if (!normalizeText(shippingAddress.email)) {
      errors.email = "Completează adresa de email.";
    } else if (!isValidEmail(shippingAddress.email)) {
      errors.email = "Introdu o adresă de email validă.";
    }

    if (!normalizeText(shippingAddress.phone)) {
      errors.phone = "Completează numărul de telefon.";
    } else if (!isValidPhone(shippingAddress.phone)) {
      errors.phone = "Numărul de telefon trebuie să conțină exact 10 cifre.";
    }

    if (!shippingAddress.county) {
      errors.county = "Selectează județul din listă.";
    }

    if (!normalizeText(shippingAddress.city)) {
      errors.city = "Completează orașul / localitatea.";
    }

    if (!normalizeText(shippingAddress.street)) {
      errors.street = "Completează strada și numărul.";
    }

    if (!isValidPostalCode(shippingAddress.postalCode)) {
      errors.postalCode = "Codul poștal trebuie să aibă exact 6 cifre.";
    }
  }

  if (customerType === "PJ") {
    if (!normalizeText(billingCompany.companyName)) {
      errors.companyName = "Completează denumirea firmei.";
    }

    if (!normalizeText(billingCompany.companyCui)) {
      errors.companyCui = "Completează CUI-ul firmei.";
    } else if (!isValidCui(billingCompany.companyCui)) {
      errors.companyCui =
        "CUI-ul trebuie să fie de forma 12345678 sau RO12345678.";
    }

    if (!billingCompany.county) {
      errors.companyCounty = "Selectează județul sediului din listă.";
    }

    if (!normalizeText(billingCompany.city)) {
      errors.companyCity = "Completează orașul sediului.";
    }

    if (!normalizeText(billingCompany.street)) {
      errors.companyStreet = "Completează strada și numărul sediului.";
    }

    if (!isValidPostalCode(billingCompany.postalCode)) {
      errors.companyPostalCode =
        "Codul poștal al sediului trebuie să aibă exact 6 cifre.";
    }

    if (!normalizeText(contactPerson.lastName)) {
      errors.contactLastName = "Completează numele persoanei de contact.";
    }

    if (!normalizeText(contactPerson.firstName)) {
      errors.contactFirstName = "Completează prenumele persoanei de contact.";
    }

    if (!normalizeText(contactPerson.email)) {
      errors.contactEmail =
        "Completează adresa de email a persoanei de contact.";
    } else if (!isValidEmail(contactPerson.email)) {
      errors.contactEmail =
        "Introdu o adresă de email validă pentru persoana de contact.";
    }

    if (!normalizeText(contactPerson.phone)) {
      errors.contactPhone = "Completează telefonul persoanei de contact.";
    } else if (!isValidPhone(contactPerson.phone)) {
      errors.contactPhone =
        "Telefonul persoanei de contact trebuie să conțină exact 10 cifre.";
    }

    if (shipToDifferentAddress) {
      if (!normalizeText(shippingAddress.lastName)) {
        errors.lastName = "Completează numele.";
      }

      if (!normalizeText(shippingAddress.firstName)) {
        errors.firstName = "Completează prenumele.";
      }

      if (!normalizeText(shippingAddress.email)) {
        errors.email = "Completează adresa de email.";
      } else if (!isValidEmail(shippingAddress.email)) {
        errors.email = "Introdu o adresă de email validă.";
      }

      if (!normalizeText(shippingAddress.phone)) {
        errors.phone = "Completează numărul de telefon.";
      } else if (!isValidPhone(shippingAddress.phone)) {
        errors.phone = "Numărul de telefon trebuie să conțină exact 10 cifre.";
      }

      if (!shippingAddress.county) {
        errors.county = "Selectează județul din listă.";
      }

      if (!normalizeText(shippingAddress.city)) {
        errors.city = "Completează orașul / localitatea.";
      }

      if (!normalizeText(shippingAddress.street)) {
        errors.street = "Completează strada și numărul.";
      }

      if (!isValidPostalCode(shippingAddress.postalCode)) {
        errors.postalCode = "Codul poștal trebuie să aibă exact 6 cifre.";
      }
    }
  }

  return { errors };
}

function validateSingleField({
  fieldName,
  shippingAddress,
  billingCompany,
  contactPerson,
}) {
  switch (fieldName) {
    case "lastName":
      if (!normalizeText(shippingAddress.lastName)) {
        return "Completează numele.";
      }
      return "";

    case "firstName":
      if (!normalizeText(shippingAddress.firstName)) {
        return "Completează prenumele.";
      }
      return "";

    case "email":
      if (!normalizeText(shippingAddress.email)) {
        return "Completează adresa de email.";
      }
      if (!isValidEmail(shippingAddress.email)) {
        return "Introdu o adresă de email validă.";
      }
      return "";

    case "phone":
      if (!normalizeText(shippingAddress.phone)) {
        return "Completează numărul de telefon.";
      }
      if (!isValidPhone(shippingAddress.phone)) {
        return "Numărul de telefon trebuie să conțină exact 10 cifre.";
      }
      return "";

    case "county":
      if (!shippingAddress.county) {
        return "Selectează județul din listă.";
      }
      return "";

    case "city":
      if (!normalizeText(shippingAddress.city)) {
        return "Completează orașul / localitatea.";
      }
      return "";

    case "street":
      if (!normalizeText(shippingAddress.street)) {
        return "Completează strada și numărul.";
      }
      return "";

    case "postalCode":
      if (!isValidPostalCode(shippingAddress.postalCode)) {
        return "Codul poștal trebuie să aibă exact 6 cifre.";
      }
      return "";

    case "companyName":
      if (!normalizeText(billingCompany.companyName)) {
        return "Completează denumirea firmei.";
      }
      return "";

    case "companyCui":
      if (!normalizeText(billingCompany.companyCui)) {
        return "Completează CUI-ul firmei.";
      }
      if (!isValidCui(billingCompany.companyCui)) {
        return "CUI-ul trebuie să fie de forma 12345678 sau RO12345678.";
      }
      return "";

    case "companyCounty":
      if (!billingCompany.county) {
        return "Selectează județul sediului din listă.";
      }
      return "";

    case "companyCity":
      if (!normalizeText(billingCompany.city)) {
        return "Completează orașul sediului.";
      }
      return "";

    case "companyStreet":
      if (!normalizeText(billingCompany.street)) {
        return "Completează strada și numărul sediului.";
      }
      return "";

    case "companyPostalCode":
      if (!isValidPostalCode(billingCompany.postalCode)) {
        return "Codul poștal al sediului trebuie să aibă exact 6 cifre.";
      }
      return "";

    case "contactLastName":
      if (!normalizeText(contactPerson.lastName)) {
        return "Completează numele persoanei de contact.";
      }
      return "";

    case "contactFirstName":
      if (!normalizeText(contactPerson.firstName)) {
        return "Completează prenumele persoanei de contact.";
      }
      return "";

    case "contactEmail":
      if (!normalizeText(contactPerson.email)) {
        return "Completează adresa de email a persoanei de contact.";
      }
      if (!isValidEmail(contactPerson.email)) {
        return "Introdu o adresă de email validă pentru persoana de contact.";
      }
      return "";

    case "contactPhone":
      if (!normalizeText(contactPerson.phone)) {
        return "Completează telefonul persoanei de contact.";
      }
      if (!isValidPhone(contactPerson.phone)) {
        return "Telefonul persoanei de contact trebuie să conțină exact 10 cifre.";
      }
      return "";

    default:
      return "";
  }
}

function getReadableApiError(error) {
  const raw =
    error?.message ||
    error?.error ||
    error?.code ||
    error?.response?.message ||
    "";

  const normalized = String(raw).trim().toLowerCase();

  switch (normalized) {
    case "company_invalid":
      return "Datele firmei nu sunt valide. Verifică denumirea firmei, CUI-ul și adresa de facturare.";

    case "company_cui_invalid":
      return "CUI-ul firmei nu este valid. Introdu un CUI de forma 12345678 sau RO12345678.";

    case "company_name_required":
      return "Completează denumirea firmei.";

    case "company_address_invalid":
      return "Adresa firmei este incompletă sau invalidă. Verifică județul, orașul și strada.";

    case "contact_invalid":
      return "Datele persoanei de contact nu sunt valide. Verifică numele, emailul și telefonul.";

    case "address_invalid":
      return "Adresa de livrare este incompletă sau invalidă.";

    case "email_invalid":
      return "Adresa de email introdusă nu este validă.";

    case "phone_invalid":
      return "Numărul de telefon introdus nu este valid.";

    case "cart_empty":
      return "Coșul este gol.";

    case "payment_invalid":
      return "Metoda de plată selectată nu este validă.";

    default:
      return raw || "Plasarea comenzii a eșuat. Verifică datele completate.";
  }
}

function focusFirstError(fieldErrors, fieldRefs) {
  const firstKey = Object.keys(fieldErrors)[0];
  if (!firstKey) return;

  const ref = fieldRefs[firstKey];
  const el = ref?.current;

  if (el && typeof el.focus === "function") {
    el.focus();
  }
}

function getItemVatBreakdown(item) {
  const qty = Number(item?.qty || 0);
  const gross = Number(item?.price || 0) * qty;

  const billing = item?.vendorBilling || null;
  const isVatPayer =
    billing?.tvaActive === true || billing?.vatStatus === "payer";

  const rateNum =
    isVatPayer && billing?.vatRate ? parseFloat(billing.vatRate) : 0;

  const hasRate = Number.isFinite(rateNum) && rateNum > 0;
  const net = hasRate ? gross / (1 + rateNum / 100) : gross;
  const vat = gross - net;

  return {
    gross: round2(gross),
    net: round2(net),
    vat: round2(vat),
  };
}

function getObjectEntries(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return [];
  }

  return Object.entries(value).filter(
    ([, itemValue]) => {
      if (
        itemValue === null ||
        itemValue === undefined
      ) {
        return false;
      }

      if (
        typeof itemValue === "string"
      ) {
        return itemValue.trim() !== "";
      }

      return true;
    }
  );
}

function getReadableConfigValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .map(getReadableConfigValue)
      .filter(Boolean)
      .join(", ");
  }

  if (typeof value === "object") {
    return (
      value.label ||
      value.value ||
      value.name ||
      JSON.stringify(value)
    );
  }

  return String(value);
}

function isCustomizationImage(value) {
  if (typeof value !== "string") return false;

  const url = value.trim();
  if (!url) return false;

  return (
    /^(https?:\/\/|data:image\/|blob:)/i.test(url) ||
    url.includes("/customizations/") ||
    /\.(jpg|jpeg|png|webp|gif|heic|heif|bmp|tiff|avif)(\?.*)?$/i.test(url)
  );
}

function formatConfigLabel(key) {
  return String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase()
    );
}

export default function Checkout() {
  const nav = useNavigate();
    /*
   * =========================================================
   * CHECKOUT DIN OFERTĂ
   * =========================================================
   */

  const quoteCheckoutParams =
    useMemo(() => {
      if (
        typeof window ===
        "undefined"
      ) {
        return {
          quoteId: "",
          offerId: "",
        };
      }

      const params =
        new URLSearchParams(
          window.location.search
        );

      return {
        quoteId:
          String(
            params.get(
              "quoteId"
            ) || ""
          ).trim(),

        offerId:
          String(
            params.get(
              "offerId"
            ) || ""
          ).trim(),
      };
    }, []);

  const quoteId =
    quoteCheckoutParams
      .quoteId;

  const offerId =
    quoteCheckoutParams
      .offerId;

  const isQuoteCheckout =
    Boolean(
      quoteId &&
      offerId
    );

  const [
    quoteCheckout,
    setQuoteCheckout,
  ] = useState(null);
const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [currency, setCurrency] = useState("RON");

  const [shippingAddress, setShippingAddress] = useState({
    firstName: "",
    lastName: "",
    name: "",
    phone: "",
    email: "",
    county: "",
    city: "",
    postalCode: "",
    street: "",
    notes: "",
  });

  const [billingCompany, setBillingCompany] = useState({
    companyName: "",
    companyCui: "",
    companyRegCom: "",
    county: "",
    city: "",
    postalCode: "",
    street: "",
  });

  const [contactPerson, setContactPerson] = useState({
    firstName: "",
    lastName: "",
    name: "",
    phone: "",
    email: "",
  });

  const [customerType, setCustomerType] = useState("PF");
  const [shipToDifferentAddress, setShipToDifferentAddress] = useState(false);

  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("COD");
  const [previewImage, setPreviewImage] = useState(null);

  const [counties, setCounties] = useState([]);
  const [countiesLoading, setCountiesLoading] = useState(true);

  const [countyInput, setCountyInput] = useState("");
  const [companyCountyInput, setCompanyCountyInput] = useState("");

  const [showCountyDropdown, setShowCountyDropdown] = useState(false);
  const [showCompanyCountyDropdown, setShowCompanyCountyDropdown] =
    useState(false);

  const [fieldErrors, setFieldErrors] = useState({});
  const [activeStep, setActiveStep] = useState(1);
const checkoutTrackedRef =
  useRef(false);
  const addressSectionRef = useRef(null);
  const paymentSectionRef = useRef(null);

  const lastNameRef = useRef(null);
  const firstNameRef = useRef(null);
  const emailRef = useRef(null);
  const phoneRef = useRef(null);
  const countyRef = useRef(null);
  const cityRef = useRef(null);
  const streetRef = useRef(null);
  const postalCodeRef = useRef(null);

  const companyNameRef = useRef(null);
  const companyCuiRef = useRef(null);
  const companyCountyRef = useRef(null);
  const companyCityRef = useRef(null);
  const companyStreetRef = useRef(null);
  const companyPostalCodeRef = useRef(null);

  const contactLastNameRef = useRef(null);
  const contactFirstNameRef = useRef(null);
  const contactEmailRef = useRef(null);
  const contactPhoneRef = useRef(null);

  const fieldRefs = useMemo(
    () => ({
      lastName: lastNameRef,
      firstName: firstNameRef,
      email: emailRef,
      phone: phoneRef,
      county: countyRef,
      city: cityRef,
      street: streetRef,
      postalCode: postalCodeRef,
      companyName: companyNameRef,
      companyCui: companyCuiRef,
      companyCounty: companyCountyRef,
      companyCity: companyCityRef,
      companyStreet: companyStreetRef,
      companyPostalCode: companyPostalCodeRef,
      contactLastName: contactLastNameRef,
      contactFirstName: contactFirstNameRef,
      contactEmail: contactEmailRef,
      contactPhone: contactPhoneRef,
    }),
    []
  );

  useEffect(() => {
    if (!previewImage) return;

    const previousOverflow = document.body.style.overflow;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setPreviewImage(null);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewImage]);

  const filteredCounties = useMemo(() => {
    if (!counties.length) return [];

    const q = countyInput.trim().toLowerCase();

    if (!q) {
      return [...counties].sort((a, b) => a.name.localeCompare(b.name, "ro"));
    }

    return counties
      .filter((c) => {
        const name = c.name.toLowerCase();
        const code = c.code.toLowerCase();
        return name.includes(q) || code.includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ro"));
  }, [counties, countyInput]);

  const filteredCompanyCounties = useMemo(() => {
    if (!counties.length) return [];

    const q = companyCountyInput.trim().toLowerCase();

    if (!q) {
      return [...counties].sort((a, b) => a.name.localeCompare(b.name, "ro"));
    }

    return counties
      .filter((c) => {
        const name = c.name.toLowerCase();
        const code = c.code.toLowerCase();
        return name.includes(q) || code.includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ro"));
  }, [counties, companyCountyInput]);

  const serviceGroups = useMemo(() => {
    if (Array.isArray(groups) && groups.length > 0) return groups;

    const map = new Map();

    for (const it of items) {
      const serviceKey = String(it.serviceId || "unknown");

      if (!map.has(serviceKey)) {
        map.set(serviceKey, {
          serviceId: it.serviceId || null,
          vendorId: it.vendorId || null,
          serviceTitle: "Magazin",
          estimatedShippingFee:
            it.estimatedShippingFee !== null &&
            it.estimatedShippingFee !== undefined
              ? Number(it.estimatedShippingFee)
              : 0,
          freeShippingThreshold:
            it.freeShippingThreshold !== null &&
            it.freeShippingThreshold !== undefined
              ? Number(it.freeShippingThreshold)
              : null,
          shippingNotes: it.shippingNotes || null,
          items: [],
        });
      }

      map.get(serviceKey).items.push(it);
    }

    return Array.from(map.values());
  }, [groups, items]);

  const vatTotals = useMemo(() => {
    let totalNet = 0;
    let totalVat = 0;
    let totalGross = 0;

    for (const it of items) {
      const qty = Number(it.qty || 0);
      const price = Number(it.price || 0);
      const lineGross = price * qty;

      const billing = it.vendorBilling || null;
      const isVatPayer =
        billing?.tvaActive === true || billing?.vatStatus === "payer";

      const rateNum =
        isVatPayer && billing?.vatRate ? parseFloat(billing.vatRate) : 0;

      const hasRate = Number.isFinite(rateNum) && rateNum > 0;

      const lineNet = hasRate ? lineGross / (1 + rateNum / 100) : lineGross;
      const lineVat = lineGross - lineNet;

      totalNet += lineNet;
      totalVat += lineVat;
      totalGross += lineGross;
    }

    return {
      totalNet: round2(totalNet),
      totalVat: round2(totalVat),
      totalGross: round2(totalGross),
    };
  }, [items]);


  const shippingTotal =
  useMemo(() => {
    /*
     * Pentru oferta negociată folosim
     * EXACT transportul stabilit de vendor.
     */
    if (
      isQuoteCheckout
    ) {
      return round2(
        Number(
          quoteCheckout
            ?.offer
            ?.shippingTotal ||
          0
        )
      );
    }

    /*
     * Checkout normal.
     */
    return round2(
      serviceGroups.reduce(
        (
          sum,
          group
        ) =>
          sum +
          getGroupShipping(
            group
          )
            .finalShipping,
        0
      )
    );
  }, [
    isQuoteCheckout,
    quoteCheckout,
    serviceGroups,
  ]);

 const grandTotal =
  useMemo(() => {
    if (
      isQuoteCheckout &&
      Number.isFinite(
        Number(
          quoteCheckout
            ?.offer
            ?.total
        )
      )
    ) {
      return round2(
        Number(
          quoteCheckout
            .offer
            .total
        )
      );
    }

    return round2(
      vatTotals
        .totalGross +
      shippingTotal
    );
  }, [
    isQuoteCheckout,
    quoteCheckout,
    vatTotals.totalGross,
    shippingTotal,
  ]);

  useEffect(() => {
  /*
   * Așteptăm până când checkout-ul
   * a terminat încărcarea.
   */
  if (loading) {
    return;
  }

  /*
   * Nu trimitem InitiateCheckout
   * pentru un coș gol.
   */
  if (!items.length) {
    return;
  }

  /*
   * Trimitem evenimentul o singură
   * dată pentru această vizită
   * în checkout.
   */
  if (checkoutTrackedRef.current) {
    return;
  }

  const numItems =
    items.reduce(
      (total, item) =>
        total +
        Number(
          item?.qty || 0
        ),
      0
    );

  checkoutTrackedRef.current =
    true;

  trackBeginCheckout(
  grandTotal,
  {
    currency:
      currency || "RON",

    numItems,

    items,
  }
);
}, [
  loading,
  items,
  grandTotal,
  currency,
]);

  const isAddressStepValid = useMemo(() => {
    if (customerType === "PF") {
      return (
        !!normalizeText(shippingAddress.firstName) &&
        !!normalizeText(shippingAddress.lastName) &&
        isValidEmail(shippingAddress.email) &&
        isValidPhone(shippingAddress.phone) &&
        !!shippingAddress.county &&
        !!normalizeText(shippingAddress.city) &&
        !!normalizeText(shippingAddress.street) &&
        isValidPostalCode(shippingAddress.postalCode)
      );
    }

    const companyValid =
      !!normalizeText(billingCompany.companyName) &&
      isValidCui(billingCompany.companyCui) &&
      !!billingCompany.county &&
      !!normalizeText(billingCompany.city) &&
      !!normalizeText(billingCompany.street) &&
      isValidPostalCode(billingCompany.postalCode);

    const contactValid =
      !!normalizeText(contactPerson.firstName) &&
      !!normalizeText(contactPerson.lastName) &&
      isValidEmail(contactPerson.email) &&
      isValidPhone(contactPerson.phone);

    if (!companyValid || !contactValid) return false;

    if (!shipToDifferentAddress) return true;

    return (
      !!normalizeText(shippingAddress.firstName) &&
      !!normalizeText(shippingAddress.lastName) &&
      isValidEmail(shippingAddress.email) &&
      isValidPhone(shippingAddress.phone) &&
      !!shippingAddress.county &&
      !!normalizeText(shippingAddress.city) &&
      !!normalizeText(shippingAddress.street) &&
      isValidPostalCode(shippingAddress.postalCode)
    );
  }, [
    customerType,
    shippingAddress,
    billingCompany,
    contactPerson,
    shipToDifferentAddress,
  ]);

  const isFormBasicallyValid = useMemo(() => {
    return isAddressStepValid && items.length > 0;
  }, [isAddressStepValid, items.length]);

  function clearFieldError(name) {
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function setFieldError(name, message) {
    setFieldErrors((prev) => {
      if (!message) {
        if (!prev[name]) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }

      if (prev[name] === message) return prev;
      return { ...prev, [name]: message };
    });
  }

  function validateAndSetFieldError(fieldName) {
    const message = validateSingleField({
      fieldName,
      shippingAddress,
      billingCompany,
      contactPerson,
    });

    setFieldError(fieldName, message);
    return !message;
  }

  function updateShippingField(name, value) {
    setShippingAddress((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function updateBillingCompanyField(name, value) {
    setBillingCompany((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function updateContactField(name, value) {
    setContactPerson((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  function updateShippingNames(partial) {
    setShippingAddress((prev) => {
      const next = { ...prev, ...partial };
      return {
        ...next,
        name: `${normalizeText(next.lastName)} ${normalizeText(
          next.firstName
        )}`.trim(),
      };
    });
  }

  function updateContactNames(partial) {
    setContactPerson((prev) => {
      const next = { ...prev, ...partial };
      return {
        ...next,
        name: `${normalizeText(next.lastName)} ${normalizeText(
          next.firstName
        )}`.trim(),
      };
    });
  }

 useEffect(() => {
  let cancelled =
    false;

  (async () => {
    setLoading(true);
    setError("");

    try {
      /*
       * =====================================================
       * UTILIZATOR CURENT
       * =====================================================
       */

      const authData =
        await api(
          "/api/auth/me"
        ).catch(
          () => null
        );

      const currentUser =
        authData?.user ||
        null;

      if (cancelled) {
        return;
      }

      setMe(
        currentUser
      );

      /*
       * =====================================================
       * CHECKOUT DIN OFERTĂ
       * =====================================================
       */

      if (
        isQuoteCheckout
      ) {
        /*
         * Cererile de ofertă aparțin unui
         * utilizator autentificat.
         */
        if (
          !currentUser
        ) {
          setItems([]);
          setGroups([]);

          setError(
            "Trebuie să fii autentificat pentru a finaliza această ofertă."
          );

          return;
        }

        /*
         * Încărcăm separat:
         * - cererea
         * - oferta selectată
         */
        const quoteResult =
  await api(
    `/api/assistant/quotes/${encodeURIComponent(
      quoteId
    )}`
  );

if (cancelled) {
  return;
}

const quote =
  quoteResult?.quote ||
  quoteResult ||
  null;

const offers =
  Array.isArray(
    quote?.offers
  )
    ? quote.offers
    : [];

const offer =
  offers.find(
    (item) =>
      String(
        item?.id || ""
      ) ===
      String(
        offerId || ""
      )
  ) ||
  null;

        if (
          !quote ||
          !offer
        ) {
          throw new Error(
            "Oferta nu a putut fi încărcată."
          );
        }

        const quoteStatus =
          String(
            quote?.status ||
            ""
          )
            .trim()
            .toUpperCase();

        const offerStatus =
          String(
            offer?.status ||
            ""
          )
            .trim()
            .toUpperCase();

        /*
         * Dacă este deja acceptată și
         * avem comanda, nu mai permitem
         * crearea alteia.
         */
        if (
          quote?.orderId ||
          quoteStatus ===
            "ACCEPTED" ||
          offerStatus ===
            "ACCEPTED"
        ) {
          const existingOrderId =
            quote?.orderId ||
            null;

          if (
            existingOrderId
          ) {
            nav(
              `/multumim?order=${encodeURIComponent(
                existingOrderId
              )}`,
              {
                replace: true,
              }
            );

            return;
          }

          throw new Error(
            "Această ofertă a fost deja acceptată."
          );
        }

        if (
          offerStatus !==
          "SENT"
        ) {
          throw new Error(
            "Această ofertă nu mai poate fi acceptată."
          );
        }

        /*
         * ===================================================
         * TRANSFORMĂM OFERTA ÎN ITEMS PENTRU UI-UL CHECKOUT
         * ===================================================
         */

        const rawOfferItems =
          Array.isArray(
            offer?.items
          )
            ? offer.items
            : [];

        const quoteQuantity =
          Math.max(
            1,
            Number(
              quote?.quantity ||
              1
            ) || 1
          );

        /*
         * În mod normal oferta are items.
         *
         * Păstrăm și fallback pentru cereri
         * mai vechi.
         */
        const sourceItems =
          rawOfferItems.length
            ? rawOfferItems
            : [
                {
                  productId:
                    quote?.product
                      ?.id ||
                    null,

                  title:
                    quote?.product
                      ?.title ||
                    "Produs personalizat",

                  quantity:
                    quoteQuantity,

                  unitPrice:
                    quoteQuantity >
                    0
                      ? Number(
                          offer
                            ?.subtotal ||
                          0
                        ) /
                        quoteQuantity
                      : Number(
                          offer
                            ?.subtotal ||
                          0
                        ),

                  selectedOptions:
                    {},

                  customAnswers:
                    quote
                      ?.quoteSchemaAnswers ||
                    {},
                },
              ];

        const productImages =
          Array.isArray(
            quote?.product
              ?.images
          )
            ? quote.product
                .images
            : [];

        const productImage =
          productImages[0] ||
          "";

        const normalizedItems =
          sourceItems.map(
            (
              item,
              index
            ) => {
              const qty =
                Math.max(
                  1,
                  Number(
                    item
                      ?.quantity ||
                    1
                  ) || 1
                );

              const price =
                Number(
                  item
                    ?.unitPrice ??
                  item
                    ?.finalUnitPrice ??
                  0
                ) || 0;

              return {
                productId:
                  item
                    ?.productId ||
                  quote?.product
                    ?.id ||
                  `quote-product-${index}`,

                title:
                  item?.title ||
                  quote?.product
                    ?.title ||
                  "Produs personalizat",

                qty,

                price,

                originalPrice:
                  Number(
                    item
                      ?.originalUnitPrice ??
                    price
                  ),

                currency:
                  offer?.currency ||
                  "RON",

                image:
                  item?.image ||
                  productImage,

                selectedOptions:
                  item
                    ?.selectedOptions &&
                  typeof item
                    .selectedOptions ===
                    "object"
                    ? item.selectedOptions
                    : {},

                customAnswers:
                  item
                    ?.customAnswers &&
                  typeof item
                    .customAnswers ===
                    "object"
                    ? item.customAnswers
                    : quote
                        ?.quoteSchemaAnswers ||
                      {},

                repeatedGroupAnswers:
                  item
                    ?.repeatedGroupAnswers &&
                  typeof item
                    .repeatedGroupAnswers ===
                    "object"
                    ? item
                        .repeatedGroupAnswers
                    : {},

                configurationKey:
                  item
                    ?.configurationKey ||
                  `quote-offer-${offerId}-${index}`,

                serviceId:
                  quote?.store
                    ?.id ||
                  quote
                    ?.serviceId ||
                  null,

                vendorId:
                  quote
                    ?.vendorId ||
                  null,

                /*
                 * Transportul NU îl punem aici.
                 * El este deja stabilit în ofertă
                 * prin offer.shippingTotal.
                 */
                estimatedShippingFee:
                  0,

                freeShippingThreshold:
                  null,

                shippingNotes:
                  offer?.notes ||
                  null,

                vendorBilling:
                  item
                    ?.vendorBilling ||
                  null,

                /*
                 * Marcaj util dacă vrem ulterior
                 * stil separat pentru produse
                 * venite din ofertă.
                 */
                fromQuoteOffer:
                  true,
              };
            }
          );

        const storeName =
          quote?.store
            ?.displayName ||
          quote?.store
            ?.title ||
          "Magazin";

        const quoteGroups = [
          {
            serviceId:
              quote?.store
                ?.id ||
              quote
                ?.serviceId ||
              null,

            vendorId:
              quote
                ?.vendorId ||
              null,

            serviceTitle:
              storeName,

            /*
             * Transportul ofertei este afișat
             * separat prin shippingTotal.
             */
            estimatedShippingFee:
              0,

            freeShippingThreshold:
              null,

            shippingNotes:
              offer?.notes ||
              null,

            items:
              normalizedItems,
          },
        ];

        setQuoteCheckout({
          quote,
          offer,
        });

        setItems(
          normalizedItems
        );

        setGroups(
          quoteGroups
        );

        setCurrency(
          offer?.currency ||
          "RON"
        );

        /*
         * Nu atingem coșul normal.
         * Oferta este independentă de coș.
         */
      } else {
        /*
         * ===================================================
         * CHECKOUT NORMAL
         * ===================================================
         */

        let summary;

        if (
          currentUser
        ) {
          /*
           * Checkout pentru utilizator autentificat.
           */
          const localItems =
            getGuestCart();

          if (
            localItems.length
          ) {
            try {
              const mergeResult =
                await api(
                  "/api/cart/merge",
                  {
                    method:
                      "POST",

                    body: {
                      items:
                        localItems,
                    },
                  }
                );

              if (
                cancelled
              ) {
                return;
              }

              clearGuestCart();

              if (
                mergeResult
                  ?.skipped >
                0
              ) {
                alert(
                  mergeResult
                    .merged >
                    0
                    ? `Am adăugat ${mergeResult.merged} produse în coșul tău. ${mergeResult.skipped} produse au fost omise.`
                    : `${mergeResult.skipped} produse din coșul de vizitator au fost omise.`
                );
              }
            } catch (
              error
            ) {
              console.error(
                "Nu am putut sincroniza coșul guest:",
                error
              );
            }
          }

          summary =
            await api(
              `/api/checkout/summary?campaignAttribution=${encodeURIComponent(
                JSON.stringify(getAttributionsForCheckout())
              )}`
            );
        } else {
          /*
           * Checkout fără cont.
           */
          const guestItems =
            getGuestCart();

          if (
            !guestItems.length
          ) {
            if (
              !cancelled
            ) {
              setItems([]);
              setGroups([]);
            }

            return;
          }

          summary =
            await api(
              "/api/checkout/guest/summary",
              {
                method:
                  "POST",

                body: {
                  items:
                    guestItems,

                  campaignAttribution:
                    getAttributionsForCheckout(),
                },
              }
            );
        }

        if (
          cancelled
        ) {
          return;
        }

        setItems(
          Array.isArray(
            summary?.items
          )
            ? summary.items
            : []
        );

        setGroups(
          Array.isArray(
            summary?.groups
          )
            ? summary.groups
            : []
        );

        setCurrency(
          summary?.currency ||
          "RON"
        );
      }

      /*
       * =====================================================
       * DATE SALVATE DE CHECKOUT
       * =====================================================
       */

      try {
        const saved =
          localStorage.getItem(
            "checkoutAddress"
          );

        if (saved) {
          const parsed =
            JSON.parse(
              saved
            );

          if (
            parsed &&
            typeof parsed ===
              "object"
          ) {
            const {
              customerType:
                savedType,

              shipToDifferentAddress:
                savedShipToDifferentAddress,

              shippingAddress:
                savedShippingAddress,

              billingCompany:
                savedBillingCompany,

              contactPerson:
                savedContactPerson,
            } = parsed;

            if (
              savedShippingAddress
            ) {
              setShippingAddress(
                (
                  previous
                ) => ({
                  ...previous,
                  ...savedShippingAddress,
                })
              );
            }

            if (
              savedBillingCompany
            ) {
              setBillingCompany(
                (
                  previous
                ) => ({
                  ...previous,
                  ...savedBillingCompany,
                })
              );
            }

            if (
              savedContactPerson
            ) {
              setContactPerson(
                (
                  previous
                ) => ({
                  ...previous,
                  ...savedContactPerson,
                })
              );
            }

            if (
              savedType ===
                "PF" ||
              savedType ===
                "PJ"
            ) {
              setCustomerType(
                savedType
              );
            }

            setShipToDifferentAddress(
              Boolean(
                savedShipToDifferentAddress
              )
            );
          }
        }
      } catch {
        /*
         * Datele salvate local
         * sunt opționale.
         */
      }
    } catch (error) {
      console.error(
        "Checkout load error:",
        error
      );

      if (
        !cancelled
      ) {
        setItems([]);
        setGroups([]);

        setError(
          getReadableApiError(
            error
          ) ||
            "Nu am putut încărca checkout-ul."
        );
      }
    } finally {
      if (
        !cancelled
      ) {
        setLoading(
          false
        );
      }
    }
  })();

  return () => {
    cancelled =
      true;
  };
}, [
  isQuoteCheckout,
  quoteId,
  offerId,
  nav,
]);

  useEffect(() => {
    let cancelled = false;

    setCountiesLoading(true);

    api("/api/geo/ro/counties")
      .then((res) => {
        if (cancelled) return;
        setCounties(Array.isArray(res?.items) ? res.items : []);
      })
      .catch(() => {
        if (cancelled) return;
        setCounties([]);
      })
      .finally(() => {
        if (!cancelled) setCountiesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!shippingAddress.county || !counties.length) return;
    const found = counties.find((c) => c.code === shippingAddress.county);
    if (found) setCountyInput(found.name);
  }, [shippingAddress.county, counties]);

  useEffect(() => {
    if (!billingCompany.county || !counties.length) return;
    const found = counties.find((c) => c.code === billingCompany.county);
    if (found) setCompanyCountyInput(found.name);
  }, [billingCompany.county, counties]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "checkoutAddress",
        JSON.stringify({
          customerType,
          shipToDifferentAddress,
          shippingAddress,
          billingCompany,
          contactPerson,
        })
      );
    } catch {
      // ignore
    }
  }, [
    customerType,
    shipToDifferentAddress,
    shippingAddress,
    billingCompany,
    contactPerson,
  ]);

  useEffect(() => {
    if (customerType === "PF") {
      setBillingCompany({
        companyName: "",
        companyCui: "",
        companyRegCom: "",
        county: "",
        city: "",
        postalCode: "",
        street: "",
      });

      setContactPerson({
        firstName: "",
        lastName: "",
        name: "",
        phone: "",
        email: "",
      });

      setCompanyCountyInput("");
      setShipToDifferentAddress(false);
      setFieldErrors({});
    }
  }, [customerType]);

  function handleSelectShippingCounty(county) {
    setCountyInput(county.name);
    setShowCountyDropdown(false);
    setShippingAddress((prev) => ({
      ...prev,
      county: county.code,
    }));
    clearFieldError("county");
  }

  function handleSelectCompanyCounty(county) {
    setCompanyCountyInput(county.name);
    setShowCompanyCountyDropdown(false);
    setBillingCompany((prev) => ({
      ...prev,
      county: county.code,
    }));
    clearFieldError("companyCounty");
  }

  const goToStep1 = () => {
    setActiveStep(1);
    addressSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const goToStep2 = () => {
    const { errors } = validateCheckoutForm({
      shippingAddress,
      billingCompany,
      contactPerson,
      customerType,
      items,
      shipToDifferentAddress,
    });

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError(
        "Există câmpuri incomplete sau completate greșit. Verifică mesajele afișate sub câmpuri."
      );
      setActiveStep(1);
      focusFirstError(errors, fieldRefs);
      addressSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      return;
    }

    setError("");
    setActiveStep(2);
    paymentSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  async function placeOrder() {
    if (placing) return;

    const { errors, formError } = validateCheckoutForm({
      shippingAddress,
      billingCompany,
      contactPerson,
      customerType,
      items,
      shipToDifferentAddress,
    });

    if (formError) {
      setError(formError);
      return;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError(
        "Te rugăm să corectezi câmpurile incomplete sau completate greșit."
      );
      setActiveStep(1);
      focusFirstError(errors, fieldRefs);
      return;
    }

    setPlacing(true);
    setError("");
    setFieldErrors({});

    try {
      const normalizedContactPerson =
        customerType === "PJ"
          ? {
              firstName: normalizeText(contactPerson.firstName),
              lastName: normalizeText(contactPerson.lastName),
              name: buildFullName(contactPerson),
              email: normalizeText(contactPerson.email),
              phone: normalizeDigits(contactPerson.phone).slice(0, 10),
            }
          : null;

      const finalShippingAddress =
        customerType === "PJ" && !shipToDifferentAddress
          ? {
              firstName: normalizeText(contactPerson.firstName),
              lastName: normalizeText(contactPerson.lastName),
              name: buildFullName(contactPerson),
              email: normalizeText(contactPerson.email),
              phone: normalizeDigits(contactPerson.phone).slice(0, 10),
              county: billingCompany.county,
              city: normalizeText(billingCompany.city),
              postalCode: normalizeText(billingCompany.postalCode),
              street: normalizeText(billingCompany.street),
              notes: normalizeText(shippingAddress.notes),
              companyName: normalizeText(billingCompany.companyName),
            }
          : {
              ...shippingAddress,
              firstName: normalizeText(shippingAddress.firstName),
              lastName: normalizeText(shippingAddress.lastName),
              name: buildFullName(shippingAddress),
              email: normalizeText(shippingAddress.email),
              phone: normalizeDigits(shippingAddress.phone).slice(0, 10),
              city: normalizeText(shippingAddress.city),
              postalCode: normalizeText(shippingAddress.postalCode),
              street: normalizeText(shippingAddress.street),
              notes: normalizeText(shippingAddress.notes),
            };

      const body = {
        address: finalShippingAddress,
        billingAddress:
          customerType === "PJ"
            ? {
                companyName: normalizeText(billingCompany.companyName),
                companyCui: normalizeCui(billingCompany.companyCui),
                companyRegCom: normalizeText(billingCompany.companyRegCom),
                county: billingCompany.county,
                city: normalizeText(billingCompany.city),
                postalCode: normalizeText(billingCompany.postalCode),
                street: normalizeText(billingCompany.street),
              }
            : null,
        contactPerson: normalizedContactPerson,
        customerType,
        paymentMethod,
        shipToDifferentAddress:
          customerType === "PJ" ? shipToDifferentAddress : false,
        campaignAttribution: getAttributionsForCheckout(),
      };
/*
 * =========================================================
 * COMANDĂ DIN OFERTĂ
 * =========================================================
 */

if (
  isQuoteCheckout
) {
  if (
    !me
  ) {
    throw new Error(
      "Trebuie să fii autentificat pentru a finaliza această ofertă."
    );
  }

  /*
   * Backend-ul quotes folosește
   * shippingAddress, nu address.
   *
   * Trimitem și ambele denumiri
   * ale străzii pentru compatibilitate.
   */
  const quoteShippingAddress = {
    ...finalShippingAddress,

    recipientName:
      finalShippingAddress
        .name ||
      buildFullName(
        finalShippingAddress
      ),

    addressLine1:
      finalShippingAddress
        .street,

    street:
      finalShippingAddress
        .street,
  };

  const quoteBody = {
    shippingAddress:
      quoteShippingAddress,

    billingAddress:
      body.billingAddress,

    contactPerson:
      body.contactPerson,

    customerType:
      body.customerType,

    paymentMethod:
      body.paymentMethod,

    shipToDifferentAddress:
      body.shipToDifferentAddress,
  };

  const result =
    await api(
      `/api/assistant/quotes/${encodeURIComponent(
        quoteId
      )}/offers/${encodeURIComponent(
        offerId
      )}/accept`,
      {
        method:
          "POST",

        body:
          quoteBody,
      }
    );

  /*
   * Plata online funcționează la fel
   * ca în checkout-ul normal.
   */
  if (
    paymentMethod ===
      "CARD" &&
    result?.payment
      ?.redirectUrl
  ) {
    window.location.href =
      result.payment
        .redirectUrl;

    return;
  }

  const orderId =
    result?.orderId ||
    result?.order?.id ||
    null;

  if (
    orderId
  ) {
    const params =
      new URLSearchParams({
        order:
          orderId,
      });

    nav(
      `/multumim?${params.toString()}`
    );

    return;
  }

  /*
   * Fallback foarte rar:
   * acceptarea a mers, dar API-ul
   * nu a întors orderId.
   */
  nav(
    "/comenzile-mele"
  );

  return;
}
      const checkoutBody = me
  ? body
  : {
      ...body,
      items: getGuestCart(),
      consents: {
        termsAccepted: true,
        privacyAccepted: true,
      },
    };

const endpoint = me
  ? "/api/checkout/place"
  : "/api/checkout/guest/place";

const result = await api(endpoint, {
  method: "POST",
  body: checkoutBody,
});

if (result?.ok || result?.orderId) {
  if (!me) {
    clearGuestCart();
  }

 try {
  sessionStorage.removeItem(
    "cart:ui-cache:v1"
  );

  sessionStorage.removeItem(
    "cart:ui-cache:v2"
  );
} catch {
  // ignore
}

  try {
    window.dispatchEvent(
      new CustomEvent("cart:changed")
    );
  } catch {
    // ignore
  }
}

if (
  paymentMethod === "CARD" &&
  result?.payment?.redirectUrl
) {
  window.location.href =
    result.payment.redirectUrl;
  return;
}

if (result?.orderId) {
  const params = new URLSearchParams({
    order: result.orderId,
  });

  if (result?.guestAccessToken) {
    params.set(
      "token",
      result.guestAccessToken
    );
  }

  nav(`/multumim?${params.toString()}`);
  return;
}

alert("Comanda a fost înregistrată.");

if (me) {
  nav("/comenzile-mele");
} else {
  nav("/multumim");
}
    } catch (e) {
      setError(getReadableApiError(e));
    } finally {
      setPlacing(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.container}>Se încarcă detaliile comenzii…</div>
    );
  }

  return (
    <div className={styles.container}>
      <h2 className={styles.pageTitle}>Checkout</h2>

      <div className={styles.steps}>
        <button
          type="button"
          className={`${styles.step} ${
            activeStep === 1 ? styles.stepActive : ""
          }`}
          onClick={goToStep1}
        >
          <span>1</span> Date
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
          <Link to="/produse" className={styles.linkPrimary}>
            Mergi la produse
          </Link>
        </div>
      ) : (
        <div className={styles.layout}>
          <div className={styles.left}>
            <section className={styles.card}>
              <h3 className={styles.cardTitle}>
  {isQuoteCheckout
    ? "Oferta acceptată"
    : "Produsele tale"}
</h3>
              <p className={styles.muted}>
  {isQuoteCheckout
    ? "Detaliile și prețurile de mai jos sunt cele stabilite în oferta trimisă de creator."
    : "Produsele sunt realizate de artizani independenți, special pentru evenimentul tău."}
</p>

              <ul className={styles.itemsList}>
                {items.map((it) => {
                  const breakdown = getItemVatBreakdown(it);

                  return (
                   <li
  key={`${it.productId}:${it.configurationKey || "default"}`}
  className={styles.itemRow}
>
                      <div className={styles.itemMedia}>
                        {it.image ? (
                          <img
                            src={resolveFileUrl(it.image)}
                            alt={it.title}
                            className={styles.thumb}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className={styles.thumbPlaceholder} />
                        )}
                      </div>

                      <div className={styles.itemTitle}>
  <div>
    {it.title}
  </div>

  {getObjectEntries(
    it.selectedOptions
  ).length > 0 && (
    <div
      style={{
        marginTop: 8,
        fontSize: 13,
        lineHeight: 1.45,
        fontWeight: 400,
      }}
    >
      <strong>
        Variante
      </strong>

      {getObjectEntries(
        it.selectedOptions
      ).map(
        ([key, value]) => (
          <div
            key={`option-${key}`}
          >
            {formatConfigLabel(
              key
            )}
            :{" "}
            {getReadableConfigValue(
              value
            )}
          </div>
        )
      )}
    </div>
  )}

  {getObjectEntries(
    it.customAnswers
  ).length > 0 && (
    <div
      style={{
        marginTop: 8,
        fontSize: 13,
        lineHeight: 1.45,
        fontWeight: 400,
      }}
    >
      <strong>
        Personalizare
      </strong>

      {getObjectEntries(
        it.customAnswers
      ).map(
        ([key, value]) => {
          const imageValue =
            isCustomizationImage(
              value
            );

          return (
            <div
              key={`custom-${key}`}
              className={
                imageValue
                  ? styles.configImageRow
                  : undefined
              }
            >
              <span>
                {formatConfigLabel(
                  key
                )}
                :
              </span>

              {imageValue ? (
                <button
                  type="button"
                  className={
                    styles.previewTrigger
                  }
                  onClick={() =>
                    setPreviewImage({
                      url: resolveFileUrl(
                        value
                      ),
                      label:
                        formatConfigLabel(
                          key
                        ),
                    })
                  }
                  aria-label={`Deschide poza pentru ${formatConfigLabel(
                    key
                  )}`}
                  title="Deschide poza"
                >
                  <img
                    src={resolveFileUrl(
                      value
                    )}
                    alt={`Personalizare ${formatConfigLabel(
                      key
                    )}`}
                    className={
                      styles.previewThumb
                    }
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              ) : (
                <>
                  {" "}
                  {getReadableConfigValue(
                    value
                  )}
                </>
              )}
            </div>
          );
        }
      )}
    </div>
  )}

  {getObjectEntries(
    it.repeatedGroupAnswers
  ).length > 0 && (
    <div
      style={{
        marginTop: 10,
        fontSize: 13,
        lineHeight: 1.45,
        fontWeight: 400,
      }}
    >
      <strong>
        Detalii pentru fiecare membru
      </strong>

      {getObjectEntries(
        it.repeatedGroupAnswers
      ).map(
        ([groupKey, members]) => {
          if (
            !Array.isArray(
              members
            )
          ) {
            return null;
          }

          return (
            <div
              key={`group-${groupKey}`}
            >
              {members.map(
                (
                  member,
                  memberIndex
                ) => {
                  const entries =
                    getObjectEntries(
                      member
                    );

                  if (
                    !entries.length
                  ) {
                    return null;
                  }

                  return (
                    <div
                      key={`${groupKey}-${memberIndex}`}
                      style={{
                        marginTop:
                          8,
                        paddingLeft:
                          10,
                        borderLeft:
                          "2px solid rgba(0,0,0,0.08)",
                      }}
                    >
                      <div
                        style={{
                          fontWeight:
                            700,
                        }}
                      >
                        Membru{" "}
                        {memberIndex +
                          1}
                      </div>

                      {entries.map(
                        ([
                          key,
                          value,
                        ]) => {
                          const imageValue =
                            isCustomizationImage(
                              value
                            );

                          return (
                            <div
                              key={`${groupKey}-${memberIndex}-${key}`}
                              className={
                                imageValue
                                  ? styles.configImageRow
                                  : undefined
                              }
                            >
                              <span>
                                {formatConfigLabel(
                                  key
                                )}
                                :
                              </span>

                              {imageValue ? (
                                <button
                                  type="button"
                                  className={
                                    styles.previewTrigger
                                  }
                                  onClick={() =>
                                    setPreviewImage({
                                      url: resolveFileUrl(
                                        value
                                      ),
                                      label:
                                        formatConfigLabel(
                                          key
                                        ),
                                    })
                                  }
                                  aria-label={`Deschide poza pentru ${formatConfigLabel(
                                    key
                                  )}`}
                                  title="Deschide poza"
                                >
                                  <img
                                    src={resolveFileUrl(
                                      value
                                    )}
                                    alt={`Personalizare ${formatConfigLabel(
                                      key
                                    )}`}
                                    className={
                                      styles.previewThumb
                                    }
                                    loading="lazy"
                                    decoding="async"
                                  />
                                </button>
                              ) : (
                                <>
                                  {" "}
                                  {getReadableConfigValue(
                                    value
                                  )}
                                </>
                              )}
                            </div>
                          );
                        }
                      )}
                    </div>
                  );
                }
              )}
            </div>
          );
        }
      )}
    </div>
  )}
</div>
                      <div className={styles.itemQty}>x{it.qty}</div>

                      <div className={styles.itemPrice}>
  {customerType === "PJ" ? (
    <div style={{ textAlign: "right" }}>
      {it.hasDiscount && typeof it.originalPrice === "number" ? (
        <div className={styles.oldPrice}>
          {money(it.originalPrice * Number(it.qty || 0), it.currency || currency)}
        </div>
      ) : null}

      <div>
        <strong>
          {money(breakdown.net, it.currency || currency)}
        </strong>

        {it.hasDiscount ? (
          <span className={styles.discountBadge}>
            -{it.discountPercent}%
          </span>
        ) : null}
      </div>

      <div style={{ fontSize: 12, opacity: 0.75 }}>
        TVA: {money(breakdown.vat, it.currency || currency)}
      </div>

      <div style={{ fontSize: 12, opacity: 0.85 }}>
        {money(breakdown.gross, it.currency || currency)} cu TVA
      </div>

      {it.hasDiscount && it.promoLabel ? (
        <div className={styles.promoLabel}>{it.promoLabel}</div>
      ) : null}
    </div>
  ) : (
    <div style={{ textAlign: "right" }}>
      {it.hasDiscount && typeof it.originalPrice === "number" ? (
        <div className={styles.oldPrice}>
          {money(it.originalPrice * Number(it.qty || 0), it.currency || currency)}
        </div>
      ) : null}

      <div>
        <strong>
          {money(breakdown.gross, it.currency || currency)}
        </strong>

        {it.hasDiscount ? (
          <span className={styles.discountBadge}>
            -{it.discountPercent}%
          </span>
        ) : null}
      </div>

      {it.hasDiscount && it.promoLabel ? (
        <div className={styles.promoLabel}>{it.promoLabel}</div>
      ) : null}
    </div>
  )}
</div>
                    </li>
                  );
                })}
              </ul>

              <div className={styles.divider} />

              {customerType === "PJ" ? (
                <>
                  <div className={styles.summaryRow}>
                    <span>Produse (fără TVA)</span>
                    <strong>{money(vatTotals.totalNet, currency)}</strong>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>TVA produse</span>
                    <strong>{money(vatTotals.totalVat, currency)}</strong>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>Produse (cu TVA)</span>
                    <strong>{money(vatTotals.totalGross, currency)}</strong>
                  </div>
                </>
              ) : (
                <div className={styles.summaryRow}>
                  <span>Produse</span>
                  <strong>{money(vatTotals.totalGross, currency)}</strong>
                </div>
              )}
            </section>

            <section ref={addressSectionRef} className={styles.card}>
              <h3 className={styles.cardTitle}>Date client</h3>

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
                    <span>Persoană juridică</span>
                  </label>
                </div>
              </div>

              {customerType === "PF" ? (
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>Nume*</span>
                    <input
                      ref={lastNameRef}
                      className={fieldErrors.lastName ? styles.inputError : ""}
                      value={shippingAddress.lastName}
                      onChange={(e) => {
                        clearFieldError("lastName");
                        updateShippingNames({ lastName: e.target.value });
                      }}
                      onBlur={() => validateAndSetFieldError("lastName")}
                      placeholder="Ex: Popescu"
                    />
                    {fieldErrors.lastName && (
                      <span className={styles.fieldError}>
                        {fieldErrors.lastName}
                      </span>
                    )}
                  </label>

                  <label className={styles.field}>
                    <span>Prenume*</span>
                    <input
                      ref={firstNameRef}
                      className={fieldErrors.firstName ? styles.inputError : ""}
                      value={shippingAddress.firstName}
                      onChange={(e) => {
                        clearFieldError("firstName");
                        updateShippingNames({ firstName: e.target.value });
                      }}
                      onBlur={() => validateAndSetFieldError("firstName")}
                      placeholder="Ex: Ana"
                    />
                    {fieldErrors.firstName && (
                      <span className={styles.fieldError}>
                        {fieldErrors.firstName}
                      </span>
                    )}
                  </label>

                  <label className={styles.field}>
                    <span>Email*</span>
                    <input
                      ref={emailRef}
                      className={fieldErrors.email ? styles.inputError : ""}
                      type="email"
                      value={shippingAddress.email}
                      onChange={(e) => {
                        clearFieldError("email");
                        updateShippingField("email", e.target.value);
                      }}
                      onBlur={() => validateAndSetFieldError("email")}
                      placeholder="exemplu@domeniu.ro"
                    />
                    {fieldErrors.email && (
                      <span className={styles.fieldError}>
                        {fieldErrors.email}
                      </span>
                    )}
                  </label>

                  <label className={styles.field}>
                    <span>Telefon*</span>
                    <input
                      ref={phoneRef}
                      className={fieldErrors.phone ? styles.inputError : ""}
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      value={shippingAddress.phone}
                      onChange={(e) => {
                        clearFieldError("phone");
                        updateShippingField(
                          "phone",
                          normalizeDigits(e.target.value).slice(0, 10)
                        );
                      }}
                      onBlur={() => validateAndSetFieldError("phone")}
                      placeholder="07xxxxxxxx"
                    />
                    {fieldErrors.phone && (
                      <span className={styles.fieldError}>
                        {fieldErrors.phone}
                      </span>
                    )}
                  </label>

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
                          className={fieldErrors.county ? styles.inputError : ""}
                          value={countyInput}
                          onChange={(e) => {
                            clearFieldError("county");
                            setCountyInput(e.target.value);
                            setShowCountyDropdown(true);
                            updateShippingField("county", "");
                          }}
                          onFocus={() => setShowCountyDropdown(true)}
                          onBlur={() => {
                            setTimeout(() => setShowCountyDropdown(false), 150);
                            setTimeout(() => validateAndSetFieldError("county"), 160);
                          }}
                          placeholder="Scrie numele județului..."
                          autoComplete="off"
                        />

                        {showCountyDropdown && filteredCounties.length > 0 && (
                          <ul className={styles.autocompleteList}>
                            {filteredCounties.map((c) => (
                              <li
                                key={c.code}
                                className={styles.autocompleteItem}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  handleSelectShippingCounty(c);
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
                      <span className={styles.fieldError}>
                        {fieldErrors.county}
                      </span>
                    )}
                  </label>

                  <label className={styles.field}>
                    <span>Oraș / Localitate*</span>
                    <input
                      ref={cityRef}
                      className={fieldErrors.city ? styles.inputError : ""}
                      value={shippingAddress.city}
                      onChange={(e) => {
                        clearFieldError("city");
                        updateShippingField("city", e.target.value);
                      }}
                      onBlur={() => validateAndSetFieldError("city")}
                      placeholder="Ex: București"
                    />
                    {fieldErrors.city && (
                      <span className={styles.fieldError}>
                        {fieldErrors.city}
                      </span>
                    )}
                  </label>

                  <label className={styles.field}>
                    <span>Cod poștal</span>
                    <input
                      ref={postalCodeRef}
                      className={fieldErrors.postalCode ? styles.inputError : ""}
                      inputMode="numeric"
                      maxLength={6}
                      value={shippingAddress.postalCode}
                      onChange={(e) => {
                        clearFieldError("postalCode");
                        updateShippingField(
                          "postalCode",
                          normalizeDigits(e.target.value).slice(0, 6)
                        );
                      }}
                      onBlur={() => validateAndSetFieldError("postalCode")}
                      placeholder="Ex: 040011"
                    />
                    {fieldErrors.postalCode && (
                      <span className={styles.fieldError}>
                        {fieldErrors.postalCode}
                      </span>
                    )}
                  </label>

                  <label className={styles.fieldFull}>
                    <span>Stradă și număr*</span>
                    <input
                      ref={streetRef}
                      className={fieldErrors.street ? styles.inputError : ""}
                      value={shippingAddress.street}
                      onChange={(e) => {
                        clearFieldError("street");
                        updateShippingField("street", e.target.value);
                      }}
                      onBlur={() => validateAndSetFieldError("street")}
                      placeholder="Ex: Șos. Olteniței 123"
                    />
                    {fieldErrors.street && (
                      <span className={styles.fieldError}>
                        {fieldErrors.street}
                      </span>
                    )}
                  </label>

                  <label className={styles.fieldFull}>
                    <span>Observații (opțional)</span>
                    <textarea
                      value={shippingAddress.notes}
                      onChange={(e) =>
                        updateShippingField("notes", e.target.value)
                      }
                      rows={3}
                    />
                  </label>
                </div>
              ) : (
                <>
                  <div className={styles.formGrid}>
                    <div className={styles.fieldFull}>
                      <span className={styles.sectionLabel}>
                        Date facturare persoană juridică
                      </span>
                    </div>

                    <label className={styles.fieldFull}>
                      <span>Denumire firmă*</span>
                      <input
                        ref={companyNameRef}
                        className={fieldErrors.companyName ? styles.inputError : ""}
                        value={billingCompany.companyName}
                        onChange={(e) => {
                          clearFieldError("companyName");
                          updateBillingCompanyField(
                            "companyName",
                            e.target.value
                          );
                        }}
                        onBlur={() => validateAndSetFieldError("companyName")}
                        placeholder="Ex: SC Exemplu SRL"
                      />
                      {fieldErrors.companyName && (
                        <span className={styles.fieldError}>
                          {fieldErrors.companyName}
                        </span>
                      )}
                    </label>

                    <label className={styles.field}>
                      <span>CUI*</span>
                      <input
                        ref={companyCuiRef}
                        className={fieldErrors.companyCui ? styles.inputError : ""}
                        value={billingCompany.companyCui}
                        onChange={(e) => {
                          clearFieldError("companyCui");
                          updateBillingCompanyField(
                            "companyCui",
                            normalizeCui(e.target.value)
                          );
                        }}
                        onBlur={() => validateAndSetFieldError("companyCui")}
                        placeholder="Ex: 12345678 sau RO12345678"
                      />
                      {fieldErrors.companyCui && (
                        <span className={styles.fieldError}>
                          {fieldErrors.companyCui}
                        </span>
                      )}
                    </label>

                    <label className={styles.field}>
                      <span>Nr. Reg. Comerțului</span>
                      <input
                        value={billingCompany.companyRegCom}
                        onChange={(e) =>
                          updateBillingCompanyField(
                            "companyRegCom",
                            e.target.value
                          )
                        }
                        placeholder="Ex: J40/1234/2024"
                      />
                    </label>

                    <label className={styles.field}>
                      <span>Județ sediu*</span>

                      {countiesLoading ? (
                        <div className={styles.selectPlaceholder}>
                          Se încarcă județele…
                        </div>
                      ) : (
                        <div className={styles.autocomplete}>
                          <input
                            ref={companyCountyRef}
                            className={
                              fieldErrors.companyCounty ? styles.inputError : ""
                            }
                            value={companyCountyInput}
                            onChange={(e) => {
                              clearFieldError("companyCounty");
                              setCompanyCountyInput(e.target.value);
                              setShowCompanyCountyDropdown(true);
                              updateBillingCompanyField("county", "");
                            }}
                            onFocus={() => setShowCompanyCountyDropdown(true)}
                            onBlur={() => {
                              setTimeout(
                                () => setShowCompanyCountyDropdown(false),
                                150
                              );
                              setTimeout(
                                () => validateAndSetFieldError("companyCounty"),
                                160
                              );
                            }}
                            placeholder="Scrie numele județului..."
                            autoComplete="off"
                          />

                          {showCompanyCountyDropdown &&
                            filteredCompanyCounties.length > 0 && (
                              <ul className={styles.autocompleteList}>
                                {filteredCompanyCounties.map((c) => (
                                  <li
                                    key={c.code}
                                    className={styles.autocompleteItem}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      handleSelectCompanyCounty(c);
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

                      {fieldErrors.companyCounty && (
                        <span className={styles.fieldError}>
                          {fieldErrors.companyCounty}
                        </span>
                      )}
                    </label>

                    <label className={styles.field}>
                      <span>Oraș sediu*</span>
                      <input
                        ref={companyCityRef}
                        className={fieldErrors.companyCity ? styles.inputError : ""}
                        value={billingCompany.city}
                        onChange={(e) => {
                          clearFieldError("companyCity");
                          updateBillingCompanyField("city", e.target.value);
                        }}
                        onBlur={() => validateAndSetFieldError("companyCity")}
                        placeholder="Ex: București"
                      />
                      {fieldErrors.companyCity && (
                        <span className={styles.fieldError}>
                          {fieldErrors.companyCity}
                        </span>
                      )}
                    </label>

                    <label className={styles.field}>
                      <span>Cod poștal sediu</span>
                      <input
                        ref={companyPostalCodeRef}
                        className={
                          fieldErrors.companyPostalCode ? styles.inputError : ""
                        }
                        inputMode="numeric"
                        maxLength={6}
                        value={billingCompany.postalCode}
                        onChange={(e) => {
                          clearFieldError("companyPostalCode");
                          updateBillingCompanyField(
                            "postalCode",
                            normalizeDigits(e.target.value).slice(0, 6)
                          );
                        }}
                        onBlur={() =>
                          validateAndSetFieldError("companyPostalCode")
                        }
                        placeholder="Ex: 040011"
                      />
                      {fieldErrors.companyPostalCode && (
                        <span className={styles.fieldError}>
                          {fieldErrors.companyPostalCode}
                        </span>
                      )}
                    </label>

                    <label className={styles.fieldFull}>
                      <span>Stradă și număr sediu*</span>
                      <input
                        ref={companyStreetRef}
                        className={
                          fieldErrors.companyStreet ? styles.inputError : ""
                        }
                        value={billingCompany.street}
                        onChange={(e) => {
                          clearFieldError("companyStreet");
                          updateBillingCompanyField("street", e.target.value);
                        }}
                        onBlur={() => validateAndSetFieldError("companyStreet")}
                        placeholder="Ex: Șos. Olteniței 123"
                      />
                      {fieldErrors.companyStreet && (
                        <span className={styles.fieldError}>
                          {fieldErrors.companyStreet}
                        </span>
                      )}
                    </label>

                    <div className={styles.fieldFull}>
                      <span className={styles.sectionLabel}>
                        Persoană de contact
                      </span>
                    </div>

                    <label className={styles.field}>
                      <span>Nume*</span>
                      <input
                        ref={contactLastNameRef}
                        className={
                          fieldErrors.contactLastName ? styles.inputError : ""
                        }
                        value={contactPerson.lastName}
                        onChange={(e) => {
                          clearFieldError("contactLastName");
                          updateContactNames({ lastName: e.target.value });
                        }}
                        onBlur={() =>
                          validateAndSetFieldError("contactLastName")
                        }
                        placeholder="Ex: Popescu"
                      />
                      {fieldErrors.contactLastName && (
                        <span className={styles.fieldError}>
                          {fieldErrors.contactLastName}
                        </span>
                      )}
                    </label>

                    <label className={styles.field}>
                      <span>Prenume*</span>
                      <input
                        ref={contactFirstNameRef}
                        className={
                          fieldErrors.contactFirstName ? styles.inputError : ""
                        }
                        value={contactPerson.firstName}
                        onChange={(e) => {
                          clearFieldError("contactFirstName");
                          updateContactNames({ firstName: e.target.value });
                        }}
                        onBlur={() =>
                          validateAndSetFieldError("contactFirstName")
                        }
                        placeholder="Ex: Ana"
                      />
                      {fieldErrors.contactFirstName && (
                        <span className={styles.fieldError}>
                          {fieldErrors.contactFirstName}
                        </span>
                      )}
                    </label>

                    <label className={styles.field}>
                      <span>Email*</span>
                      <input
                        ref={contactEmailRef}
                        className={
                          fieldErrors.contactEmail ? styles.inputError : ""
                        }
                        type="email"
                        value={contactPerson.email}
                        onChange={(e) => {
                          clearFieldError("contactEmail");
                          updateContactField("email", e.target.value);
                        }}
                        onBlur={() => validateAndSetFieldError("contactEmail")}
                        placeholder="exemplu@domeniu.ro"
                      />
                      {fieldErrors.contactEmail && (
                        <span className={styles.fieldError}>
                          {fieldErrors.contactEmail}
                        </span>
                      )}
                    </label>

                    <label className={styles.field}>
                      <span>Telefon*</span>
                      <input
                        ref={contactPhoneRef}
                        className={
                          fieldErrors.contactPhone ? styles.inputError : ""
                        }
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        value={contactPerson.phone}
                        onChange={(e) => {
                          clearFieldError("contactPhone");
                          updateContactField(
                            "phone",
                            normalizeDigits(e.target.value).slice(0, 10)
                          );
                        }}
                        onBlur={() => validateAndSetFieldError("contactPhone")}
                        placeholder="07xxxxxxxx"
                      />
                      {fieldErrors.contactPhone && (
                        <span className={styles.fieldError}>
                          {fieldErrors.contactPhone}
                        </span>
                      )}
                    </label>
                  </div>

                  <div className={styles.card} style={{ marginTop: 16 }}>
                    <label className={styles.radio}>
                      <input
                        type="checkbox"
                        checked={shipToDifferentAddress}
                        onChange={(e) =>
                          setShipToDifferentAddress(e.target.checked)
                        }
                      />
                      <span>Livrez la altă adresă</span>
                    </label>

                    {shipToDifferentAddress && (
                      <div style={{ marginTop: 16 }}>
                        <div className={styles.formGrid}>
                          <div className={styles.fieldFull}>
                            <span className={styles.sectionLabel}>
                              Adresă de livrare
                            </span>
                          </div>

                          <label className={styles.field}>
                            <span>Nume*</span>
                            <input
                              ref={lastNameRef}
                              className={
                                fieldErrors.lastName ? styles.inputError : ""
                              }
                              value={shippingAddress.lastName}
                              onChange={(e) => {
                                clearFieldError("lastName");
                                updateShippingNames({
                                  lastName: e.target.value,
                                });
                              }}
                              onBlur={() => validateAndSetFieldError("lastName")}
                              placeholder="Ex: Popescu"
                            />
                            {fieldErrors.lastName && (
                              <span className={styles.fieldError}>
                                {fieldErrors.lastName}
                              </span>
                            )}
                          </label>

                          <label className={styles.field}>
                            <span>Prenume*</span>
                            <input
                              ref={firstNameRef}
                              className={
                                fieldErrors.firstName ? styles.inputError : ""
                              }
                              value={shippingAddress.firstName}
                              onChange={(e) => {
                                clearFieldError("firstName");
                                updateShippingNames({
                                  firstName: e.target.value,
                                });
                              }}
                              onBlur={() =>
                                validateAndSetFieldError("firstName")
                              }
                              placeholder="Ex: Ana"
                            />
                            {fieldErrors.firstName && (
                              <span className={styles.fieldError}>
                                {fieldErrors.firstName}
                              </span>
                            )}
                          </label>

                          <label className={styles.field}>
                            <span>Email*</span>
                            <input
                              ref={emailRef}
                              className={fieldErrors.email ? styles.inputError : ""}
                              type="email"
                              value={shippingAddress.email}
                              onChange={(e) => {
                                clearFieldError("email");
                                updateShippingField("email", e.target.value);
                              }}
                              onBlur={() => validateAndSetFieldError("email")}
                              placeholder="exemplu@domeniu.ro"
                            />
                            {fieldErrors.email && (
                              <span className={styles.fieldError}>
                                {fieldErrors.email}
                              </span>
                            )}
                          </label>

                          <label className={styles.field}>
                            <span>Telefon*</span>
                            <input
                              ref={phoneRef}
                              className={fieldErrors.phone ? styles.inputError : ""}
                              type="tel"
                              inputMode="numeric"
                              maxLength={10}
                              value={shippingAddress.phone}
                              onChange={(e) => {
                                clearFieldError("phone");
                                updateShippingField(
                                  "phone",
                                  normalizeDigits(e.target.value).slice(0, 10)
                                );
                              }}
                              onBlur={() => validateAndSetFieldError("phone")}
                              placeholder="07xxxxxxxx"
                            />
                            {fieldErrors.phone && (
                              <span className={styles.fieldError}>
                                {fieldErrors.phone}
                              </span>
                            )}
                          </label>

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
                                  className={
                                    fieldErrors.county ? styles.inputError : ""
                                  }
                                  value={countyInput}
                                  onChange={(e) => {
                                    clearFieldError("county");
                                    setCountyInput(e.target.value);
                                    setShowCountyDropdown(true);
                                    updateShippingField("county", "");
                                  }}
                                  onFocus={() => setShowCountyDropdown(true)}
                                  onBlur={() => {
                                    setTimeout(
                                      () => setShowCountyDropdown(false),
                                      150
                                    );
                                    setTimeout(
                                      () => validateAndSetFieldError("county"),
                                      160
                                    );
                                  }}
                                  placeholder="Scrie numele județului..."
                                  autoComplete="off"
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
                                            handleSelectShippingCounty(c);
                                          }}
                                        >
                                          {c.name}{" "}
                                          <span
                                            className={styles.autocompleteCode}
                                          >
                                            ({c.code})
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                              </div>
                            )}

                            {fieldErrors.county && (
                              <span className={styles.fieldError}>
                                {fieldErrors.county}
                              </span>
                            )}
                          </label>

                          <label className={styles.field}>
                            <span>Oraș / Localitate*</span>
                            <input
                              ref={cityRef}
                              className={fieldErrors.city ? styles.inputError : ""}
                              value={shippingAddress.city}
                              onChange={(e) => {
                                clearFieldError("city");
                                updateShippingField("city", e.target.value);
                              }}
                              onBlur={() => validateAndSetFieldError("city")}
                              placeholder="Ex: București"
                            />
                            {fieldErrors.city && (
                              <span className={styles.fieldError}>
                                {fieldErrors.city}
                              </span>
                            )}
                          </label>

                          <label className={styles.field}>
                            <span>Cod poștal</span>
                            <input
                              ref={postalCodeRef}
                              className={
                                fieldErrors.postalCode ? styles.inputError : ""
                              }
                              inputMode="numeric"
                              maxLength={6}
                              value={shippingAddress.postalCode}
                              onChange={(e) => {
                                clearFieldError("postalCode");
                                updateShippingField(
                                  "postalCode",
                                  normalizeDigits(e.target.value).slice(0, 6)
                                );
                              }}
                              onBlur={() =>
                                validateAndSetFieldError("postalCode")
                              }
                              placeholder="Ex: 040011"
                            />
                            {fieldErrors.postalCode && (
                              <span className={styles.fieldError}>
                                {fieldErrors.postalCode}
                              </span>
                            )}
                          </label>

                          <label className={styles.fieldFull}>
                            <span>Stradă și număr*</span>
                            <input
                              ref={streetRef}
                              className={
                                fieldErrors.street ? styles.inputError : ""
                              }
                              value={shippingAddress.street}
                              onChange={(e) => {
                                clearFieldError("street");
                                updateShippingField("street", e.target.value);
                              }}
                              onBlur={() => validateAndSetFieldError("street")}
                              placeholder="Ex: Șos. Olteniței 123"
                            />
                            {fieldErrors.street && (
                              <span className={styles.fieldError}>
                                {fieldErrors.street}
                              </span>
                            )}
                          </label>

                          <label className={styles.fieldFull}>
                            <span>Observații (opțional)</span>
                            <textarea
                              value={shippingAddress.notes}
                              onChange={(e) =>
                                updateShippingField("notes", e.target.value)
                              }
                              rows={3}
                            />
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>

            <section className={styles.card}>
              <h3 className={styles.cardTitle}>Metodă de livrare</h3>
             <p className={styles.muted}>
  {isQuoteCheckout
    ? "Costul de transport este cel stabilit de creator în oferta acceptată."
    : "Costul de transport se calculează separat pentru fiecare magazin, pe baza tarifelor configurate de vendor."}
</p>
           <div className={styles.shipGrid}>
  {serviceGroups.map((group) => {
    const shipping = getGroupShipping(group);

    const key = String(
      group.serviceId ||
      group.vendorId ||
      "unknown"
    );

    const label =
      group.serviceTitle?.trim() ||
      (group.serviceId
        ? `Magazin #${String(group.serviceId).slice(0, 6)}…`
        : "Magazin");

    const groupItemCount =
      group.items?.length || 0;

    return (
      <div
        key={key}
        className={styles.vendorBox}
      >
        <div className={styles.vendorHead}>
          <strong>{label}</strong>

          <span>
            {groupItemCount}{" "}
            {groupItemCount === 1
              ? "produs"
              : "produse"}
          </span>
        </div>

        <div className={styles.summaryRow}>
          <span>Subtotal magazin</span>

          <strong>
            {money(
              isQuoteCheckout
                ? Number(
                    quoteCheckout?.offer?.subtotal ||
                    0
                  )
                : shipping.subtotal,
              currency
            )}
          </strong>
        </div>

        {isQuoteCheckout ? (
          <div className={styles.summaryRow}>
            <span>Transport stabilit în ofertă</span>

            <strong>
              {shippingTotal > 0
                ? money(
                    shippingTotal,
                    currency
                  )
                : "Gratuit"}
            </strong>
          </div>
        ) : (
          <>
            <div className={styles.summaryRow}>
              <span>
                Transport estimativ
              </span>

              <strong>
                {money(
                  shipping.estimatedShippingFee,
                  currency
                )}
              </strong>
            </div>

            {shipping.freeShippingThreshold !==
              null && (
              <div
                className={
                  styles.summaryRow
                }
              >
                <span>
                  Transport gratuit de la
                </span>

                <strong>
                  {money(
                    shipping.freeShippingThreshold,
                    currency
                  )}
                </strong>
              </div>
            )}

            <div className={styles.summaryRow}>
              <span>
                Transport aplicat
              </span>

              <strong>
                {shipping.qualifiesFreeShipping
                  ? "Gratuit"
                  : money(
                      shipping.finalShipping,
                      currency
                    )}
              </strong>
            </div>
          </>
        )}

        {group.shippingNotes && (
          <p
            className={styles.muted}
            style={{ marginTop: 8 }}
          >
            {group.shippingNotes}
          </p>
        )}
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

          <aside className={styles.right}>
            <div ref={paymentSectionRef} className={styles.card}>
              <h3 className={styles.cardTitle}>Sumar comandă</h3>

              <p className={styles.muted}>
  {isQuoteCheckout ? (
    <>
      Finalizezi o comandă pe baza unei
      oferte personalizate primite de la creator.
    </>
  ) : (
    <>
      Ai produse de la{" "}
      <strong>
        {serviceGroups.length}
      </strong>{" "}
      {serviceGroups.length === 1
        ? "magazin (artizan)."
        : "magazine (artizani)."}{" "}
      Fiecare pregătește și trimite
      produsele separat.
    </>
  )}
</p>

              {customerType === "PJ" ? (
                <>
                  <div className={styles.summaryRow}>
                    <span>Produse (fără TVA)</span>
                    <strong>{money(vatTotals.totalNet, currency)}</strong>
                  </div>

                  <div className={styles.summaryRow}>
                    <span>TVA produse</span>
                    <strong>{money(vatTotals.totalVat, currency)}</strong>
                  </div>

                  <div className={styles.summaryRow}>
                    <span>Produse (cu TVA)</span>
                    <strong>{money(vatTotals.totalGross, currency)}</strong>
                  </div>
                </>
              ) : (
                <div className={styles.summaryRow}>
                  <span>Produse</span>
                  <strong>{money(vatTotals.totalGross, currency)}</strong>
                </div>
              )}

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
      value="COD"
      checked={paymentMethod === "COD"}
      onChange={() =>
        setPaymentMethod("COD")
      }
    />

    <span>
      Plată la livrare (ramburs)
    </span>
  </label>

<label className={styles.radio}>
  <input
    type="radio"
    name="paymentMethod"
    value="CARD"
    checked={paymentMethod === "CARD"}
    onChange={() =>
      setPaymentMethod("CARD")
    }
  />

  <span>
    Plată online cu cardul
  </span>
</label>
</div>

{paymentMethod === "COD" && (
  <div
    style={{
      marginTop: 12,
      padding: "12px 14px",
      borderRadius: 10,
      background: "#fff8e7",
      border: "1px solid #f0d99b",
      fontSize: 13,
      lineHeight: 1.5,
      color: "#6b5621",
    }}
  >
    <strong>
      Important:
    </strong>{" "}
    pentru anumite comenzi, vânzătorul poate solicita după plasarea
    comenzii un avans de 15% înainte de a începe pregătirea produselor.
    Dacă este necesar, vei primi o notificare și un link securizat pentru
    plată.
  </div>
)}

              <div className={styles.divider} />

              <div className={styles.totalRow}>
                <span>Total de plată</span>
                <strong>{money(grandTotal, currency)}</strong>
              </div>

              <p className={styles.helperText}>
                {customerType === "PJ"
                  ? shipToDifferentAddress
                    ? "Pentru persoane juridice completezi separat datele de facturare, persoana de contact și adresa de livrare."
                    : "Pentru persoane juridice, livrarea se face la sediu, folosind persoana de contact introdusă."
                  : "Prețurile afișate pentru persoane fizice reprezintă prețul final."}
              </p>

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
                  Completează câmpurile obligatorii marcate cu * pentru a continua.
                </p>
              )}

              <p className={styles.legalNote}>
                Continuând, accepți{" "}
                <Link to="/termeni" target="_blank" rel="noreferrer">
                  Termenii
                </Link>{" "}
                și confirmi că ai citit{" "}
                <Link to="/confidentialitate" target="_blank" rel="noreferrer">
                  Politica de confidențialitate
                </Link>
                .
              </p>
            </div>

            <div className={styles.card}>
              <h4 className={styles.cardTitleSmall}>Retur & GDPR</h4>
              <ul className={styles.bullets}>
                <li>
                  Vezi{" "}
                  <Link to="/politica-de-retur" target="_blank" rel="noreferrer">
                    Politica de retur
                  </Link>
                  .
                </li>
                <li>
                  La generarea AWB, datele de livrare sunt transmise curierului.
                </li>
              </ul>
            </div>
          </aside>
        </div>
      )}

      {previewImage &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={styles.modalOverlay}
            role="dialog"
            aria-modal="true"
            aria-label="Previzualizare poză personalizare"
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                setPreviewImage(null);
              }
            }}
          >
            <div
              className={styles.modalContent}
              onMouseDown={(event) =>
                event.stopPropagation()
              }
            >
              <button
                type="button"
                className={styles.modalClose}
                onClick={() =>
                  setPreviewImage(null)
                }
                aria-label="Închide poza"
                title="Închide"
              >
                ×
              </button>

              <img
                src={previewImage.url}
                alt={
                  previewImage.label
                    ? `Personalizare ${previewImage.label}`
                    : "Poză personalizare"
                }
                className={styles.modalImage}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}