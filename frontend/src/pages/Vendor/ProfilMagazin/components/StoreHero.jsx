import React, { useState } from "react";
import { FaCopy, FaPlus, FaCamera } from "react-icons/fa";
import { MessageSquare } from "lucide-react";
import { onImgError } from "../../../../components/utils/imageFallback";
import styles from "../ProfilMagazin.module.css";
import OwnerStoresSwitcher from "./OwnerStoresSwitcher";
import StoreActivationBadge from "./StoreActivationBadge";

export default function StoreHero({
  isOwner,
  shopName,
  shortText,
  origin,
  sdSlug,
  coverUrl,
  avatarUrl,
  coverInputRef,
  avatarInputRef,
  onCoverChange,
  onAvatarChange,
  ownerStores,
  ownerStoresLoading,
  handleGoToOwnerStore,
  handleCreateNewStoreFromProfile,

  sellerType,
  sellerTypeLabel,

  serviceIsActive = false,
  activationBusy = false,
  ownerChecksLoading = false,
  serviceId,
  handleToggleActive,
  activationError,

  followersCount = 0,
  canAddProduct,
  prodLimits,
  handleAddProduct,
showAddProductHint = false,
heroActionsRef,
onDismissAddProductHint,
  handleContactVendor,
  following,
  followLoading,
  toggleFollow,
  trackCTA,
  ambassador,
}) {
  const [copied, setCopied] = useState(false);
  const [showActivationHint, setShowActivationHint] = useState(false);

  const activationDisabled =
    activationBusy ||
    ownerChecksLoading ||
    !serviceId ||
    typeof handleToggleActive !== "function";

  async function handleCopy() {
    const url = `${origin}/magazin/${sdSlug}`;

    try {
      await navigator.clipboard.writeText(url);
      trackCTA?.("Copy profile link");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();

      try {
        document.execCommand("copy");
        trackCTA?.("Copy profile link");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // noop
      }

      document.body.removeChild(ta);
    }
  }

  async function handleCopyAmbassadorLink() {
    if (!ambassador?.referralLink) return;

    const text = `Fac parte din Artfest, comunitatea creatorilor români. ❤️
Hai să ajungem împreună la 1000 de creatori!
Înscrie-te aici: ${ambassador.referralLink}`;

    try {
      await navigator.clipboard.writeText(text);
      alert("Textul și linkul de invitație au fost copiate.");
    } catch {
      window.prompt("Copiază mesajul:", text);
    }
  }

  function onActivationClick() {
    if (activationDisabled) return;
    setShowActivationHint(false);
    handleToggleActive?.();
  }

  function onAddProductClick() {
    setShowActivationHint(false);
    onDismissAddProductHint?.();
    handleAddProduct?.();
  }

  function onSkipAddProductHint() {
    onDismissAddProductHint?.();
    setShowActivationHint(true);
  }

  return (
    <>
      {isOwner && ambassador?.referralLink && (
        <div className={styles.storeAmbassadorStrip}>
          <div className={styles.storeAmbassadorInfo}>
            <div className={styles.storeAmbassadorTitle}>
              🚀 Programul Ambasadorilor Artfest
            </div>

            <div className={styles.storeAmbassadorSubtitle}>
              Ai invitat <strong>{ambassador.invitedCount || 0}</strong>{" "}
              creatori prin linkul tău
            </div>

            <div className={styles.storeAmbassadorProgress}>
              {ambassador.level === "FOUNDING" &&
                "Mai ai 2 invitații până la nivelul Ambasador"}

              {ambassador.level === "AMBASSADOR" &&
                `Mai ai ${Math.max(
                  0,
                  10 - (ambassador.invitedCount || 0)
                )} invitații până la Gold`}

              {ambassador.level === "GOLD" &&
                `Mai ai ${Math.max(
                  0,
                  25 - (ambassador.invitedCount || 0)
                )} invitații până la Elite`}

              {ambassador.level === "ELITE" &&
                "Ai atins cel mai înalt nivel 🎉"}
            </div>
          </div>

          <div className={styles.storeAmbassadorActions}>
            <button type="button" onClick={handleCopyAmbassadorLink}>
              Copiază linkul
            </button>

            <a href="/ambasadori">Vezi beneficiile</a>
          </div>
        </div>
      )}

      <div className={styles.cover}>
        {coverUrl ? (
          <img
            src={coverUrl}
            className={styles.coverImg}
            alt="Copertă"
            loading="lazy"
            decoding="async"
            onError={(e) => onImgError(e, 1200, 360, "Cover")}
          />
        ) : (
          <div className={styles.coverPlaceholder} aria-label="Copertă" />
        )}

        {isOwner && (
          <>
            <button
              type="button"
              className={`${styles.editFab} ${styles.editFabCover}`}
              onClick={() => coverInputRef.current?.click()}
              title="Schimbă fotografia de copertă"
              aria-label="Schimbă fotografia de copertă"
            >
              <FaCamera size={18} />
            </button>

            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              onChange={onCoverChange}
              style={{ display: "none" }}
            />
          </>
        )}
      </div>

      <div className={styles.card}>
        <div className={styles.headerRow}>
          <div className={styles.avatarWrap}>
            {avatarUrl ? (
              <img
                src={avatarUrl}
                className={styles.avatar}
                alt="Profil"
                loading="lazy"
                decoding="async"
                onError={(e) => onImgError(e, 160, 160, "Profil")}
              />
            ) : (
              <div className={styles.avatarPlaceholder} aria-label="Profil" />
            )}

            {isOwner && (
              <>
                <button
                  type="button"
                  className={`${styles.editFab} ${styles.editFabAvatar}`}
                  onClick={() => avatarInputRef.current?.click()}
                  title="Schimbă fotografia de profil"
                  aria-label="Schimbă fotografia de profil"
                >
                  <FaCamera size={16} />
                </button>

                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onAvatarChange}
                  style={{ display: "none" }}
                />
              </>
            )}
          </div>

          <div>
            <h1 className={styles.title}>{shopName}</h1>

            {sellerTypeLabel && (
              <div style={{ marginTop: 6, marginBottom: 6 }}>
                <span
                  className={styles.sellerTypeBadge}
                  title={
                    sellerType === "independent_creator"
                      ? "Acest magazin este operat de un Creator Independent."
                      : "Acest magazin este operat de un Business Verificat."
                  }
                >
                  {sellerType === "independent_creator" ? "🌱" : "✓"}{" "}
                  {sellerTypeLabel}
                </span>
              </div>
            )}

            {shortText && <p className={styles.subtitle}>{shortText}</p>}

            <OwnerStoresSwitcher
              isOwner={isOwner}
              stores={ownerStores}
              currentSlug={sdSlug}
              loading={ownerStoresLoading}
              onGoToStore={handleGoToOwnerStore}
              onAddStore={handleCreateNewStoreFromProfile}
            />

            <StoreActivationBadge
              isOwner={isOwner}
              isActive={serviceIsActive}
              busy={activationDisabled}
              onActivate={() => {
                if (!serviceIsActive) onActivationClick();
              }}
            />

            {!!sdSlug && (
              <div className={styles.linkRow} style={{ marginTop: 6 }}>
                <div className={styles.slug}>
                  {origin}/magazin/{sdSlug}
                </div>

                <button
                  type="button"
                  className={styles.copyBtn}
                  onClick={handleCopy}
                  title="Copiază link-ul profilului"
                  aria-label="Copiază link-ul profilului"
                >
                  <FaCopy size={14} />
                </button>

                {copied && (
                  <span className={styles.copiedBadge} style={{ fontWeight: 700 }}>
                    Copiat!
                  </span>
                )}
              </div>
            )}
          </div>

         <div
  ref={heroActionsRef}
  className={styles.actions}
  style={{ display: "flex", flexDirection: "column", gap: 4 }}
>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              <div className={styles.followersBadge}>
                {followersCount} urmăritor{followersCount === 1 ? "" : "i"}
              </div>

              {isOwner ? (
                <>
                  <div className={styles.actionWithHint}>
                    <button
                      className={styles.followBtn}
                      onClick={onAddProductClick}
                      type="button"
                      disabled={!canAddProduct}
                      title={
                        canAddProduct
                          ? "Adaugă produs"
                          : `Ai atins limita (${prodLimits?.currentProducts}/${prodLimits?.maxProducts}). Upgrade necesar.`
                      }
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        opacity: canAddProduct ? 1 : 0.6,
                        cursor: canAddProduct ? "pointer" : "not-allowed",
                      }}
                    >
                      <FaPlus /> Adaugă produs
                    </button>

                    {showAddProductHint && (
                      <div className={`${styles.coachmark} ${styles.coachmarkLeft}`}>
                        <strong>Adaugă primul produs</strong>
                        <p>
                          Adaugă primul produs pentru a începe să primești vizitatori și comenzi.
Poți modifica sau șterge produsele oricând.
                        </p>

                        <div className={styles.coachmarkActions}>
                          <button type="button" onClick={onAddProductClick}>
                            Adaugă acum
                          </button>

                          <button type="button" onClick={onSkipAddProductHint}>
                            Mai târziu
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className={styles.actionWithHint}>
                    <button
                      className={styles.followBtn}
                      type="button"
                      onClick={onActivationClick}
                      disabled={activationDisabled}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        opacity: activationDisabled ? 0.6 : 1,
                        cursor: activationDisabled ? "not-allowed" : "pointer",
                      }}
                      title={
                        !serviceId
                          ? "Magazinul nu are încă un serviceId valid."
                          : serviceIsActive
                          ? "Dezactivează magazinul."
                          : "Activează magazinul."
                      }
                    >
                      {activationBusy
                        ? serviceIsActive
                          ? "Se dezactivează…"
                          : "Se activează…"
                        : serviceIsActive
                        ? "Dezactivează magazin"
                        : "Activează magazin"}
                    </button>

                    {showActivationHint && (
                     <div className={`${styles.coachmark} ${styles.coachmarkRight}`}>
                        <strong>Controlezi vizibilitatea magazinului</strong>
                        <p>
                          Îl poți dezactiva oricând când ești în vacanță sau nu poți prelua comenzi.
                        </p>

                        <div className={styles.coachmarkActions}>
                          <button
                            type="button"
                            onClick={() => setShowActivationHint(false)}
                          >
                            Am înțeles
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <button
                    className={styles.followBtn}
                    type="button"
                    onClick={handleContactVendor}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      marginRight: 8,
                    }}
                  >
                    <MessageSquare size={16} />
                    Trimite mesaj
                  </button>

                  <button
                    className={`${styles.followBtn} ${
                      following ? styles.followBtnActive : ""
                    }`}
                    onClick={toggleFollow}
                    type="button"
                    disabled={followLoading}
                  >
                    {followLoading
                      ? "Se actualizează..."
                      : following
                      ? "Nu mai urmări"
                      : "Urmărește"}
                  </button>
                </>
              )}
            </div>

            {isOwner && activationError && (
              <div
                style={{
                  fontSize: 12,
                  color: "#b91c1c",
                  textAlign: "right",
                  maxWidth: 360,
                  marginLeft: "auto",
                  whiteSpace: "pre-line",
                }}
              >
                {activationError}
              </div>
            )}
          </div>
        </div>

        <hr className={styles.hr} />
      </div>
    </>
  );
}