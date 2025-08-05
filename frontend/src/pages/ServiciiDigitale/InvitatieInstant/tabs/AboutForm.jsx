// src/components/InvitatieInstant/Tabs/AboutForm.jsx
import { useInvitation } from "../../../../../invitation/useInvitation";
import styles from "./TabForms.module.css";
import { useState } from "react";

export function AboutForm() {
  const { data, update } = useInvitation();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(
    data?.home?.backgroundUrl || "/images/backroundHome.JPG"
  );

  const safe = (v, f = "") => (v ?? v === 0 ? v : f);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview local instant
    const localUrl = URL.createObjectURL(file);
    setPreview(localUrl);

    try {
      setUploading(true);

      // Exemplu generic de upload — ajustează la backend-ul tău
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Upload failed");
      const json = await res.json(); // { url: "https://..." }

      // Persistă URL-ul final în state
      update("home.backgroundUrl", json.url);
      setPreview(json.url);
    } catch (err) {
      console.error(err);
      // dacă upload-ul eșuează, rămâne preview-ul local până la refresh
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={styles.form}>
      <h2>About Us</h2>

      <label className={styles.formLabel}>Mireasă</label>
      <input
        className={styles.formInput}
        placeholder="Nume Mireasă"
        value={safe(data?.couple?.bride)}
        onChange={(e) => update("couple.bride", e.target.value)}
      />

      <label className={styles.formLabel}>Mire</label>
      <input
        className={styles.formInput}
        placeholder="Nume Mire"
        value={safe(data?.couple?.groom)}
        onChange={(e) => update("couple.groom", e.target.value)}
      />

      <label className={styles.formLabel}>Titlu poveste</label>
      <input
        className={styles.formInput}
        placeholder="Ex: Povestea noastră"
        value={safe(data?.storyHeadline)}
        onChange={(e) => update("storyHeadline", e.target.value)}
      />

      <label className={styles.formLabel}>Data</label>
      <input
        className={styles.formInput}
        type="date"
        value={safe(data?.date)}
        onChange={(e) => update("date", e.target.value)}
      />

      <label className={styles.formLabel}>Oraș, Țară</label>
      <input
        className={styles.formInput}
        placeholder="Ex: Buzău, România"
        value={safe(data?.city)}
        onChange={(e) => update("city", e.target.value)}
      />

      {/* ——— Imagine acasă (background) ——— */}
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Poză de fundal (URL)</label>
        <input
          className={styles.formInput}
          placeholder="https://exemplu.ro/poza.jpg"
          value={safe(data?.home?.backgroundUrl)}
          onChange={(e) => {
            update("home.backgroundUrl", e.target.value);
            setPreview(e.target.value || "/images/backroundHome.JPG");
          }}
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>sau Încarcă o poză</label>
        <input
          className={styles.formInput}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
        />
        {uploading && <p>Se încarcă...</p>}
      </div>

      <div className={styles.previewWrap}>
        <p className={styles.formLabel}>Preview background</p>
        <div
          className={styles.preview}
          style={{ backgroundImage: `url("${preview}")` }}
          aria-label="Preview poză de fundal"
        />
      </div>
    </div>
  );
}
