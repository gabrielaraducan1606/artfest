// src/pages/CookiePreferences.jsx
import { useEffect, useState } from "react";
import { readConsent, saveConsent } from "../../lib/cookieConsent.js";

export default function CookiePreferences() {
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const c = readConsent();
    setAnalytics(!!c.analytics);
    setMarketing(!!c.marketing);
  }, []);

  const onSave = () => {
    saveConsent({ analytics, marketing });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      <h1>Preferințe cookie</h1>
      <p>Cookie-urile necesare sunt întotdeauna active. Poți controla mai jos consimțământul pentru statistici și marketing.</p>

      <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
        <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
        <span>Statistici (ex: Google Analytics)</span>
      </label>

      <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
        <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        <span>Marketing/Remarketing (ex: Meta, Google Ads)</span>
      </label>

      <button onClick={onSave} style={{ padding: "10px 14px" }}>Salvează</button>
      {saved && <div style={{ marginTop: 8, color: "green" }}>Preferințe salvate.</div>}
    </div>
  );
}
