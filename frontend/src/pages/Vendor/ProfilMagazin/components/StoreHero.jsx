import React, { useState } from "react";
import { FaCopy, FaPlus, FaCamera } from "react-icons/fa";
import { MessageSquare } from "lucide-react";
import { onImgError } from "../../../../components/utils/imageFallback";
import styles from "../ProfilMagazin.module.css";
import OwnerStoresSwitcher from "./OwnerStoresSwitcher";
import StoreActivationBadge from "./StoreActivationBadge";

export default function StoreHero({
  isOwner,
  isUser,
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
  handleContactVendor,
  following,
  followLoading,
  toggleFollow,
  trackCTA,
}) {
  const [copied, setCopied] = useState(false);

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

  function onActivationClick() {
    if (activationDisabled) return;
    handleToggleActive?.();
  }

  return (
    <>
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
                  <button
                    className={styles.followBtn}
                    onClick={handleAddProduct}
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
                </>
              ) : (
                <>
                  {isUser && (
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
                  )}

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