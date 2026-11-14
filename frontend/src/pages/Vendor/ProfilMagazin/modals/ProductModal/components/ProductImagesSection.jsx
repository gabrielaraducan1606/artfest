import { useState } from "react";

import styles from "../../../components/css/ProductModal.module.css";
import localStyles from "./ProductImagesSection.module.css";
import ProductVideoField from "../../../../../../components/ProductVideoField";
import ProductPhotoUploader from "../../../../../../components/ProductPhotoUploader/ProductPhotoUploader.jsx";
import {
  AI_IMAGE_EDITING_ENABLED,
  AI_IMAGE_EDITING_UNAVAILABLE_MESSAGE,
} from "../../../../../../config/features.js";

/*
 * Editarea foto cu AI e oprită temporar (config/features.js): butoanele
 * rămân vizibile, dar disabled + aria-disabled și fără onClick.
 * Încărcarea, ștergerea, reordonarea și „Completează detalii” nu depind de flag.
 */
const imageEditingOff = !AI_IMAGE_EDITING_ENABLED;

export default function ProductImagesSection({
  form,
  setForm,
  aiImagePreview,
  aiImageLoading,
  aiImageTargetIndex,
  aiLoading,
  allImagesReadyForAi,
  mainImageReadyForAi,
  isUploadedImage,
  resolveProductImageUrl,
  onPasteImages,
  handleAiAnalyze,
  handleAiEnhanceImage,
  useAiImage,
  discardAiImagePreview,
  photos, // coada comună: { queue, state } (useProductEditorController)
}) {
  /*
   * Poza-sursă a preview-ului AI curent (pentru comparație
   * original/rezultat) - `aiImageTargetIndex` e `null` doar dacă
   * previzualizarea a pornit înainte de acest fix (state vechi,
   * imposibil practic după redeploy) sau dacă poza-sursă a fost
   * ștearsă între timp; în ambele cazuri, index 0 e fallback-ul
   * rezonabil, IDENTIC cu comportamentul dinainte de fix.
   */
  const aiPreviewSourceIndex =
    aiImageTargetIndex ?? 0;

  const aiPreviewSourceUrl =
    form.images?.[
      aiPreviewSourceIndex
    ];

  /*
   * Butonul AI per fotografie (în cardul din selectorul comun) - doar pentru
   * fotografiile deja încărcate; indexul e cel din form.images (ținta AI).
   */
  const renderAiPhotoAction = (item) => {
    if (item.status !== "done" || !item.url) return null;
    const idx = (form.images || []).indexOf(item.url);
    if (idx < 0) return null;
    const processingThis = aiImageLoading && aiImageTargetIndex === idx;
    return (
      <div className={localStyles.photoAiRow}>
        <button
          type="button"
          onClick={imageEditingOff ? undefined : () => handleAiEnhanceImage(idx)}
          disabled={imageEditingOff || aiImageLoading || !isUploadedImage?.(item.url)}
          aria-disabled={imageEditingOff || undefined}
          title={
            imageEditingOff
              ? `Îmbunătățește fotografia - ${AI_IMAGE_EDITING_UNAVAILABLE_MESSAGE.toLowerCase()}`
              : "Fotografie profesională - îmbunătățește fundalul, lumina și claritatea acestei poze, fără să modifice produsul"
          }
          aria-label={
            imageEditingOff
              ? `Îmbunătățește fotografia ${idx + 1} cu AI - ${AI_IMAGE_EDITING_UNAVAILABLE_MESSAGE.toLowerCase()}`
              : `Îmbunătățește fotografia ${idx + 1} cu AI`
          }
          className={`${localStyles.photoAiBtn} ${imageEditingOff ? localStyles.aiEditUnavailable : ""}`}
        >
          ✨ Îmbunătățește cu AI
        </button>
        {processingThis ? (
          <span className={localStyles.photoAiBusy} role="status">
            Retușez fotografia…
          </span>
        ) : null}
      </div>
    );
  };

  const [
    imagesHelpOpen,
    setImagesHelpOpen,
  ] = useState(false);

  return (
    <>
      {imagesHelpOpen && (
        <div
          className={
            styles.helpOverlay
          }
        >
          <div
            className={
              styles.helpModal
            }
          >
            <button
              type="button"
              className={
                styles.helpModalClose
              }
              onClick={() =>
                setImagesHelpOpen(false)
              }
              aria-label="Închide ajutorul"
            >
              ×
            </button>

            <h3>
              Cum folosești pozele produsului?
            </h3>

            <p>
              Adaugă fotografiile produsului și,
              opțional, folosește funcțiile AI
              pentru analiză și îmbunătățirea
              fotografiilor.
            </p>

            <div
              className={
                styles.helpSteps
              }
            >
              <div>
                <strong>
                  📷 Adaugă fotografii
                </strong>

                <p>
                  Poți face o fotografie direct
                  cu camera sau poți selecta una
                  sau mai multe imagini din
                  galerie.
                </p>
              </div>

              <div>
                <strong>
                  ★ Alege imaginea principală
                </strong>

                <p>
                  Prima fotografie este imaginea
                  principală a produsului.
                </p>

                <p>
                  Pentru a schimba imaginea
                  principală, apasă pe ☆ sub
                  fotografia dorită. Imaginea
                  principală este marcată cu ★.
                </p>
              </div>

              <div>
                <strong>
                  ✨ Completează detalii cu AI
                </strong>

                <p>
                  După încărcarea fotografiilor,
                  apasă pe „Completează detalii”.
                  AI-ul folosește fotografiile
                  produsului pentru a completa
                  automat titlul, descrierea,
                  categoria, materialul, tehnica,
                  culoarea și alte informații.
                </p>

                <p>
                  După analiză vei ajunge la
                  pasul „Detalii”, unde poți
                  verifica și modifica
                  informațiile generate.
                </p>
              </div>

              <div>
                <strong>
                  📸 Îmbunătățește fotografia
                </strong>

                {imageEditingOff && (
                  <p>
                    <em>
                      {
                        AI_IMAGE_EDITING_UNAVAILABLE_MESSAGE
                      }
                      .
                    </em>
                  </p>
                )}

                <p>
                  Retușează fundalul, lumina și
                  claritatea unei fotografii, fără
                  să modifice produsul din ea
                  (formă, culoare, textură, text
                  sau logo rămân neschimbate).
                </p>

                <p>
                  Apasă „✨” de sub fotografia pe
                  care vrei să o îmbunătățești -
                  poate fi oricare, nu doar cea
                  principală (★).
                </p>

                <p>
                  După generare vezi originalul
                  și rezultatul unul lângă altul
                  și alegi: „Folosește varianta
                  îmbunătățită”, „Păstrează
                  originalul” sau „Încearcă din
                  nou”. Nimic nu se schimbă până
                  nu confirmi tu.
                </p>
              </div>
            </div>

            <div
              className={
                styles.tip
              }
            >
              <strong>
                Important:
              </strong>{" "}
              AI-ul este un ajutor. Verifică
              întotdeauna imaginile și
              informațiile generate înainte de
              publicarea produsului.
            </div>

            <div
              className={
                styles.helpModalActions
              }
            >
              <button
                type="button"
                className={
                  styles.primaryBtn
                }
                onClick={() =>
                  setImagesHelpOpen(false)
                }
              >
                Am înțeles
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={
          styles.sectionHeader
        }
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <h4
            className={
              styles.sectionTitle
            }
          >
            Pozele produsului
          </h4>

          <button
            type="button"
            className={
              styles.helpButton
            }
            onClick={() =>
              setImagesHelpOpen(true)
            }
            aria-label="Ajutor poze produs"
            title="Cum folosesc pozele și AI?"
          >
            ?
          </button>
        </div>

        <p
          className={
            styles.sectionDescription
          }
        >
          Adaugă fotografiile produsului și,
          opțional, folosește AI pentru analiză
          sau pentru a îmbunătăți o fotografie.
        </p>
      </div>

      {/* =====================================================
          PREVIZUALIZARE AI: ORIGINAL vs REZULTAT
          Nimic din form.images nu se schimbă până la confirmare
          explicită (✅ mai jos) - regulă neschimbată.
      ===================================================== */}

      {aiImagePreview && (
        <div
          className={
            localStyles.previewPanel
          }
        >
          <p
            className={
              localStyles.previewHeader
            }
          >
            Fotografie profesională - previzualizare
          </p>

          <p
            className={
              localStyles.previewSubtitle
            }
          >
            Produsul rămâne identic - s-au
            îmbunătățit doar fundalul, lumina și
            claritatea. Alege ce variantă
            păstrezi.
          </p>

          <div
            className={
              localStyles.previewGrid
            }
          >
            <div
              className={
                localStyles.previewColumn
              }
            >
              <span
                className={`${localStyles.previewColumnLabel} ${localStyles.previewColumnLabelOriginal}`}
              >
                Original
              </span>

              {aiPreviewSourceUrl && (
                <img
                  src={resolveProductImageUrl(
                    aiPreviewSourceUrl
                  )}
                  alt="Fotografia originală"
                  className={
                    localStyles.previewImage
                  }
                />
              )}
            </div>

            <div
              className={
                localStyles.previewColumn
              }
            >
              <span
                className={`${localStyles.previewColumnLabel} ${localStyles.previewColumnLabelResult}`}
              >
                Îmbunătățit
              </span>

              <img
                src={
                  aiImagePreview
                }
                alt="Fotografie îmbunătățită cu AI"
                className={`${localStyles.previewImage} ${localStyles.previewImageResult}`}
              />
            </div>
          </div>

          <div
            className={
              localStyles.previewActions
            }
          >
            <button
              type="button"
              onClick={
                useAiImage
              }
              className={`${localStyles.previewButton} ${localStyles.previewButtonPrimary}`}
            >
              ✅ Folosește varianta îmbunătățită
            </button>

            <button
              type="button"
              onClick={
                discardAiImagePreview
              }
              className={`${localStyles.previewButton} ${localStyles.previewButtonSecondary}`}
            >
              Păstrează originalul
            </button>

            <button
              type="button"
              onClick={
                imageEditingOff
                  ? undefined
                  : () =>
                      handleAiEnhanceImage(
                        aiPreviewSourceIndex
                      )
              }
              disabled={
                imageEditingOff ||
                aiImageLoading
              }
              aria-disabled={
                imageEditingOff ||
                undefined
              }
              className={`${localStyles.previewButton} ${localStyles.previewButtonGhost}`}
            >
              {aiImageLoading
                ? "Se generează..."
                : "🔁 Încearcă din nou"}
            </button>
          </div>
        </div>
      )}

      <div
        className={
          styles.imagesRow
        }
        onPaste={
          onPasteImages
        }
      >
        {/*
          Selectorul COMUN de fotografii (același ca în Smart Listing):
          mai multe deodată din galerie sau cameră, adăugate la cele
          existente, fără duplicate, progres per fotografie, „Reîncearcă”,
          ordine (săgeți - merge și pe telefon) și fotografia principală.
        */}
        <ProductPhotoUploader
          queue={photos.queue}
          state={photos.state}
          resolveUrl={resolveProductImageUrl}
          idPrefix="product-photos"
          renderItemExtra={renderAiPhotoAction}
        />

        {!!form.images
          ?.length && (
          <>

            {/* =============================================
                CELE DOUĂ FUNCȚII AI - separate vizual, ca să
                nu pară că fac același lucru.
            ============================================= */}

            <div
              className={
                localStyles.aiCardsGrid
              }
            >
              <div
                className={`${localStyles.aiCard} ${localStyles.aiCardDetails}`}
              >
                <div
                  className={
                    localStyles.aiCardTop
                  }
                >
                  <span
                    className={
                      localStyles.aiCardIcon
                    }
                    aria-hidden="true"
                  >
                    ✨
                  </span>

                  <p
                    className={
                      localStyles.aiCardTitle
                    }
                  >
                    Completează detalii cu AI
                  </p>
                </div>

                <p
                  className={
                    localStyles.aiCardDescription
                  }
                >
                  AI analizează fotografiile și
                  completează automat titlul,
                  descrierea, categoria și
                  celelalte informații ale
                  produsului.
                </p>

                <button
                  type="button"
                  onClick={
                    handleAiAnalyze
                  }
                  disabled={
                    aiLoading ||
                    !allImagesReadyForAi
                  }
                  className={`${localStyles.aiCardButton} ${localStyles.aiCardButtonDetails}`}
                >
                  {aiLoading
                    ? "Completez..."
                    : !allImagesReadyForAi
                    ? "Se încarcă imaginile..."
                    : "Completează detalii"}
                </button>
              </div>

              <div
                className={`${localStyles.aiCard} ${
                  imageEditingOff
                    ? localStyles.aiCardUnavailable
                    : localStyles.aiCardPhoto
                }`}
              >
                <div
                  className={
                    localStyles.aiCardTop
                  }
                >
                  <span
                    className={
                      localStyles.aiCardIcon
                    }
                    aria-hidden="true"
                  >
                    📸
                  </span>

                  <p
                    className={
                      localStyles.aiCardTitle
                    }
                  >
                    Îmbunătățește fotografia
                  </p>
                </div>

                <p
                  className={
                    localStyles.aiCardDescription
                  }
                >
                  Retușează fundalul, lumina și
                  claritatea fotografiei
                  principale (★), fără să
                  modifice produsul. Pentru alte
                  fotografii, apasă „✨” de sub
                  poza dorită.
                </p>

                {imageEditingOff ? (
                  <>
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      aria-describedby="ai-image-edit-unavailable"
                      className={`${localStyles.aiCardButton} ${localStyles.aiCardButtonUnavailable}`}
                    >
                      <span aria-hidden="true">
                        📸
                      </span>{" "}
                      Îmbunătățește fotografia
                    </button>

                    <p
                      id="ai-image-edit-unavailable"
                      className={
                        localStyles.aiUnavailableNote
                      }
                    >
                      {
                        AI_IMAGE_EDITING_UNAVAILABLE_MESSAGE
                      }
                    </p>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      handleAiEnhanceImage(
                        0
                      )
                    }
                    disabled={
                      aiImageLoading ||
                      !mainImageReadyForAi
                    }
                    className={`${localStyles.aiCardButton} ${localStyles.aiCardButtonPhoto}`}
                  >
                    {aiImageLoading
                      ? "Retușez fotografia..."
                      : !mainImageReadyForAi
                      ? "Se încarcă imaginea..."
                      : "Îmbunătățește fotografia"}
                  </button>
                )}
              </div>
            </div>

            {!imageEditingOff && (
              <p
                className={
                  localStyles.aiReassurance
                }
              >
                AI îmbunătățește doar fundalul și
                calitatea fotografiei. Produsul
                rămâne neschimbat.
              </p>
            )}
          </>
        )}

        <div
          className={
            styles.tip
          }
        >
          Prima fotografie este imaginea principală
          a produsului. Schimbi ordinea cu săgețile
          sau cu butonul „Principală”.
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <ProductVideoField
          videoUrl={form.videoUrl || null}
          videoMuted={!!form.videoMuted}
          onChange={(url) =>
            setForm?.((current) => ({
              ...current,
              videoUrl: url,
            }))
          }
          onMutedChange={(muted) =>
            setForm?.((current) => ({
              ...current,
              videoMuted: muted,
            }))
          }
        />
      </div>
    </>
  );
}
