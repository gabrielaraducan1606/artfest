import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { api } from "../../lib/api";
import styles from "./InfluencerRegisterPage.module.css";

/* =========================================================
   HELPERS
========================================================= */

function normalizeLegalMeta(items) {
  const result = {};

  for (const item of items || []) {
    if (!item?.type) {
      continue;
    }

    result[item.type] =
      item;
  }

  return result;
}

function buildAuthUrl(token) {
  const params =
    new URLSearchParams();

  params.set(
    "influencerInvite",
    token
  );

  return `/autentificare?${params.toString()}`;
}

/* =========================================================
   COMPONENT
========================================================= */

export default function InfluencerRegisterPage() {
  const navigate =
    useNavigate();

  const [
    searchParams,
  ] =
    useSearchParams();

  const token =
    (
      searchParams.get(
        "token"
      ) ||
      ""
    ).trim();

  /* ---------------------------------------------------------
     INVITE
  --------------------------------------------------------- */

  const [
    loadingInvite,
    setLoadingInvite,
  ] =
    useState(true);

  const [
    inviteError,
    setInviteError,
  ] =
    useState("");

  const [
    invite,
    setInvite,
  ] =
    useState(null);

  /* ---------------------------------------------------------
     LEGAL
  --------------------------------------------------------- */

  const [
    legal,
    setLegal,
  ] =
    useState({});

  const [
    legalLoading,
    setLegalLoading,
  ] =
    useState(true);

  const [
    legalError,
    setLegalError,
  ] =
    useState("");

  /* ---------------------------------------------------------
     PASSWORD
  --------------------------------------------------------- */

  const [
    password,
    setPassword,
  ] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] =
    useState("");

  const [
    showPassword,
    setShowPassword,
  ] =
    useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] =
    useState(false);

  /* ---------------------------------------------------------
     CONSENTS
  --------------------------------------------------------- */

  const [
    tosAccepted,
    setTosAccepted,
  ] =
    useState(false);

  const [
    privacyAccepted,
    setPrivacyAccepted,
  ] =
    useState(false);

  const [
    influencerTermsAccepted,
    setInfluencerTermsAccepted,
  ] =
    useState(false);

  const [
    marketingAccepted,
    setMarketingAccepted,
  ] =
    useState(false);

  /* ---------------------------------------------------------
     SUBMIT
  --------------------------------------------------------- */

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false);

  const [
    submitError,
    setSubmitError,
  ] =
    useState("");

  const [
    success,
    setSuccess,
  ] =
    useState(false);

  /* =========================================================
     LOAD INVITE
  ========================================================= */

  useEffect(() => {
    let active = true;

    async function loadInvite() {
      setLoadingInvite(
        true
      );

      setInviteError(
        ""
      );

      if (!token) {
        setInvite(
          null
        );

        setInviteError(
          "Linkul de invitație nu conține un token valid."
        );

        setLoadingInvite(
          false
        );

        return;
      }

      try {
        const data =
          await api(
            `/api/influencer/invite?token=${encodeURIComponent(
              token
            )}`
          );

        if (!active) {
          return;
        }

        if (
          data?.ok ===
          false
        ) {
          throw Object.assign(
            new Error(
              data?.message ||
                "Invitația nu este validă."
            ),
            {
              data,
            }
          );
        }

        if (
          !data?.invite
        ) {
          throw new Error(
            "Backendul nu a returnat invitația."
          );
        }

        setInvite(
          data.invite
        );
      } catch (
        error
      ) {
        if (!active) {
          return;
        }

        setInvite(
          null
        );

        setInviteError(
          mapInviteError(
            error?.data
              ?.error ||
              error?.error,

            error?.data
              ?.message ||
              error?.message
          )
        );
      } finally {
        if (active) {
          setLoadingInvite(
            false
          );
        }
      }
    }

    loadInvite();

    return () => {
      active =
        false;
    };
  }, [token]);

  /* =========================================================
     LOAD LEGAL META
  ========================================================= */

  useEffect(() => {
    let active = true;

    async function loadLegal() {
      setLegalLoading(
        true
      );

      setLegalError(
        ""
      );

      try {
        const response =
          await api(
            "/api/legal?types=tos,privacy,influencer_terms"
          );

        if (!active) {
          return;
        }

        setLegal(
          normalizeLegalMeta(
            response
          )
        );
      } catch (
        error
      ) {
        if (!active) {
          return;
        }

        console.error(
          "Influencer legal metadata error:",
          error
        );

        setLegal({});

        setLegalError(
          "Nu am putut încărca versiunile documentelor legale. Poți continua folosind documentele publice Artfest."
        );
      } finally {
        if (active) {
          setLegalLoading(
            false
          );
        }
      }
    }

    loadLegal();

    return () => {
      active =
        false;
    };
  }, []);

  /* =========================================================
     PASSWORD
  ========================================================= */

  const passwordScore =
    useMemo(() => {
      let score =
        0;

      if (
        password.length >=
        8
      ) {
        score +=
          1;
      }

      if (
        /[a-z]/.test(
          password
        )
      ) {
        score +=
          1;
      }

      if (
        /[A-Z]/.test(
          password
        )
      ) {
        score +=
          1;
      }

      if (
        /\d/.test(
          password
        )
      ) {
        score +=
          1;
      }

      if (
        /[^A-Za-z0-9]/.test(
          password
        )
      ) {
        score +=
          1;
      }

      return score;
    }, [password]);

  const passwordsMatch =
    confirmPassword.length >
      0 &&
    password ===
      confirmPassword;

  const canSubmit =
    !submitting &&
    !success &&
    password.length >=
      8 &&
    passwordScore >=
      3 &&
    passwordsMatch &&
    tosAccepted &&
    privacyAccepted &&
    influencerTermsAccepted;

  /* =========================================================
     CONSENTS
  ========================================================= */

  function buildConsents() {
    const consents =
      [];

    if (
      tosAccepted
    ) {
      consents.push({
        type:
          "tos",

        version:
          String(
            legal?.tos
              ?.version ||
              "1.0.0"
          ),

        checksum:
          legal?.tos
            ?.checksum ??
          null,
      });
    }

    if (
      privacyAccepted
    ) {
      consents.push({
        type:
          "privacy_ack",

        version:
          String(
            legal?.privacy
              ?.version ||
              "1.0.0"
          ),

        checksum:
          legal?.privacy
            ?.checksum ??
          null,
      });
    }

    if (
      influencerTermsAccepted
    ) {
      consents.push({
        type:
          "influencer_terms",

        version:
          String(
            legal
              ?.influencer_terms
              ?.version ||
              "1.0.0"
          ),

        checksum:
          legal
            ?.influencer_terms
            ?.checksum ??
          null,
      });
    }

    if (
      marketingAccepted
    ) {
      consents.push({
        type:
          "marketing_email_optin",

        version:
          "1.0.0",

        checksum:
          null,
      });
    }

    return consents;
  }

  /* =========================================================
     SUBMIT
  ========================================================= */

  async function handleSubmit(
    event
  ) {
    event.preventDefault();

    if (
      !canSubmit ||
      submitting
    ) {
      return;
    }

    setSubmitting(
      true
    );

    setSubmitError(
      ""
    );

    try {
      const data =
        await api(
          "/api/influencer/register",
          {
            method:
              "POST",

            body: {
              token,
              password,
              confirmPassword,

              consents:
                buildConsents(),
            },
          }
        );

      if (
        data?.ok ===
        false
      ) {
        throw Object.assign(
          new Error(
            data?.message ||
              "Nu am putut crea contul."
          ),
          {
            data,
          }
        );
      }

      setSuccess(
        true
      );

      const next =
        data?.next ||
        `/verify-email?email=${encodeURIComponent(
          invite?.email ||
            ""
        )}`;

      window.setTimeout(
        () => {
          navigate(
            next
          );
        },
        900
      );
    } catch (
      error
    ) {
      const errorCode =
        error?.data
          ?.error ||
        error?.error ||
        "";

      if (
        errorCode ===
          "account_already_exists" ||
        errorCode ===
          "already_influencer"
      ) {
        setSubmitError(
          errorCode ===
            "already_influencer"
            ? "Acest cont este deja asociat unui profil de influencer. Conectează-te folosind contul existent."
            : "Există deja un cont Artfest cu acest email. Conectează-te în contul existent pentru a accepta invitația."
        );

        return;
      }

      setSubmitError(
        mapRegisterError(
          errorCode,

          error?.data
            ?.message ||
            error?.message
        )
      );
    } finally {
      setSubmitting(
        false
      );
    }
  }

  /* =========================================================
     LOADING
  ========================================================= */

  if (
    loadingInvite
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <section
          className={
            styles.card
          }
        >
          <div
            className={
              styles.loading
            }
          >
            Se verifică invitația…
          </div>
        </section>
      </main>
    );
  }

  /* =========================================================
     INVALID INVITE
  ========================================================= */

  if (
    inviteError ||
    !invite
  ) {
    return (
      <main
        className={
          styles.page
        }
      >
        <section
          className={
            styles.card
          }
        >
          <div
            className={
              styles.iconCircle
            }
          >
            !
          </div>

          <h1
            className={
              styles.title
            }
          >
            Invitație indisponibilă
          </h1>

          <p
            className={
              styles.subtitle
            }
          >
            {inviteError ||
              "Nu am putut valida invitația."}
          </p>

          <button
            type="button"
            className={
              styles.secondaryButton
            }
            onClick={() =>
              navigate(
                "/"
              )
            }
          >
            Înapoi la Artfest
          </button>
        </section>
      </main>
    );
  }

  const accountExists =
    !!invite.accountExists;

  const alreadyInfluencer =
    !!invite.alreadyInfluencer;

  const existingRole =
    String(
      invite.existingRole ||
        ""
    ).toUpperCase();

  const incompatibleRole =
    accountExists &&
    existingRole &&
    existingRole !==
      "USER" &&
    existingRole !==
      "INFLUENCER";

  /* =========================================================
     PAGE
  ========================================================= */

  return (
    <main
      className={
        styles.page
      }
    >
      <section
        className={
          styles.card
        }
      >
        <div
          className={
            styles.badge
          }
        >
          Invitație privată Artfest
        </div>

        <h1
          className={
            styles.title
          }
        >
          Bun venit în programul de influenceri Artfest
        </h1>

        <p
          className={
            styles.subtitle
          }
        >
          Creează-ți contul de influencer Artfest pentru a activa colaborarea.
        </p>

        <div
          className={
            styles.inviteSummary
          }
        >
          <SummaryRow
            label="Nume"
            value={
              invite.name ||
              "—"
            }
          />

          <SummaryRow
            label="Email"
            value={
              invite.email ||
              "—"
            }
          />
        </div>

        {/* =====================================================
            CONT DEJA INFLUENCER
        ===================================================== */}

        {alreadyInfluencer ? (
          <div
            className={
              styles.existingAccountBox
            }
          >
            <div
              className={
                styles.existingAccountTitle
              }
            >
              Ai deja un cont de influencer Artfest
            </div>

            <div
              className={
                styles.existingAccountText
              }
            >
              Acest email este deja asociat unui profil de influencer. Te poți autentifica direct.
            </div>

            <button
              type="button"
              className={
                styles.primaryButton
              }
              onClick={() =>
                navigate(
                  "/autentificare"
                )
              }
            >
              Conectează-te
            </button>
          </div>
        ) : incompatibleRole ? (
          /* ===================================================
             VENDOR / ADMIN EXISTENT
          =================================================== */

          <div
            className={
              styles.existingAccountBox
            }
          >
            <div
              className={
                styles.existingAccountTitle
              }
            >
              Acest email are deja un alt tip de cont Artfest
            </div>

            <div
              className={
                styles.existingAccountText
              }
            >
              Contul existent are rolul{" "}
              <strong>
                {existingRole}
              </strong>
              . Momentan acest cont nu poate fi transformat automat într-un cont de influencer.
            </div>
          </div>
        ) : accountExists ? (
          /* ===================================================
             USER EXISTENT
          =================================================== */

          <div
            className={
              styles.existingAccountBox
            }
          >
            <div
              className={
                styles.existingAccountTitle
              }
            >
              Ai deja un cont Artfest
            </div>

            <div
              className={
                styles.existingAccountText
              }
            >
              Pentru acest email există deja un cont. Conectează-te în contul existent pentru a accepta invitația de influencer.
            </div>

            <button
              type="button"
              className={
                styles.primaryButton
              }
              onClick={() =>
                navigate(
                  buildAuthUrl(
                    token
                  )
                )
              }
            >
              Conectează-te
            </button>
          </div>
        ) : (
          /* ===================================================
             CONT NOU
          =================================================== */

          <form
            onSubmit={
              handleSubmit
            }
            className={
              styles.form
            }
            noValidate
          >
            <div
              className={
                styles.field
              }
            >
              <label
                htmlFor="influencer-email"
                className={
                  styles.label
                }
              >
                Email
              </label>

              <input
                id="influencer-email"
                type="email"
                className={
                  styles.input
                }
                value={
                  invite.email ||
                  ""
                }
                disabled
              />

              <div
                className={
                  styles.hint
                }
              >
                Emailul este preluat din invitația ta și nu poate fi schimbat aici.
              </div>
            </div>

            {/* PAROLA */}

            <div
              className={
                styles.field
              }
            >
              <label
                htmlFor="influencer-password"
                className={
                  styles.label
                }
              >
                Parolă
              </label>

              <div
                className={
                  styles.passwordWrap
                }
              >
                <input
                  id="influencer-password"
                  type={
                    showPassword
                      ? "text"
                      : "password"
                  }
                  className={
                    styles.input
                  }
                  value={
                    password
                  }
                  onChange={(
                    event
                  ) =>
                    setPassword(
                      event.target
                        .value
                    )
                  }
                  autoComplete="new-password"
                  placeholder="Minimum 8 caractere"
                />

                <button
                  type="button"
                  className={
                    styles.passwordToggle
                  }
                  onClick={() =>
                    setShowPassword(
                      (
                        current
                      ) =>
                        !current
                    )
                  }
                >
                  {showPassword
                    ? "Ascunde"
                    : "Arată"}
                </button>
              </div>

              <PasswordStrength
                score={
                  passwordScore
                }
                password={
                  password
                }
              />
            </div>

            {/* CONFIRMARE PAROLA */}

            <div
              className={
                styles.field
              }
            >
              <label
                htmlFor="influencer-confirm-password"
                className={
                  styles.label
                }
              >
                Confirmă parola
              </label>

              <div
                className={
                  styles.passwordWrap
                }
              >
                <input
                  id="influencer-confirm-password"
                  type={
                    showConfirmPassword
                      ? "text"
                      : "password"
                  }
                  className={
                    styles.input
                  }
                  value={
                    confirmPassword
                  }
                  onChange={(
                    event
                  ) =>
                    setConfirmPassword(
                      event.target
                        .value
                    )
                  }
                  autoComplete="new-password"
                  placeholder="Repetă parola"
                />

                <button
                  type="button"
                  className={
                    styles.passwordToggle
                  }
                  onClick={() =>
                    setShowConfirmPassword(
                      (
                        current
                      ) =>
                        !current
                    )
                  }
                >
                  {showConfirmPassword
                    ? "Ascunde"
                    : "Arată"}
                </button>
              </div>

              {confirmPassword &&
                !passwordsMatch && (
                  <div
                    className={
                      styles.fieldError
                    }
                  >
                    Parolele nu coincid.
                  </div>
                )}

              {passwordsMatch && (
                <div
                  className={
                    styles.fieldSuccess
                  }
                >
                  Parolele coincid.
                </div>
              )}
            </div>

            {/* LEGAL */}

            <div
              className={
                styles.consents
              }
            >
              <label
                className={
                  styles.checkboxRow
                }
              >
                <input
                  type="checkbox"
                  checked={
                    tosAccepted
                  }
                  onChange={(
                    event
                  ) =>
                    setTosAccepted(
                      event.target
                        .checked
                    )
                  }
                />

                <span>
                  Accept{" "}
                  <a
                    href="/termenii-si-conditiile"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Termenii și Condițiile
                  </a>{" "}
                  Artfest
                </span>
              </label>

              <label
                className={
                  styles.checkboxRow
                }
              >
                <input
                  type="checkbox"
                  checked={
                    privacyAccepted
                  }
                  onChange={(
                    event
                  ) =>
                    setPrivacyAccepted(
                      event.target
                        .checked
                    )
                  }
                />

                <span>
                  Am citit{" "}
                  <a
                    href="/confidentialitate"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Politica de confidențialitate
                  </a>
                </span>
              </label>

              <label
                className={
                  styles.checkboxRow
                }
              >
                <input
                  type="checkbox"
                  checked={
                    influencerTermsAccepted
                  }
                  onChange={(
                    event
                  ) =>
                    setInfluencerTermsAccepted(
                      event.target
                        .checked
                    )
                  }
                />

                <span>
                  Accept{" "}
                  <a
                    href="/acord-influenceri"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Acordul privind Programul de Influenceri Artfest
                  </a>
                </span>
              </label>

              <label
                className={
                  styles.checkboxRow
                }
              >
                <input
                  type="checkbox"
                  checked={
                    marketingAccepted
                  }
                  onChange={(
                    event
                  ) =>
                    setMarketingAccepted(
                      event.target
                        .checked
                    )
                  }
                />

                <span>
                  Doresc să primesc noutăți și oferte Artfest prin email.
                </span>
              </label>
            </div>

            {legalLoading && (
              <div
                className={
                  styles.hint
                }
              >
                Se verifică versiunile documentelor legale…
              </div>
            )}

            {legalError && (
              <div
                className={
                  styles.hint
                }
              >
                {legalError}
              </div>
            )}

            {/* ERROR */}

            {submitError && (
              <div
                className={
                  styles.errorBox
                }
              >
                {submitError}

                {(
                  submitError.includes(
                    "cont Artfest"
                  ) ||
                  submitError.includes(
                    "deja asociat"
                  )
                ) && (
                  <>
                    <br />

                    <button
                      type="button"
                      className={
                        styles.secondaryButton
                      }
                      onClick={() =>
                        navigate(
                          buildAuthUrl(
                            token
                          )
                        )
                      }
                    >
                      Conectează-te
                    </button>
                  </>
                )}
              </div>
            )}

            {/* SUCCESS */}

            {success && (
              <div
                className={
                  styles.successBox
                }
              >
                Contul a fost creat. Te redirecționăm către verificarea emailului…
              </div>
            )}

            <button
              type="submit"
              className={
                styles.primaryButton
              }
              disabled={
                !canSubmit
              }
            >
              {submitting
                ? "Se creează contul…"
                : "Creează contul"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

/* =========================================================
   COMPONENTS
========================================================= */

function SummaryRow({
  label,
  value,
}) {
  return (
    <div
      className={
        styles.summaryRow
      }
    >
      <span
        className={
          styles.summaryLabel
        }
      >
        {label}
      </span>

      <span
        className={
          styles.summaryValue
        }
      >
        {value}
      </span>
    </div>
  );
}

function PasswordStrength({
  score,
  password,
}) {
  if (!password) {
    return null;
  }

  let label =
    "Slabă";

  if (
    score >=
    4
  ) {
    label =
      "Puternică";
  } else if (
    score >=
    3
  ) {
    label =
      "Acceptabilă";
  }

  return (
    <div
      className={
        styles.passwordStrength
      }
    >
      <div
        className={
          styles.strengthBars
        }
      >
        {[
          1,
          2,
          3,
          4,
          5,
        ].map(
          (
            item
          ) => (
            <span
              key={
                item
              }
              className={`${styles.strengthBar} ${
                item <=
                score
                  ? styles.strengthBarActive
                  : ""
              }`}
            />
          )
        )}
      </div>

      <div
        className={
          styles.strengthLabel
        }
      >
        Parolă:{" "}
        {label}
      </div>
    </div>
  );
}

/* =========================================================
   ERRORS
========================================================= */

function mapInviteError(
  error,
  message
) {
  switch (error) {
    case "token_required":
      return "Linkul de invitație nu este complet.";

    case "invalid_invitation":
      return "Invitația nu este validă.";

    case "invitation_expired":
      return "Invitația a expirat. Cere administratorului un link nou.";

    case "invitation_already_used":
      return "Această invitație a fost deja folosită.";

    default:
      return (
        message ||
        "Nu am putut verifica invitația."
      );
  }
}

function mapRegisterError(
  error,
  message
) {
  switch (error) {
    case "passwords_do_not_match":
      return "Parolele nu coincid.";

    case "weak_password":
      return "Parola este prea slabă.";

    case "mandatory_consents_required":
      return "Trebuie să accepți Termenii, Politica de confidențialitate și Acordul Programului de Influenceri.";

    case "influencer_terms_required":
      return "Trebuie să accepți Acordul privind Programul de Influenceri Artfest.";

    case "invalid_invitation":
      return "Invitația nu este validă.";

    case "invitation_expired":
    case "invitation_unavailable":
      return "Invitația nu mai este disponibilă.";

    case "invitation_already_used":
      return "Această invitație a fost deja folosită.";

    case "referral_code_already_exists":
      return "Nu am putut finaliza activarea profilului. Încearcă din nou.";

    case "account_already_exists":
      return "Există deja un cont Artfest cu acest email.";

    case "already_influencer":
      return "Acest cont este deja influencer.";

    case "influencer_registration_conflict":
      return "Contul nu a putut fi creat deoarece există deja date asociate acestei invitații.";

    default:
      return (
        message ||
        "Nu am putut crea contul de influencer."
      );
  }
}