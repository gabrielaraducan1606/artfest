import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  Instagram,
  Facebook,
  Heart,
  ShieldCheck,
  Headset,
} from "lucide-react";
import { FaTiktok } from "react-icons/fa";
import styles from "./Footer.module.css";

function absLegalUrl(pathname) {
  const p = (pathname || "").trim();
  if (!p) return "#";

  if (/^https?:\/\//i.test(p)) return p;

  const rel = p.startsWith("/") ? p : `/${p}`;

  const map = {
    "/legal/tos.html": "/termenii-si-conditiile",
    "/legal/privacy.html": "/confidentialitate",
    "/legal/cookies.html": "/cookies",
    "/legal/vendor_terms.html": "/acord-vanzatori",
    "/legal/returns_policy_ack.html": "/politica-retur",
    "/legal/shipping_addendum.html": "/anexa-expediere",
    "/legal/products_addendum.html": "/anexa-produse",
  };

  const normalized = map[rel] || rel;
  const base = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

  if (base) return `${base}${normalized}`;
  return normalized;
}

function getApiBase() {
  return (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
}

export default function Footer() {
  const year = new Date().getFullYear();
  const [status, setStatus] = useState("idle");
  const [email, setEmail] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e) => {
    e.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    setStatus("loading");

    try {
      const apiBase = getApiBase();
      const url = apiBase
        ? `${apiBase}/api/newsletter/subscribe`
        : "/api/newsletter/subscribe";

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          source: "FOOTER",
          sourceLabel: "Footer newsletter form",
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "newsletter_subscribe_failed");
      }

      setStatus("success");
      setEmail("");
    } catch (err) {
      console.error("Newsletter subscribe failed:", err);
      setStatus("error");
    }
  };

  const openPartnerModal = () => {
    const sp = new URLSearchParams(location.search);
    sp.set("auth", "register");
    sp.set("as", "partner");

    navigate({
      pathname: location.pathname,
      search: `?${sp.toString()}`,
    });
  };

  const termsUrl = absLegalUrl("/termenii-si-conditiile");
  const privacyUrl = absLegalUrl("/confidentialitate");
  const cookiesUrl = absLegalUrl("/cookies");

  return (
    <footer className={styles.footer}>
      <div className={styles.topBar} aria-hidden="true" />

      <div className={styles.container}>
        <div className={styles.colBrand}>
          <Link to="/" className={styles.brand}>
            Artfest
          </Link>

          <p className={styles.brandMeta}>
            Handmade & servicii pentru evenimente
          </p>

          <p className={styles.tagline}>
            Marketplace pentru artizani: produse handmade, servicii digitale și
            furnizori verificați pentru momente speciale.
          </p>

          <ul className={styles.trustList}>
            <li>
              <ShieldCheck size={16} />
              <span>Artizani verificați</span>
            </li>
            <li>
              <Heart size={16} />
              <span>Creat pentru evenimente</span>
            </li>
            <li>
              <Headset size={16} />
              <span>Suport dedicat</span>
            </li>
          </ul>

          <p className={styles.socialLabel}>Urmărește Artfest</p>

          <div className={styles.social}>
            <a
              href="https://www.instagram.com/artfestmarketplace?igsh=MWZ2YzFlYndrenA2Mg%3D%3D&utm_source=qr"
              target="_blank"
              rel="noreferrer"
              aria-label="Instagram"
              className={styles.socialBtn}
            >
              <Instagram size={18} />
            </a>

            <a
              href="https://www.facebook.com/share/1Cyxc1mqBA/?mibextid=wwXIfr"
              target="_blank"
              rel="noreferrer"
              aria-label="Facebook"
              className={styles.socialBtn}
            >
              <Facebook size={18} />
            </a>

            <a
              href="https://www.tiktok.com/@artfestmarketplace?_r=1&_t=ZN-95UJ6FYBxsk"
              target="_blank"
              rel="noreferrer"
              aria-label="TikTok"
              className={styles.socialBtn}
            >
              <FaTiktok size={18} />
            </a>
          </div>
        </div>

        <nav className={styles.colNav}>
          <h3 className={styles.heading}>Descoperă</h3>
          <ul className={styles.list}>
            <li>
              <Link to="/produse" className={styles.link}>
                Produse handmade
              </Link>
            </li>
            <li>
              <Link to="/magazine" className={styles.link}>
                Magazine & artizani
              </Link>
            </li>
            <li>
              <Link to="/servicii-digitale" className={styles.link}>
                Invitații digitale
              </Link>
            </li>
            <li>
              <Link to="/servicii-digitale" className={styles.link}>
                Așezare la mese (SMS)
              </Link>
            </li>
            <li>
              <Link to="/servicii-digitale" className={styles.link}>
                Album foto QR
              </Link>
            </li>
          </ul>
        </nav>

        <nav className={styles.colSupport}>
          <h3 className={styles.heading}>Pentru artizani</h3>

          <ul className={styles.list}>
            <li>
              <button
                type="button"
                className={styles.linkButton}
                onClick={openPartnerModal}
              >
                Devino partener
              </button>
            </li>
            <li>
              <Link to="/support" className={styles.link}>
                Contact
              </Link>
            </li>
          </ul>

          <button
            type="button"
            className={styles.vendorCta}
            onClick={openPartnerModal}
          >
            Aplică pentru listare →
          </button>
        </nav>

        <div className={styles.colNews}>
          <h3 className={styles.heading}>
            Idei pentru evenimente, direct în inbox
          </h3>

          <p className={styles.note}>
            Inspirație, trenduri și oferte de la artizani. Fără spam.
          </p>

          <form className={styles.newsForm} onSubmit={handleSubmit}>
            <input
              type="email"
              className={styles.input}
              placeholder="email@exemplu.ro"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status !== "idle") setStatus("idle");
              }}
              aria-label="Adresa de email pentru abonare"
            />

            <button
              type="submit"
              className={styles.btn}
              disabled={status === "loading"}
            >
              {status === "loading"
                ? "Se trimite..."
                : status === "success"
                ? "✔ Abonat"
                : status === "error"
                ? "Încearcă din nou"
                : "Mă abonez"}
            </button>
          </form>

          {status === "success" && (
            <p className={styles.miniLegal} style={{ marginTop: "0.5rem" }}>
              Te-ai abonat cu succes.
            </p>
          )}

          {status === "error" && (
            <p className={styles.miniLegal} style={{ marginTop: "0.5rem" }}>
              Nu am putut salva abonarea. Încearcă din nou.
            </p>
          )}

          <p className={styles.miniLegal}>
            Prin abonare accepți{" "}
            <a
              href={privacyUrl}
              className={styles.linkInline}
              target="_blank"
              rel="noopener noreferrer"
            >
              politica de confidențialitate
            </a>
            .
          </p>
        </div>
      </div>

      <div className={styles.bottom}>
        <div className={styles.copy}>
          &copy; {year} <span className={styles.brandInline}>Artfest</span>.
          Toate drepturile rezervate.
        </div>

        <div className={styles.bottomLinks}>
          <a
            href={termsUrl}
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Termeni
          </a>
          <a
            href={privacyUrl}
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Politica de confidențialitate
          </a>
          <a
            href={cookiesUrl}
            className={styles.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Cookie-uri
          </a>
        </div>
      </div>
    </footer>
  );
}