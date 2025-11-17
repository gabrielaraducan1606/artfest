import { FaEdit } from "react-icons/fa";
import { useEffect, useState } from "react";
import styles from "./css/AboutSection.module.css";

/**
 * Secțiunea „Despre”
 * - Dacă nu există conținut și canEdit = true (vendor), afișează o notă cu sugestii
 * - Buton de edit mic lângă titlu
 */
export default function AboutSection({
  aboutText,
  canEdit = false,
  editAbout = false,
  aboutDraft = "",
  onToggleEditAbout = () => {},
  onChangeAbout = () => {},
  onSaveAbout = () => {},
  savingAbout = false,
}) {
  // ✅ dacă userul vrea să ascundă nota
  const [hideNote, setHideNote] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("hide-about-note") === "1") {
      setHideNote(true);
    }
  }, []);

  const handleHideNote = () => {
    localStorage.setItem("hide-about-note", "1");
    setHideNote(true);
  };

  // dacă nu există conținut și nu e vendor, nu afișăm secțiunea deloc
  if (!aboutText && !canEdit) return null;

  const showEmptyNote = !aboutText && canEdit && !editAbout && !hideNote;

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeadRow}>
          <h2 className={styles.sectionTitle}>
            Despre
            {canEdit && (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={onToggleEditAbout}
                aria-pressed={!!editAbout}
                aria-label={editAbout ? "Închide editarea Despre" : "Editează Despre"}
                title={editAbout ? "Închide editarea" : "Editează"}
              >
                <FaEdit size={14} />
              </button>
            )}
          </h2>
        </div>

        {/* mod vizualizare */}
        {!editAbout && !showEmptyNote && (
          <p className={styles.about}>{aboutText || "—"}</p>
        )}

        {/* ✅ notă informativă + buton ascundere */}
        {showEmptyNote && (
          <div
            className={styles.note}
            role="note"
            aria-label="Sugestii pentru secțiunea Despre"
          >
            <p className={styles.muted}>
              Spune-le vizitatorilor <strong>cine ești și de ce te aleg</strong>.
              Idei utile:
            </p>
            <ul className={styles.noteList}>
              <li>Povestea brandului / atelierului (cum a început, de ce faci asta).</li>
              <li>Ce creezi concret și <em>în ce te diferențiezi</em> (tehnici, materiale, stil).</li>
              <li>Comenzi personalizate: ce poți adapta (dimensiuni, culori, gravură, mesaje).</li>
              <li>Valori / misiune (sustenabilitate, local, lucrat manual, made-to-order).</li>
              <li>Despre tine/echipă și atelier (certificări, premii, colaborări).</li>
              <li>Îngrijire/mentenanță produse sau garanții, dacă e cazul.</li>
            </ul>

            <div>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={onToggleEditAbout}
              >
                Scrie povestea magazinului
              </button>
            </div>

            {/* ✅ Butonul nou "Nu afișa din nou" */}
            <button
              type="button"
              className={styles.hideNoteBtn}
              onClick={handleHideNote}
            >
              Nu afișa din nou
            </button>
          </div>
        )}

        {/* mod editare */}
        {editAbout && (
          <div className={styles.editor}>
            <textarea
              className={styles.input}
              rows={6}
              value={aboutDraft}
              onChange={(e) => onChangeAbout(e.target.value)}
              placeholder="Povestea brandului tău, ce creezi, cum lucrezi și ce te diferențiezi…"
              aria-label="Despre"
            />
            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={onSaveAbout}
                disabled={savingAbout}
              >
                {savingAbout ? "Se salvează…" : "Salvează"}
              </button>
              <button
                type="button"
                className={styles.followBtn}
                onClick={onToggleEditAbout}
              >
                Anulează
              </button>
            </div>
          </div>
        )}
      </section>
      <hr className={styles.hr} />
    </>
  );
}
