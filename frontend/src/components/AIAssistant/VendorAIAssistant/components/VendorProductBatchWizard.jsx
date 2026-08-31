// src/components/AIAssistant/Vendor/components/VendorProductBatchWizard.jsx

import React, {
  useMemo,
  useState,
} from "react";

import styles from "./VendorProductBatchWizard.module.css";

import { getMissingFields } from "./VendorProductWizard.jsx";

import ProductClientPreviewModal from "../../../../pages/Vendor/ProfilMagazin/modals/ProductModal/components/ProductClientPreviewModal.jsx";

function getImageUrl(image) {
  if (typeof image === "string") {
    return image;
  }

  return (
    image?.previewUrl ||
    image?.url ||
    image?.src ||
    image?.imageUrl ||
    ""
  );
}

/* =========================================================
   Un grup - imagini editabile + acțiuni de corectare
========================================================= */

function GroupCard({
  group,
  otherGroups,
  selectedImageIds,
  onToggleSelect,
  onChooseMoveTarget,
  moveTarget,
  onConfirmMove,
  onChooseMergeTarget,
  mergeTarget,
  onConfirmMerge,
  onSetGroupTitle,
  onSetPrimaryImage,
  onRemoveImage,
  onRemoveGroup,
}) {
  const needsReview =
    group.status === "NEEDS_REVIEW";

  const hasSelection =
    selectedImageIds.size > 0;

  return (
    <div
      className={`${styles.groupCard} ${
        needsReview
          ? styles.groupCardNeedsReview
          : ""
      }`}
    >
      <div className={styles.groupHeader}>
        <div>
          <strong>
            {group.title ||
              "Produs fără titlu"}
          </strong>

          <div
            className={
              styles.groupHeaderMeta
            }
          >
            <span
              className={
                styles.groupImageCount
              }
            >
              {group.images.length}{" "}
              {group.images.length === 1
                ? "fotografie"
                : "fotografii"}
            </span>

            {needsReview && (
              <span
                className={`${styles.badge} ${styles.badgeWarning}`}
              >
                Verifică această grupare
              </span>
            )}

            {group.boundaryHint && (
              <span
                className={`${styles.badge} ${styles.badgeInfo}`}
              >
                Ar putea fi „
                {group.boundaryHint.title}
                "
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          className={styles.headerButton}
          onClick={() =>
            onRemoveGroup(group.id)
          }
        >
          Elimină
        </button>
      </div>

      <div className={styles.groupImageGrid}>
        {group.images.map(
          (image, index) => {
            const url = getImageUrl(image);

            if (!url) {
              return null;
            }

            const isPrimary =
              index === 0;

            const isSelected =
              selectedImageIds.has(
                image.id
              );

            return (
              <div
                key={image.id}
                className={`${styles.imageChip} ${
                  isPrimary
                    ? styles.imageChipPrimary
                    : ""
                } ${
                  isSelected
                    ? styles.imageChipSelected
                    : ""
                }`}
              >
                <input
                  type="checkbox"
                  className={
                    styles.imageChipCheckbox
                  }
                  checked={isSelected}
                  onChange={() =>
                    onToggleSelect(
                      image.id
                    )
                  }
                  aria-label="Selectează fotografia"
                />

                <img
                  src={url}
                  alt=""
                />

                <button
                  type="button"
                  className={
                    styles.imageChipButton
                  }
                  onClick={() =>
                    onSetPrimaryImage(
                      image.id
                    )
                  }
                  aria-label="Fă imagine principală"
                />

                {isPrimary && (
                  <span
                    className={
                      styles.imageChipPrimaryMark
                    }
                  >
                    Principală
                  </span>
                )}

                <button
                  type="button"
                  className={
                    styles.imageChipRemove
                  }
                  onClick={() =>
                    onRemoveImage(image.id)
                  }
                  aria-label="Elimină fotografia"
                >
                  ✕
                </button>
              </div>
            );
          }
        )}
      </div>

      <input
        value={group.title || ""}
        onChange={(event) =>
          onSetGroupTitle(
            event.target.value
          )
        }
        placeholder="Titlul provizoriu al produsului"
        className={styles.groupTitleInput}
      />

      <div className={styles.groupActionsRow}>
        <select
          className={styles.select}
          value={moveTarget || "__new__"}
          disabled={!hasSelection}
          onChange={(event) =>
            onChooseMoveTarget(
              event.target.value
            )
          }
        >
          <option value="__new__">
            Grup nou
          </option>

          {otherGroups.map((other) => (
            <option
              key={other.id}
              value={other.id}
            >
              {other.title ||
                "Produs fără titlu"}
            </option>
          ))}
        </select>

        <button
          type="button"
          className={styles.smallButton}
          disabled={!hasSelection}
          onClick={onConfirmMove}
        >
          Mută selecția
        </button>

        {otherGroups.length > 0 && (
          <>
            <select
              className={styles.select}
              value={
                mergeTarget ||
                otherGroups[0]?.id ||
                ""
              }
              onChange={(event) =>
                onChooseMergeTarget(
                  event.target.value
                )
              }
            >
              {otherGroups.map((other) => (
                <option
                  key={other.id}
                  value={other.id}
                >
                  {other.title ||
                    "Produs fără titlu"}
                </option>
              ))}
            </select>

            <button
              type="button"
              className={styles.smallButton}
              onClick={onConfirmMerge}
            >
              Combină cu
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* =========================================================
   Card produs - pasul de review (editare/validare/preview/salvare)
========================================================= */

function ProductReviewCard({
  group,
  onEdit,
  onRemove,
  onRetryAnalysis,
  onPublish,
  onPreview,
}) {
  const draft = group.productDraft || {};

  const images = Array.isArray(
    draft.images
  )
    ? draft.images
    : group.images;

  /*
   * getMissingFields e o verificare ieftină (câteva câmpuri) - nu
   * merită complexitatea unui useMemo (draft/images sunt oricum
   * obiecte noi la fiecare render venit din props).
   */
  const missingFields = getMissingFields(
    draft,
    images
  );

  const url = getImageUrl(images[0]);

  const title =
    draft.title ||
    group.title ||
    "Produs fără titlu";

  const isAnalysisFailed =
    group.status === "ANALYSIS_FAILED";

  const isPublished =
    group.saveStatus === "published";

  const isSaving =
    group.saveStatus === "saving";

  const isSaveFailed =
    group.saveStatus === "failed";

  let statusIcon = "⚠";
  let statusLabel = "Mai ai de completat";
  let statusClass = styles.badgeWarning;

  if (isAnalysisFailed) {
    statusIcon = "✕";
    statusLabel = "Analiza a eșuat";
    statusClass = styles.badgeDanger;
  } else if (isPublished) {
    statusIcon = "✓";
    statusLabel = "Publicat";
    statusClass = styles.badgeSuccess;
  } else if (isSaveFailed) {
    statusIcon = "✕";
    statusLabel = "Nu a putut fi salvat";
    statusClass = styles.badgeDanger;
  } else if (missingFields.length === 0) {
    statusIcon = "✓";
    statusLabel = "Pregătit";
    statusClass = styles.badgeSuccess;
  }

  return (
    <div className={styles.reviewCard}>
      <div
        className={
          styles.reviewCardImage
        }
      >
        {url && <img src={url} alt="" />}
      </div>

      <div
        className={styles.reviewCardBody}
      >
        <p
          className={
            styles.reviewCardTitle
          }
        >
          {title}
        </p>

        <p
          className={
            styles.reviewCardMeta
          }
        >
          {draft.category ||
            "Categorie nedetectată"}
        </p>

        <span
          className={`${styles.badge} ${statusClass}`}
        >
          {statusIcon} {statusLabel}
        </span>

        {isAnalysisFailed && (
          <p
            className={styles.errorText}
          >
            {group.analysisError ||
              "Analiza a eșuat pentru acest produs."}
          </p>
        )}

        {isSaveFailed && (
          <p
            className={styles.errorText}
          >
            {group.saveError ||
              "Produsul nu a putut fi salvat."}
          </p>
        )}

        {!isAnalysisFailed &&
          !isPublished &&
          missingFields.length > 0 && (
            <ul
              className={
                styles.infoList
              }
            >
              {missingFields.map(
                (field) => (
                  <li key={field}>
                    {field}
                  </li>
                )
              )}
            </ul>
          )}

        {isPublished && (
          <a
            href={`/produs/${group.publishedProduct?.productId}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.hint}
            style={{
              textDecoration:
                "underline",
            }}
          >
            Vezi produsul publicat
          </a>
        )}

        <div
          className={
            styles.reviewCardActions
          }
        >
          {isAnalysisFailed && (
            <button
              type="button"
              className={
                styles.smallButton
              }
              onClick={onRetryAnalysis}
            >
              Reîncearcă analiza
            </button>
          )}

          {isSaveFailed && (
            <button
              type="button"
              className={
                styles.smallButton
              }
              onClick={onPublish}
            >
              Reîncearcă salvarea
            </button>
          )}

          {!isPublished && (
            <button
              type="button"
              className={
                styles.smallButton
              }
              disabled={isSaving}
              onClick={onEdit}
            >
              Editează
            </button>
          )}

          {!isAnalysisFailed && (
            <button
              type="button"
              className={
                styles.smallButton
              }
              onClick={onPreview}
            >
              Vezi cum va arăta
            </button>
          )}

          {!isPublished && (
            <button
              type="button"
              className={`${styles.smallButton} ${styles.smallButtonDanger}`}
              disabled={isSaving}
              onClick={onRemove}
            >
              Elimină din import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Componentă principală
========================================================= */

export default function VendorProductBatchWizard({
  images = [],
  groups = [],

  step = "images",
  setStep,

  onUpload,
  onCapturePhoto,
  onAnalyzeGroups,
  onAnalyzeGroupProducts,

  onMoveImage,
  onRemoveImage,
  onSplitGroup,
  onMergeGroups,
  onSetGroupTitle,
  onSetPrimaryImage,
  onRemoveGroup,

  onEditGroup,
  onPublishGroup,
  onPublishReadyGroups,
  bulkPublishing = false,
  bulkPublishSummary = null,
  onDismissBulkSummary,
  onResetBatch,

  onBack,
  onClose,

  analyzing = false,
  progress = null,
  groupingError = "",
}) {
  const [
    previewGroupId,
    setPreviewGroupId,
  ] = useState(null);
  const safeImages = useMemo(
    () =>
      Array.isArray(images)
        ? images
        : [],
    [images]
  );

  const safeGroups = useMemo(
    () =>
      Array.isArray(groups)
        ? groups
        : [],
    [groups]
  );

  /*
   * Stare pur de UI (selecție per grup + țintă aleasă pentru
   * mutare/combinare) - nu e nevoie să existe pe VendorAssistant,
   * se resetează natural la schimbarea listei de grupuri.
   */
  const [
    selectionByGroup,
    setSelectionByGroup,
  ] = useState({});

  const [
    moveTargetByGroup,
    setMoveTargetByGroup,
  ] = useState({});

  const [
    mergeTargetByGroup,
    setMergeTargetByGroup,
  ] = useState({});

  function goToStep(nextStep) {
    setStep?.(nextStep);
  }

  function toggleSelect(groupId, imageId) {
    setSelectionByGroup((current) => {
      const currentSet = new Set(
        current[groupId] || []
      );

      if (currentSet.has(imageId)) {
        currentSet.delete(imageId);
      } else {
        currentSet.add(imageId);
      }

      return {
        ...current,
        [groupId]: currentSet,
      };
    });
  }

  function clearSelection(groupId) {
    setSelectionByGroup((current) => ({
      ...current,
      [groupId]: new Set(),
    }));
  }

  function handleConfirmMove(groupId) {
    const selected = Array.from(
      selectionByGroup[groupId] || []
    );

    if (!selected.length) {
      return;
    }

    const target =
      moveTargetByGroup[groupId] ||
      "__new__";

    if (target === "__new__") {
      onSplitGroup?.(groupId, selected);
    } else {
      for (const imageId of selected) {
        onMoveImage?.(imageId, target);
      }
    }

    clearSelection(groupId);
  }

  function handleConfirmMerge(
    groupId,
    otherGroups
  ) {
    const target =
      mergeTargetByGroup[groupId] ||
      otherGroups[0]?.id;

    if (!target) {
      return;
    }

    onMergeGroups?.(groupId, target);
  }

  /*
   * Status global (cerința #10) - folosește EXACT aceeași funcție
   * de checklist ca single-product (getMissingFields), nu o
   * reimplementare.
   */
  const reviewSummary = useMemo(() => {
    let readyCount = 0;
    let incompleteCount = 0;
    let publishedCount = 0;
    let analysisFailedCount = 0;

    for (const group of safeGroups) {
      if (group.status === "ANALYSIS_FAILED") {
        analysisFailedCount += 1;
        continue;
      }

      if (group.saveStatus === "published") {
        publishedCount += 1;
        continue;
      }

      const draft = group.productDraft || {};

      const images = Array.isArray(
        draft.images
      )
        ? draft.images
        : group.images;

      const missing = getMissingFields(
        draft,
        images
      );

      if (missing.length === 0) {
        readyCount += 1;
      } else {
        incompleteCount += 1;
      }
    }

    return {
      readyCount,
      incompleteCount,
      publishedCount,
      analysisFailedCount,
    };
  }, [safeGroups]);

  const readyGroupIds = useMemo(
    () =>
      new Set(
        safeGroups
          .filter((group) => {
            if (
              group.status ===
                "ANALYSIS_FAILED" ||
              group.saveStatus ===
                "published" ||
              group.saveStatus ===
                "saving"
            ) {
              return false;
            }

            const draft =
              group.productDraft || {};

            const images = Array.isArray(
              draft.images
            )
              ? draft.images
              : group.images;

            return (
              getMissingFields(
                draft,
                images
              ).length === 0
            );
          })
          .map((group) => group.id)
      ),
    [safeGroups]
  );

  const previewGroup = safeGroups.find(
    (group) => group.id === previewGroupId
  );

  return (
    <section className={styles.wrapper}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.headerButton}
          onClick={onBack}
        >
          ← Înapoi
        </button>

        <strong
          className={styles.headerTitle}
        >
          Adaugă mai multe produse
        </strong>

        <button
          type="button"
          className={styles.headerButton}
          onClick={onClose}
          aria-label="Închide"
        >
          ✕
        </button>
      </header>

      <div className={styles.content}>
        {step === "images" && (
          <>
            <div className={styles.progress}>
              Pasul 1 din 3
            </div>

            <h3 className={styles.title}>
              Încarcă toate fotografiile
            </h3>

            <p className={styles.text}>
              Încarcă toate fotografiile
              produselor, iar AI-ul le va
              grupa și îți va pregăti
              produsele.
            </p>

            {groupingError && (
              <p
                className={styles.errorText}
              >
                {groupingError}
              </p>
            )}

            {safeImages.length > 0 && (
              <div
                className={styles.imageGrid}
              >
                {safeImages.map(
                  (image, index) => {
                    const url =
                      getImageUrl(image);

                    if (!url) {
                      return null;
                    }

                    return (
                      <div
                        key={
                          image?.id ||
                          `${url}-${index}`
                        }
                        className={
                          styles.imageThumb
                        }
                      >
                        <img
                          src={url}
                          alt={`Fotografie ${
                            index + 1
                          }`}
                        />

                        <button
                          type="button"
                          className={
                            styles.imageChipRemove
                          }
                          onClick={() =>
                            onRemoveImage?.(
                              image.id
                            )
                          }
                          aria-label="Elimină fotografia"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  }
                )}
              </div>
            )}

            <div
              className={styles.buttonGroup}
            >
              {safeImages.length > 0 && (
                <button
                  type="button"
                  className={
                    styles.primaryButton
                  }
                  disabled={analyzing}
                  onClick={onAnalyzeGroups}
                >
                  Identifică produsele cu
                  AI
                </button>
              )}

              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                onClick={onUpload}
              >
                Alege fotografii
              </button>

              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                onClick={onCapturePhoto}
              >
                Fă poze
              </button>

              <button
                type="button"
                className={
                  styles.headerButton
                }
                onClick={onBack}
              >
                Anulează
              </button>

              {safeImages.length > 0 && (
                <button
                  type="button"
                  className={
                    styles.headerButton
                  }
                  onClick={onResetBatch}
                >
                  Șterge tot și începe
                  din nou
                </button>
              )}
            </div>
          </>
        )}

        {step === "analysis" && (
          <>
            <div className={styles.progress}>
              Pasul 2 din 3
            </div>

            <h3 className={styles.title}>
              AI-ul identifică produsele
            </h3>

            <p className={styles.text}>
              Comparăm fotografiile și
              pregătim câte un grup pentru
              fiecare produs posibil.
            </p>

            {progress && (
              <>
                <div
                  className={
                    styles.progressBarTrack
                  }
                >
                  <div
                    className={
                      styles.progressBarFill
                    }
                    style={{
                      width: progress.total
                        ? `${Math.round(
                            (progress.done /
                              progress.total) *
                              100
                          )}%`
                        : "0%",
                    }}
                  />
                </div>

                <span
                  className={
                    styles.progressLabel
                  }
                >
                  Lot {Math.min(
                    progress.done + 1,
                    progress.total
                  )}{" "}
                  din {progress.total}
                </span>
              </>
            )}

            <div className={styles.card}>
              <strong>Se analizează:</strong>

              <ul
                className={styles.infoList}
              >
                <li>
                  obiectul principal din
                  fotografie;
                </li>
                <li>
                  forma, culoarea și
                  materialele;
                </li>
                <li>
                  unghiurile diferite ale
                  aceluiași produs;
                </li>
                <li>
                  diferențele dintre produse
                  asemănătoare.
                </li>
              </ul>
            </div>
          </>
        )}

        {step === "groups" && (
          <>
            <div className={styles.progress}>
              Pasul 2 din 3
            </div>

            <h3 className={styles.title}>
              {safeGroups.length === 1
                ? "AI-ul a detectat 1 produs"
                : `AI-ul a detectat ${safeGroups.length} produse`}
            </h3>

            <p className={styles.text}>
              Verifică dacă fotografiile au
              fost grupate corect. Poți muta
              poze între produse, separa sau
              combina grupuri, ori elimina o
              fotografie.
            </p>

            {!safeGroups.length && (
              <div
                className={styles.emptyState}
              >
                Nu există încă grupuri.
                Întoarce-te la fotografii.
              </div>
            )}

            {safeGroups.map((group) => {
              const otherGroups =
                safeGroups.filter(
                  (other) =>
                    other.id !== group.id
                );

              return (
                <GroupCard
                  key={group.id}
                  group={group}
                  otherGroups={otherGroups}
                  selectedImageIds={
                    selectionByGroup[
                      group.id
                    ] || new Set()
                  }
                  onToggleSelect={(
                    imageId
                  ) =>
                    toggleSelect(
                      group.id,
                      imageId
                    )
                  }
                  moveTarget={
                    moveTargetByGroup[
                      group.id
                    ]
                  }
                  onChooseMoveTarget={(
                    value
                  ) =>
                    setMoveTargetByGroup(
                      (current) => ({
                        ...current,
                        [group.id]: value,
                      })
                    )
                  }
                  onConfirmMove={() =>
                    handleConfirmMove(
                      group.id
                    )
                  }
                  mergeTarget={
                    mergeTargetByGroup[
                      group.id
                    ]
                  }
                  onChooseMergeTarget={(
                    value
                  ) =>
                    setMergeTargetByGroup(
                      (current) => ({
                        ...current,
                        [group.id]: value,
                      })
                    )
                  }
                  onConfirmMerge={() =>
                    handleConfirmMerge(
                      group.id,
                      otherGroups
                    )
                  }
                  onSetGroupTitle={(
                    title
                  ) =>
                    onSetGroupTitle?.(
                      group.id,
                      title
                    )
                  }
                  onSetPrimaryImage={(
                    imageId
                  ) =>
                    onSetPrimaryImage?.(
                      group.id,
                      imageId
                    )
                  }
                  onRemoveImage={(
                    imageId
                  ) =>
                    onRemoveImage?.(
                      imageId
                    )
                  }
                  onRemoveGroup={() =>
                    onRemoveGroup?.(
                      group.id
                    )
                  }
                />
              );
            })}

            <div
              className={styles.buttonGroup}
            >
              <button
                type="button"
                className={
                  styles.primaryButton
                }
                disabled={
                  !safeGroups.length ||
                  analyzing
                }
                onClick={() =>
                  onAnalyzeGroupProducts?.()
                }
              >
                {analyzing &&
                progress?.phase ===
                  "analyzing"
                  ? `Pregătim produsul ${Math.min(
                      progress.done + 1,
                      progress.total
                    )} din ${
                      progress.total
                    }...`
                  : "Continuă cu produsele identificate"}
              </button>

              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                disabled={analyzing}
                onClick={() =>
                  goToStep("images")
                }
              >
                Înapoi la fotografii
              </button>
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <div className={styles.progress}>
              Pasul 3 din 3
            </div>

            <h3 className={styles.title}>
              {safeGroups.length}{" "}
              {safeGroups.length === 1
                ? "produs detectat"
                : "produse detectate"}
            </h3>

            <div
              className={styles.summaryBar}
            >
              <span
                className={
                  styles.summaryBarText
                }
              >
                {reviewSummary.readyCount}{" "}
                {reviewSummary.readyCount ===
                1
                  ? "pregătit"
                  : "pregătite"}

                {reviewSummary.incompleteCount >
                  0 &&
                  ` · ${reviewSummary.incompleteCount} mai ${
                    reviewSummary.incompleteCount ===
                    1
                      ? "are"
                      : "au"
                  } de completat`}

                {reviewSummary.analysisFailedCount >
                  0 &&
                  ` · ${reviewSummary.analysisFailedCount} ${
                    reviewSummary.analysisFailedCount ===
                    1
                      ? "a eșuat"
                      : "au eșuat"
                  }`}

                {reviewSummary.publishedCount >
                  0 &&
                  ` · ${reviewSummary.publishedCount} ${
                    reviewSummary.publishedCount ===
                    1
                      ? "publicat"
                      : "publicate"
                  }`}
              </span>
            </div>

            {bulkPublishSummary && (
              <div
                className={
                  styles.successCard
                }
              >
                <strong>
                  {
                    bulkPublishSummary.publishedCount
                  }{" "}
                  {bulkPublishSummary.publishedCount ===
                  1
                    ? "produs a fost publicat"
                    : "produse au fost publicate"}
                </strong>

                {bulkPublishSummary.pendingCount >
                  0 && (
                  <p
                    className={
                      styles.reviewCardMeta
                    }
                  >
                    {
                      bulkPublishSummary.pendingCount
                    }{" "}
                    {bulkPublishSummary.pendingCount ===
                    1
                      ? "produs mai are nevoie de modificări"
                      : "produse mai au nevoie de modificări"}
                  </p>
                )}

                <div
                  className={
                    styles.buttonGroup
                  }
                >
                  <button
                    type="button"
                    className={
                      styles.secondaryButton
                    }
                    onClick={
                      onDismissBulkSummary
                    }
                  >
                    Continuă editarea
                  </button>
                </div>
              </div>
            )}

            {safeGroups.map((group) => (
              <ProductReviewCard
                key={group.id}
                group={group}
                onEdit={() =>
                  onEditGroup?.(group.id)
                }
                onRemove={() =>
                  onRemoveGroup?.(group.id)
                }
                onRetryAnalysis={() =>
                  onAnalyzeGroupProducts?.(
                    [group.id]
                  )
                }
                onPublish={() =>
                  onPublishGroup?.(group.id)
                }
                onPreview={() =>
                  setPreviewGroupId(
                    group.id
                  )
                }
              />
            ))}

            <div
              className={styles.buttonGroup}
            >
              <button
                type="button"
                className={
                  styles.primaryButton
                }
                disabled={
                  bulkPublishing ||
                  !readyGroupIds.size
                }
                onClick={
                  onPublishReadyGroups
                }
              >
                {bulkPublishing
                  ? "Se publică..."
                  : readyGroupIds.size
                    ? `Publică produsele pregătite (${readyGroupIds.size})`
                    : "Publică produsele pregătite"}
              </button>

              <button
                type="button"
                className={
                  styles.secondaryButton
                }
                disabled={bulkPublishing}
                onClick={() =>
                  goToStep("groups")
                }
              >
                Înapoi la grupare
              </button>
            </div>

            {previewGroup && (
              <ProductClientPreviewModal
                open
                onClose={() =>
                  setPreviewGroupId(null)
                }
                form={
                  previewGroup.productDraft ||
                  {}
                }
                resolveProductImageUrl={
                  getImageUrl
                }
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
