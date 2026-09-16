import { useState } from "react";

import styles from "../../../components/css/ProductModal.module.css";
import localStyles from "./ProductImagesSection.module.css";
import ProductVideoField from "../../../../../../components/ProductVideoField";

export default function ProductImagesSection({
  form,
  setForm,
  aiImagePreview,
  aiImageLoading,
  aiImageTargetIndex,
  aiLoading,
  uploadInfo,
  allImagesReadyForAi,
  mainImageReadyForAi,
  isUploadedImage,
  resolveProductImageUrl,
  onPasteImages,
  onFilesPicked,
  onDragStart,
  onDragOver,
  onDrop,
  setMainImage,
  removeImage,
  handleAiAnalyze,
  handleAiEnhanceImage,
  useAiImage,
  discardAiImagePreview,
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
              onClick={() =>
                handleAiEnhanceImage(
                  aiPreviewSourceIndex
                )
              }
              disabled={
                aiImageLoading
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
        <div
          className={
            styles.fileUploadWrapper
          }
        >
          <input
            id="product-camera-input"
            type="file"
            accept="image/*,.jpg,.jpeg,.jfif,.png,.webp,.gif,.heic,.heif,.bmp,.tif,.tiff,.avif"
            capture="environment"
            className={
              styles.fileInputHidden
            }
            onChange={async (
              e
            ) => {
              const files =
                Array.from(
                  e.target.files ||
                    []
                );

              e.target.value =
                "";

              await onFilesPicked(
                files
              );
            }}
          />

          <input
            id="product-gallery-input"
            type="file"
            accept="image/*,.jpg,.jpeg,.jfif,.png,.webp,.gif,.heic,.heif,.bmp,.tif,.tiff,.avif"
            multiple
            className={
              styles.fileInputHidden
            }
            onChange={async (
              e
            ) => {
              const files =
                Array.from(
                  e.target.files ||
                    []
                );

              e.target.value =
                "";

              await onFilesPicked(
                files
              );
            }}
          />

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap:
                "wrap",
            }}
          >
            <label
              htmlFor="product-camera-input"
              className={
                styles.fileUploadButton
              }
            >
              📷 Fă poză
            </label>

            <label
              htmlFor="product-gallery-input"
              className={
                styles.fileUploadButton
              }
            >
              🖼️ Alege din galerie
            </label>
          </div>

          <span
            className={
              styles.fileUploadInfo
            }
          >
            {uploadInfo}
          </span>
        </div>

        {!!form.images
          ?.length && (
          <>
            <div
              className={
                styles.thumbGrid
              }
            >
              {form.images.map(
                (
                  img,
                  idx
                ) => {
                  const isMain =
                    idx === 0;

                  const isProcessingThis =
                    aiImageLoading &&
                    aiImageTargetIndex ===
                      idx;

                  return (
                    <div
                      key={`${img}-${idx}`}
                      className={
                        styles.thumbItem
                      }
                      draggable
                      onDragStart={
                        onDragStart(
                          idx
                        )
                      }
                      onDragOver={
                        onDragOver
                      }
                      onDrop={
                        onDrop(
                          idx
                        )
                      }
                      title={
                        isMain
                          ? "Imagine principală"
                          : "Trage pentru a reordona"
                      }
                    >
                      <div
                        className={
                          localStyles.thumbImageWrap
                        }
                      >
                        {isMain && (
                          <span
                            className={
                              localStyles.mainBadge
                            }
                          >
                            Principală
                          </span>
                        )}

                        <img
                          src={
                            resolveProductImageUrl(
                              img
                            )
                          }
                          alt={`Imagine produs ${
                            idx +
                            1
                          }`}
                          className={
                            styles.thumbImg
                          }
                        />

                        {isProcessingThis && (
                          <div
                            className={
                              localStyles.thumbLoadingOverlay
                            }
                          >
                            <div
                              className={
                                localStyles.spinner
                              }
                              aria-hidden="true"
                            />

                            <span
                              className={
                                localStyles.thumbLoadingText
                              }
                            >
                              Retușez
                              fotografia…
                            </span>
                          </div>
                        )}
                      </div>

                      <div
                        className={
                          localStyles.thumbControls
                        }
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setMainImage(
                              idx
                            )
                          }
                          title={
                            isMain
                              ? "Imagine principală"
                              : "Setează ca imagine principală"
                          }
                          className={`${localStyles.thumbControlBtn} ${
                            isMain
                              ? localStyles.thumbControlMain
                              : ""
                          }`}
                        >
                          {isMain
                            ? "★"
                            : "☆"}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            handleAiEnhanceImage(
                              idx
                            )
                          }
                          disabled={
                            aiImageLoading ||
                            !isUploadedImage?.(
                              img
                            )
                          }
                          title="Fotografie profesională - îmbunătățește fundalul, lumina și claritatea acestei poze, fără să modifice produsul"
                          aria-label="Îmbunătățește această fotografie cu AI"
                          className={
                            localStyles.thumbControlBtn
                          }
                        >
                          ✨
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            removeImage(
                              idx
                            )
                          }
                          title="Șterge fotografia"
                          aria-label="Șterge fotografia"
                          className={`${localStyles.thumbControlBtn} ${localStyles.thumbControlDanger}`}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </div>

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
                className={`${localStyles.aiCard} ${localStyles.aiCardPhoto}`}
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
              </div>
            </div>

            <p
              className={
                localStyles.aiReassurance
              }
            >
              AI îmbunătățește doar fundalul și
              calitatea fotografiei. Produsul
              rămâne neschimbat.
            </p>
          </>
        )}

        <div
          className={
            styles.tip
          }
        >
          Trage o fotografie pentru a schimba
          ordinea. Prima fotografie (★) este
          imaginea principală a produsului.
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
