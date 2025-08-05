// src/pages/servicii/InvitatieInstantEditor.jsx
import { useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import styles from "./InvitatieInstantEditor.module.css";
import { useInvitation } from "../../../../../../invitation/useInvitation";
import api from "../../../../../../api/api";

// componente de form pentru fiecare tab
import {AboutForm} from "../../tabs/AboutForm";
import {GodparentsForm} from "../../tabs/GodparentsForm";
import {ParentsForm} from "../../tabs/ParentsForm";
import {WhereWhenForm} from "../../tabs/WhereWhenForm";
import {CountdownForm} from "../../tabs/CoundDownForm";
import {RSVPForm} from "../../tabs/RSPVForm";
import {FAQForm} from "../../tabs/FaqForm";

// componente preview existente
import Home from "../../../../../components/InvitatieInstant/Home/Home";
import GodParents from "../../../../../components/InvitatieInstant/GodParents/GodParents";
import Parents from "../../../../../components/InvitatieInstant/Parents/Parents";
import WhereWhen from "../../../../../components/InvitatieInstant/WhereWhen/WhereWhen";
import Countdown from "../../../../../components/InvitatieInstant/Countdown/Countdown";
import Form from "../../../../../components/InvitatieInstant/Form/From";
import FAQ from "../../../../../components/InvitatieInstant/Faq/Faq";

const TABS = [
  { key: "about", label: "About Us", Form: AboutForm },
  { key: "godparents", label: "Nași", Form: GodparentsForm },
  { key: "parents", label: "Părinți", Form: ParentsForm },
  { key: "wherewhen", label: "Unde & Când", Form: WhereWhenForm },
  { key: "countdown", label: "Countdown", Form: CountdownForm },
  { key: "rsvp", label: "RSVP", Form: RSVPForm },
  { key: "faq", label: "FAQ", Form: FAQForm },
];

export default function InvitatieInstantEditor() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "about";

  const { data, setData } = useInvitation();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Creare draft dacă e /new
  useEffect(() => {
    if (draftId === "new") {
      api.post("/invitations", { payload: data })
        .then(res => {
          navigate(`/servicii-digitale/invitatie-instant/editor/${res.data.id}?tab=about`, { replace: true });
        })
        .catch(err => console.error("Eroare creare draft", err));
    }
  }, [draftId, data, navigate]);

  // Încărcare draft dacă e id valid
  useEffect(() => {
    if (!draftId || draftId === "new") return;
    api.get(`/invitations/${draftId}`)
      .then(res => setData(res.data.payload))
      .catch(err => console.error("Eroare încărcare draft", err))
      .finally(() => setLoading(false));
  }, [draftId, setData]);

  // Autosave
  useEffect(() => {
    if (!draftId || draftId === "new") return;
    const timeout = setTimeout(() => {
      setSaving(true);
      api.put(`/invitations/${draftId}`, { payload: data })
        .finally(() => setSaving(false));
    }, 800);
    return () => clearTimeout(timeout);
  }, [data, draftId]);

  if (loading) return <div className={styles.loading}>Se încarcă editorul...</div>;

  const CurrentForm = TABS.find(t => t.key === tab)?.Form || AboutForm;

  return (
    <section className={styles.wrapper}>
      {/* Sidebar Tabs */}
      <aside className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.active : ""}`}
            onClick={() => setParams({ tab: t.key })}
          >
            {t.label}
          </button>
        ))}
        <div className={styles.saveState}>
          {saving ? "Se salvează..." : "Salvat"}
        </div>
        <button
          className={styles.publishBtn}
          onClick={() => navigate(`/servicii-digitale/invitatie-instant/review/${draftId}`)}
        >
          Revizuire & Publicare
        </button>
      </aside>

      {/* Form Section */}
      <div className={styles.formCol}>
        <CurrentForm />
      </div>

      {/* Preview Section */}
      <div className={styles.previewCol}>
        <Home data={data} />
        <GodParents data={data} />
        <Parents data={data} />
        <WhereWhen data={data} />
        <Countdown data={data} />
        <Form data={data} />
        <FAQ data={data} />
      </div>
    </section>
  );
}
