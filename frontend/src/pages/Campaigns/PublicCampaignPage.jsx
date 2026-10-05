import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../lib/api.js";
import { buildCampaignUrlQuery, captureCampaignSlug } from "../../utils/campaignAttribution.js";
import ProductCard from "../Vendor/ProfilMagazin/components/ProductCard";
import { SEO } from "../../components/Seo/SeoProvider";
import styles from "../Products/Products.module.css";

/*
 * LEGACY /c/:slug - campaniile au devenit „Colecții” (VendorCollection).
 * O campanie MIGRATĂ (VendorCollection.legacyCampaignId) face redirect la
 * pagina canonică /colectie-vendor/:slug (păstrând query-ul, ex. ?ref=).
 * O campanie NEMIGRATĂ păstrează temporar comportamentul vechi de mai jos.
 */
export default function PublicCampaignPage() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [me, setMe] = useState(null);

  /*
   * Determină dacă vizitatorul e logat, la fel ca în
   * Products.jsx - decide viewMode pentru ProductCard
   * ("user" vs "guest"), care la rândul lui decide dacă
   * inima/coșul apelează fallback-ul real din ProductCard
   * (/api/favorites/toggle, /api/cart/add sau addToGuestCart) -
   * exact mecanismul deja folosit corect în profilul
   * magazinului (ProductList.jsx nu trimite onAddToCart, se
   * bazează pe același fallback din ProductCard).
   */
  useEffect(() => {
    let alive = true;

    api("/api/auth/me")
      .then((res) => {
        if (!alive) return;
        setMe(res?.__unauth ? null : res?.user || null);
      })
      .catch(() => {
        if (alive) setMe(null);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError("");
    setData(null);

    // 1) campanie migrată -> redirect; 404 (nemigrată) -> pagina veche
    api(`/api/public/vendor-collections/legacy-campaign/${encodeURIComponent(slug || "")}`)
      .then((legacy) => (legacy?.collectionSlug ? legacy.collectionSlug : null))
      .catch(() => null)
      .then((collectionSlug) => {
        if (cancelled) return null;

        if (collectionSlug) {
          cancelled = true;
          navigate(`/colectie-vendor/${encodeURIComponent(collectionSlug)}${location.search || ""}`, {
            replace: true,
          });
          return null;
        }

        return api(`/api/public/campaigns/${encodeURIComponent(slug || "")}`);
      })
      .then((res) => {
        if (cancelled || !res) return;
        setData(res);

        // campania (validă - serverul a răspuns 200) intră DOAR în memoria
        // aplicației; fără storage / consimțământ (utils/campaignAttribution.js)
        if (res?.campaign?.slug) {
          captureCampaignSlug(res.campaign.slug);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            e?.message || "Această campanie nu este disponibilă."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, navigate, location.search]);

  const viewMode = me ? "user" : "guest";

  // ?camp= pe linkurile produselor: refresh / tab nou pe produs păstrează campania
  const campaignSlug = data?.campaign?.slug || null;
  const productLinkQuery = campaignSlug ? buildCampaignUrlQuery([campaignSlug]) : "";

  const productCards = useMemo(() => {
    const products = Array.isArray(data?.products) ? data.products : [];

    /*
     * Fără onAddToCart/onToggleFavorite - ProductCard are deja
     * propriul fallback funcțional (POST /api/cart/add sau
     * addToGuestCart; POST /api/favorites/toggle), exact ce
     * folosește deja ProductList.jsx în profilul magazinului.
     * Nu duplicăm logica aici.
     */
    return products.map((p) => (
      <ProductCard
        key={p.id}
        p={p}
        viewMode={viewMode}
        isFav={false}
        categoryLabelMap={{}}
        linkQuery={productLinkQuery}
      />
    ));
  }, [data, viewMode, productLinkQuery]);

  const canonical = `https://www.artfest.ro/c/${slug || ""}`;

  if (loading) {
    return <section className={styles.page}>Se încarcă campania…</section>;
  }

  if (error || !data?.campaign) {
    return (
      <section className={styles.page}>
        <SEO
          title="Campania nu a fost găsită | Artfest"
          description="Această campanie nu este disponibilă."
          canonical={canonical}
          url={canonical}
        />

        <h1>Campania nu a fost găsită</h1>
        <p>{error || "Această campanie nu este disponibilă momentan."}</p>

        <Link to="/" className={styles.btnPrimary}>
          Mergi la Artfest
        </Link>
      </section>
    );
  }

  const { campaign, vendor, products = [] } = data;

  const title = `${campaign.name} — ${vendor?.displayName || "Artfest"}`;
  const description =
    vendor?.about ||
    `Descoperă produsele ${vendor?.displayName || ""} din campania ${
      campaign.name
    } pe Artfest.`;

  return (
    <section className={styles.page} style={{ paddingBottom: 110 }}>
      <SEO
        title={title}
        description={description}
        canonical={canonical}
        url={canonical}
        image={vendor?.coverUrl || vendor?.logoUrl || undefined}
      />

      <header className={styles.head}>
        <div className={styles.categoryHeroText}>
          <span className={styles.categoryEyebrow}>
            Campanie · {vendor?.displayName || "Artfest"}
          </span>
          <h1 className={styles.h1}>{campaign.name}</h1>

          {campaign.discountPercent > 0 ? (
            <p className={styles.categoryIntro}>
              {campaign.discountPercent}% reducere la produsele
              participante din această campanie.
            </p>
          ) : null}
        </div>

        {vendor?.coverUrl ? (
          <img
            src={vendor.coverUrl}
            alt={vendor.displayName}
            style={{
              width: "100%",
              maxHeight: 360,
              objectFit: "cover",
              borderRadius: 24,
              marginTop: 20,
            }}
          />
        ) : null}
      </header>

      {products.length ? (
        <div className={styles.grid}>{productCards}</div>
      ) : (
        <p className={styles.emptyState}>
          Momentan nu există produse disponibile în această campanie.
        </p>
      )}

      {vendor?.id ? (
        <div style={{ textAlign: "center", marginTop: 48 }}>
          <Link to={`/magazin/${vendor?.services?.[0]?.slug || ""}`} className={styles.btnPrimary}>
            Vezi tot magazinul {vendor.displayName}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
