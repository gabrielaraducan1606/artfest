import { useState } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import styles from "../AdminMaintenancePage.module.css";

function formatDate(dateString) {
  if (!dateString) return "—";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ro-RO");
}

/**
 * Tab pentru "Conturi cu probleme" (bază).
 *
 * Backend-ul poate trimite ulterior date de forma:
 * {
 *   items: [
 *     {
 *       id,
 *       email,
 *       role,
 *       status,
 *       issuesSummary,   // text scurt: "multe eșecuri login", "suspiciune fraudă", etc.
 *       tags,            // array cu etichete ("FRAUD", "ABUSE", "SECURITY", "SPAM", ...)
 *       lastLoginAt,
 *       createdAt,
 *     },
 *     ...
 *   ],
 *   issuesCount: number
 * }
 */
export default function AdminProblemAccountsTab({
  loading,
  error,
  items,
  issuesCount,
  onReload,
}) {
  const hasItems = items && items.length > 0;
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div>
      <div className={styles.sectionHead}>
        <div>
          <div className={styles.sectionTitleRow}>
            <h3 className={styles.sectionTitle}>
              Conturi cu probleme
              <button
                type="button"
                className={styles.helpIconBtn}
                onClick={() => setShowHelp((v) => !v)}
                title="Ce înseamnă un cont abuziv sau periculos?"
              >
                <FaQuestionCircle className={styles.helpIcon} />
              </button>
            </h3>
          </div>

          <p className={styles.subtle}>
            Conturi marcate ca având potențiale probleme: suspiciuni de abuz,
            fraudă, comportament riscant sau blocări manuale. Lista este
            orientativă – deciziile finale se iau manual de către un admin.
          </p>

          <p className={styles.subtle}>
            Total conturi cu probleme cunoscute:{" "}
            <strong>{issuesCount ?? items.length ?? 0}</strong>
          </p>
        </div>

        <div className={styles.sectionActions}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={onReload}
            disabled={loading}
          >
            Reîncarcă
          </button>
        </div>
      </div>

      {showHelp && (
        <div className={styles.helpBox}>
          <p>
            <strong>Ce este un cont abuziv / periculos?</strong>
          </p>
          <p>
            Un cont abuziv sau periculos este un cont care:
          </p>
          <ul>
            <li>
              <strong>încalcă Termenii și Condițiile</strong> (limbaj
              ofensator, atacuri la persoană, mesaje de ură, hărțuire);
            </li>
            <li>
              <strong>abuzează de sistem</strong> (spam în mesaje, review-uri
              artificiale, încercări de a păcăli algoritmii sau politicile de
              retur);
            </li>
            <li>
              prezintă <strong>risc financiar sau de fraudă</strong>
              (chargeback-uri repetate, comenzi suspecte, utilizare de date
              false sau furate);
            </li>
            <li>
              indică <strong>probleme de securitate</strong> (cont compromis,
              foarte multe încercări eșuate de login, acces din locații
              neobișnuite);
            </li>
            <li>
              ridică <strong>riscuri legale sau de conformitate</strong>
              (conținut ilegal, tentative de scam, încălcarea drepturilor
              altor utilizatori sau vendori).
            </li>
          </ul>

          <p>
            <strong>Tipuri tipice de probleme pe care le poate semnala acest tab:</strong>
          </p>
          <ul>
            <li>
              <strong>ABUSE</strong> – limbaj jignitor, hărțuire, mesaje
              agresive trimise către vendori sau alți utilizatori; raportări
              multiple din partea comunității;
            </li>
            <li>
              <strong>SPAM</strong> – foarte multe mesaje/copypaste, cereri
              neserioase, link-uri externe repetate fără legătură cu
              platforma;
            </li>
            <li>
              <strong>FRAUD</strong> – comenzi multiple anulate, pattern-uri
              de neplată, chargeback-uri, date de facturare suspecte sau
              contradictorii;
            </li>
            <li>
              <strong>SECURITY</strong> – multe încercări de autentificare
              eșuate, încercări de login din mai multe locații foarte
              diferite, semne că cineva încearcă să preia contul;
            </li>
            <li>
              <strong>COMPROMISED</strong> – cont marcat ca fiind posibil
              compromis (userul raportează activitate pe care nu o
              recunoaște); în mod normal se combină cu blocarea temporară și
              resetarea parolei;
            </li>
            <li>
              <strong>MANUAL_BLOCK / SUSPENDED</strong> – cont suspendat
              manual de un admin, de obicei după o analiză sau o plângere
              serioasă.
            </li>
          </ul>

          <p>
            <strong>Cum ar trebui folosite aceste informații de către un admin?</strong>
          </p>
          <ol>
            <li>
              <strong>Investigă contextul</strong>: verifică istoricul de
              comenzi, mesaje, review-uri, tichete suport și eventuale note
              interne înainte să iei o decizie.
            </li>
            <li>
              <strong>Diferențiază între suspiciune și confirmare</strong>:
              unele semnale sunt doar &bdquo;red flags&ldquo; (de exemplu,
              multe încercări de login), altele sunt dovezi clare (de
              exemplu, fraudă confirmată, amenințări explicite).
            </li>
            <li>
              <strong>Alege acțiunea potrivită</strong>:
              <ul>
                <li>
                  avertisment (mesaj către utilizator);
                </li>
                <li>
                  limitare temporară (de ex. nu mai poate trimite mesaje);
                </li>
                <li>
                  <strong>suspendare cont</strong> (blocare login, dar
                  păstrare istoricului pentru audit și legal);
                </li>
                <li>
                  escaladare către suport / legal în cazurile grave.
                </li>
              </ul>
            </li>
            <li>
              <strong>Notează motivul</strong> în sistem (log intern sau
              câmp dedicat), astfel încât și alți admini să înțeleagă ulterior
              de ce a fost marcat contul.
            </li>
          </ol>

          <p className={styles.subtle}>
            <strong>Important:</strong> această listă este un instrument de
            lucru pentru admini, nu o decizie automată. Orice acțiune
            împotriva unui cont (în special suspendarea) ar trebui să fie
            justificată și, pe cât posibil, documentată.
          </p>
        </div>
      )}

      {loading && (
        <p className={styles.subtle}>Se încarcă lista de conturi cu probleme…</p>
      )}

      {error && !loading && (
        <p className={styles.errorText}>{error}</p>
      )}

      {!loading && !error && !hasItems && (
        <p className={styles.subtle}>
          Momentan nu există conturi marcate explicit ca având probleme sau
          logica nu a fost încă implementată în backend.
        </p>
      )}

      {!loading && !error && hasItems && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Status</th>
                <th>Probleme / motiv</th>
                <th>Tag-uri</th>
                <th>Creat la</th>
                <th>Ultima conectare</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const tags = Array.isArray(item.tags) ? item.tags : [];
                const status =
                  item.status || (item.isSuspended ? "SUSPENDED" : "ACTIVE");

                return (
                  <tr key={item.id}>
                    <td>
                      <code>{item.id}</code>
                    </td>
                    <td>{item.email || "—"}</td>
                    <td>{item.role || "—"}</td>
                    <td>{status}</td>
                    <td>{item.issuesSummary || "—"}</td>
                    <td>
                      {tags.length
                        ? tags.join(", ")
                        : "—"}
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>{formatDate(item.lastLoginAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
