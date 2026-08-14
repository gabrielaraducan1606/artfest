// src/pages/CookiePreferences.jsx

import {
  useEffect,
  useState,
} from "react";

import {
  readConsent,
  saveConsent,
} from "../../lib/cookieConsent.js";

export default function CookiePreferences() {
  const [analytics, setAnalytics] =
    useState(false);

  const [marketing, setMarketing] =
    useState(false);

  const [saved, setSaved] =
    useState(false);

  useEffect(() => {
    const consent =
      readConsent();

    setAnalytics(
      consent?.analytics === true
    );

    setMarketing(
      consent?.marketing === true
    );
  }, []);

  function getAction() {
    if (
      analytics === true &&
      marketing === true
    ) {
      return "ACCEPT_ALL";
    }

    if (
      analytics === false &&
      marketing === false
    ) {
      return "NECESSARY_ONLY";
    }

    return "CUSTOM";
  }

  const onSave = () => {
    saveConsent(
      {
        necessary: true,
        analytics,
        marketing,
      },
      {
        action: getAction(),
        source:
          "COOKIE_PREFERENCES",
      }
    );

    setSaved(true);

    window.setTimeout(() => {
      setSaved(false);
    }, 2500);
  };

  return (
    <div
      style={{
        padding: 24,
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h1>
        Preferințe cookie
      </h1>

      <p
        style={{
          lineHeight: 1.6,
        }}
      >
        Cookie-urile strict necesare
        sunt întotdeauna active.
        Poți controla mai jos
        utilizarea cookie-urilor
        pentru statistici și
        marketing.
      </p>

      <div
        style={{
          padding: 16,
          marginTop: 20,
          border:
            "1px solid #e5e5e5",
          borderRadius: 12,
        }}
      >
        <label
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginBottom: 16,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={analytics}
            onChange={(event) =>
              setAnalytics(
                event.target.checked
              )
            }
          />

          <span>
            <strong>
              Statistici
            </strong>
            <br />
            <small>
              Ne ajută să înțelegem
              cum este folosită
              platforma, de exemplu
              prin Google Analytics.
            </small>
          </span>
        </label>

        <label
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={marketing}
            onChange={(event) =>
              setMarketing(
                event.target.checked
              )
            }
          />

          <span>
            <strong>
              Marketing și remarketing
            </strong>
            <br />
            <small>
              Permite utilizarea
              instrumentelor de
              publicitate precum
              Meta Pixel și Google Ads.
            </small>
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={onSave}
        style={{
          marginTop: 20,
          padding:
            "11px 18px",
          cursor: "pointer",
        }}
      >
        Salvează preferințele
      </button>

      {saved && (
        <div
          style={{
            marginTop: 12,
          }}
        >
          Preferințele au fost
          salvate.
        </div>
      )}
    </div>
  );
}