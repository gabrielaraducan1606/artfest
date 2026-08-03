// PolicyGate.jsx

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { createPortal } from "react-dom";

import styles from "./PolicyGate.module.css";

export default function PolicyGate({
  scope,
  isOpen,
  onClose,
  onStatusChange,
  closeOnOverlay = false,
  closeOnEsc = false,
}) {
  const [loading, setLoading] =
    useState(false);

  const [submitting, setSubmitting] =
    useState(false);

  const [err, setErr] =
    useState("");

  const [payload, setPayload] =
    useState(null);

  const blocked = useMemo(() => {
    if (!payload?.requiresAction) {
      return false;
    }

    return (
      payload.documents || []
    ).some(
      (document) =>
        document.required &&
        !document.alreadyAccepted
    );
  }, [payload]);

  const shouldRender = isOpen;

  useEffect(() => {
    onStatusChange?.(blocked);
  }, [
    blocked,
    onStatusChange,
  ]);

  const fetchGate = useCallback(
    async () => {
      if (!scope) {
        return null;
      }

      setLoading(true);
      setErr("");

      try {
        const response = await fetch(
          `/api/policy-gate?scope=${encodeURIComponent(
            scope
          )}`,
          {
            credentials: "include",
          }
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          console.error(
            "POLICY GATE ERROR DATA:",
            data
          );

          throw new Error(
            data?.error ||
              "gate_fetch_failed"
          );
        }

        /*
         * Există o notificare activă.
         */
        if (data?.notification) {
          setPayload({
            ...data,

            documents: Array.isArray(
              data.documents
            )
              ? data.documents
              : [],
          });

          return data;
        }

        /*
         * Nu mai există notificare activă.
         * Înseamnă că a fost arhivată sau nu este
         * necesară nicio acțiune.
         */
        setPayload(null);
        onStatusChange?.(false);
        onClose?.();

        return data;
      } catch (error) {
        console.error(
          "PolicyGate fetch error:",
          error
        );

        setErr(
          error?.message ||
            "Nu am putut încărca informarea de politici."
        );

        setPayload(null);

        return null;
      } finally {
        setLoading(false);
      }
    },
    [
      scope,
      onClose,
      onStatusChange,
    ]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    fetchGate();
  }, [
    isOpen,
    fetchGate,
  ]);

  useEffect(() => {
    if (
      !shouldRender ||
      !closeOnEsc
    ) {
      return undefined;
    }

    const handleKeyDown = (
      event
    ) => {
      if (
        event.key === "Escape" &&
        !blocked
      ) {
        onClose?.();
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [
    shouldRender,
    closeOnEsc,
    blocked,
    onClose,
  ]);

  const handleAcceptAll =
    async () => {
      if (
        submitting ||
        loading
      ) {
        return;
      }

      setSubmitting(true);
      setErr("");

      try {
        const pendingRequired = (
          payload?.documents || []
        ).filter(
          (document) =>
            document.required &&
            !document.alreadyAccepted
        );

        /*
         * Dacă nu mai există documente obligatorii
         * neacceptate, reîncărcăm starea porții.
         */
        if (
          !pendingRequired.length
        ) {
          await fetchGate();
          return;
        }

        const response = await fetch(
          "/api/policy-gate/accept",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            credentials: "include",

            body: JSON.stringify({
              scope,

              notificationId:
                payload?.notification
                  ?.id || null,

              documents:
                pendingRequired.map(
                  (document) =>
                    document.key
                ),
            }),
          }
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          console.error(
            "POLICY GATE ACCEPT ERROR DATA:",
            data
          );

          const missingDocuments =
            Array.isArray(
              data?.missingDocuments
            )
              ? ` Documente lipsă: ${data.missingDocuments.join(
                  ", "
                )}.`
              : "";

          const invalidDocuments =
            Array.isArray(
              data?.invalidDocuments
            )
              ? ` Documente invalide: ${data.invalidDocuments.join(
                  ", "
                )}.`
              : "";

          throw new Error(
            `${
              data?.error ||
              "accept_failed"
            }.${missingDocuments}${invalidDocuments}`
          );
        }

        /*
         * Backendul confirmă că toate documentele
         * obligatorii au fost acceptate și notificarea
         * poate fi închisă.
         */
        if (
          data?.gateClosed ===
          true
        ) {
          setPayload(null);
          onStatusChange?.(
            false
          );
          onClose?.();

          return;
        }

        /*
         * Dacă mai există documente obligatorii,
         * reîncărcăm starea reală a porții.
         */
        await fetchGate();
      } catch (error) {
        console.error(
          "PolicyGate accept error:",
          error
        );

        setErr(
          error?.message ||
            "Eroare la acceptare. Încearcă din nou."
        );
      } finally {
        setSubmitting(false);
      }
    };

  if (!shouldRender) {
    return null;
  }

  if (
    typeof document ===
    "undefined"
  ) {
    return null;
  }

  const modal = (
    <div
      className={
        styles.overlay
      }
      onMouseDown={(event) => {
        if (
          !closeOnOverlay ||
          blocked
        ) {
          return;
        }

        if (
          event.target ===
          event.currentTarget
        ) {
          onClose?.();
        }
      }}
      role="presentation"
    >
      <section
        className={
          styles.modal
        }
        role="dialog"
        aria-modal="true"
        aria-label="Actualizare documente legale"
      >
        <header
          className={
            styles.header
          }
        >
          <div
            className={
              styles.headerText
            }
          >
            <div
              className={
                styles.title
              }
            >
              {loading
                ? "Se încarcă…"
                : payload
                    ?.notification
                    ?.title ||
                  "Actualizare documente"}
            </div>

            {!loading ? (
              <div
                className={
                  styles.message
                }
              >
                {payload
                  ?.notification
                  ?.message ||
                  "A apărut o problemă la încărcarea informării."}
              </div>
            ) : (
              <div
                className={
                  styles.skeletonLine
                }
              />
            )}
          </div>

          <div
            className={
              styles.headerRight
            }
          >
            {blocked ? (
              <span
                className={
                  styles.badge
                }
              >
                Necesită acceptare
              </span>
            ) : null}

            {onClose &&
            !blocked ? (
              <button
                type="button"
                className={
                  styles.closeBtn
                }
                onClick={
                  onClose
                }
                aria-label="Închide"
              >
                ×
              </button>
            ) : null}
          </div>
        </header>

        <div
          className={
            styles.body
          }
        >
          {err ? (
            <div
              className={
                styles.error
              }
            >
              {err}
            </div>
          ) : null}

          <div
            className={
              styles.sectionLabel
            }
          >
            Documente vizate
          </div>

          <div
            className={
              styles.docs
            }
          >
            {(
              payload?.documents ||
              []
            ).length ? (
              (
                payload?.documents ||
                []
              ).map(
                (
                  documentItem
                ) => (
                  <div
                    key={`${documentItem.key}-${documentItem.version}`}
                    className={
                      styles.docRow
                    }
                  >
                    <div
                      className={
                        styles.docMain
                      }
                    >
                      <div
                        className={
                          styles.docTop
                        }
                      >
                        <span
                          className={
                            styles.docTitle
                          }
                        >
                          {documentItem.title ||
                            documentItem.key}
                        </span>

                        <span
                          className={
                            styles.docMeta
                          }
                        >
                          v
                          {documentItem.version ||
                            "?"}
                        </span>

                        {documentItem.required ? (
                          <span
                            className={
                              styles.req
                            }
                          >
                            Obligatoriu
                          </span>
                        ) : null}

                        {documentItem.alreadyAccepted ? (
                          <span
                            className={
                              styles.ok
                            }
                          >
                            ✓ Acceptat
                          </span>
                        ) : (
                          <span
                            className={
                              styles.pending
                            }
                          >
                            □ Necesită
                            acceptare
                          </span>
                        )}
                      </div>

                      {documentItem.url ? (
                        <a
                          className={
                            styles.link
                          }
                          href={
                            documentItem.url
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          Deschide
                          documentul
                        </a>
                      ) : (
                        <div
                          className={
                            styles.muted
                          }
                        >
                          Link lipsă
                        </div>
                      )}
                    </div>
                  </div>
                )
              )
            ) : (
              <div
                className={
                  styles.muted
                }
              >
                {loading
                  ? "Se încarcă documentele…"
                  : "Nu există documente încărcate pentru această informare."}
              </div>
            )}
          </div>

          {blocked ? (
            <div
              className={
                styles.hint
              }
            >
              Unele acțiuni sunt
              blocate până accepți
              documentele
              obligatorii.
            </div>
          ) : (
            <div
              className={
                styles.hint
              }
            >
              Documentele
              obligatorii sunt
              acceptate sau
              informarea nu
              necesită acțiune.
            </div>
          )}
        </div>

        <footer
          className={
            styles.footer
          }
        >
          <button
            type="button"
            className={
              styles.primaryBtn
            }
            onClick={
              handleAcceptAll
            }
            disabled={
              !blocked ||
              submitting ||
              loading ||
              !!err
            }
          >
            {submitting
              ? "Se acceptă…"
              : "Acceptă și continuă"}
          </button>

          <button
            type="button"
            className={
              styles.secondaryBtn
            }
            onClick={
              fetchGate
            }
            disabled={
              submitting ||
              loading
            }
          >
            Reîncarcă
          </button>
        </footer>
      </section>
    </div>
  );

  return createPortal(
    modal,
    document.body
  );
}