import { useState } from "react";

import styles from "../../../components/css/ProductModal.module.css";

export default function ProductImagesSection({
  form,
  aiImagePreview,
  aiImageLoading,
  aiLoading,
  uploadInfo,
  allImagesReadyForAi,
  mainImageReadyForAi,
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
}) {
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
              imaginii principale.
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
                  ✨ Analizează produsul cu AI
                </strong>

                <p>
                  După încărcarea fotografiilor,
                  poți apăsa pe „Analizează
                  produsul cu AI”.
                </p>

                <p>
                  AI-ul analizează imaginile și
                  încearcă să completeze automat
                  informații precum titlul,
                  descrierea, categoria,
                  materialul, tehnica și culoarea
                  produsului.
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
                  📸 Editează poza cu AI
                </strong>

                <p>
                  Funcția folosește imaginea
                  principală marcată cu ★ și
                  generează o versiune editată.
                </p>

                <p>
                  Poți alege „Folosește poza
                  asta” sau poți genera o altă
                  variantă.
                </p>

                <p>
                  Imaginea generată nu este
                  folosită automat până când nu
                  confirmi tu acest lucru.
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
          sau îmbunătățirea imaginii principale.
        </p>
      </div>

      {aiImagePreview && (
        <div
          style={{
            marginBottom: 14,
          }}
        >
          <label
            className={
              styles.label
            }
          >
            Poză editată cu AI
          </label>

          <img
            src={
              aiImagePreview
            }
            alt="Poză editată cu AI"
            style={{
              width: "100%",
              maxWidth: 350,
              borderRadius: 12,
              display: "block",
              margin:
                "0 auto 12px",
            }}
          />

          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent:
                "center",
              alignItems:
                "center",
              flexWrap:
                "wrap",
            }}
          >
            <button
              type="button"
              onClick={
                useAiImage
              }
              className={
                styles.primaryBtn
              }
              style={{
                width: "auto",
                whiteSpace:
                  "nowrap",
                flex:
                  "1 1 220px",
                maxWidth: 260,
              }}
            >
              ✅ Folosește poza asta
            </button>

            <button
              type="button"
              onClick={
                handleAiEnhanceImage
              }
              disabled={
                aiImageLoading
              }
              className={
                styles.smallBtn
              }
              style={{
                whiteSpace:
                  "nowrap",
                flex:
                  "1 1 220px",
                maxWidth: 260,
              }}
            >
              {aiImageLoading
                ? "Generez..."
                : "🔁 Generează altă variantă"}
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
                ) => (
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
                      idx ===
                      0
                        ? "Imagine principală"
                        : "Trage pentru a reordona"
                    }
                  >
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

                    <div
                      style={{
                        display:
                          "flex",
                        gap: 6,
                        marginTop:
                          6,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setMainImage(
                            idx
                          )
                        }
                        title={
                          idx ===
                          0
                            ? "Imagine principală folosită de AI"
                            : "Setează ca imagine principală"
                        }
                        className={
                          styles.smallBtn
                        }
                        style={{
                          fontWeight:
                            idx ===
                            0
                              ? 800
                              : 500,
                        }}
                      >
                        {idx ===
                        0
                          ? "★"
                          : "☆"}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          removeImage(
                            idx
                          )
                        }
                        title="Șterge imagine"
                        className={
                          styles.smallBtn
                        }
                      >
                        Șterge
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>

            <div
              className={
                styles.aiActions
              }
            >
              <button
                type="button"
                onClick={
                  handleAiAnalyze
                }
                disabled={
                  aiLoading ||
                  !allImagesReadyForAi
                }
                className={
                  styles.primaryBtn
                }
              >
                {aiLoading
                  ? "Analizez produsul..."
                  : !allImagesReadyForAi
                  ? "Se încarcă imaginile..."
                  : "✨ Analizează produsul cu AI"}
              </button>

              <button
                type="button"
                onClick={
                  handleAiEnhanceImage
                }
                disabled={
                  aiImageLoading ||
                  !mainImageReadyForAi
                }
                className={
                  styles.smallBtn
                }
              >
                {aiImageLoading
                  ? "Editez poza..."
                  : !mainImageReadyForAi
                  ? "Se încarcă imaginea..."
                  : "📸 Editează poza cu AI"}
              </button>
            </div>
          </>
        )}

        <div
          className={
            styles.tip
          }
        >
          AI folosește poza marcată cu ★.
          Încarcă pozele, apoi poți analiza
          produsul sau edita fotografia
          principală cu AI.
        </div>
      </div>
    </>
  );
}