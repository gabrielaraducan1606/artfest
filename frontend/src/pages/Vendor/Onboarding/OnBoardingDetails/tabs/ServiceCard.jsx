import styles from "../OnBoardingDetails.module.css";

// Helpers pentru câmpul „Zonă acoperire”
function stringifyCoverage(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const head = arr[0];
  const list = head === "counties" ? arr.slice(1) : arr;
  return list.join(", ");
}
function parseCoverage(str) {
  const parts = (str || "").split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length ? ["counties", ...parts] : [];
}

export default function ServiceCard({
  service: s,
  idx,
  availability: av,
  saveState: st,
  saveError: stErr,
  updateProfile,
  uploadFile,
  setErr,
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span className={styles.typeCode}>{s.type?.code || s.typeCode}</span>
          <h2 className={styles.cardTitle}>{s.type?.name || "Serviciu"}</h2>
        </div>
        <div className={styles.saveIndicator} aria-live="polite">
          {st === "saving" && <span className={styles.badgeWait}>Se salvează…</span>}
          {st === "saved" && <span className={styles.badgeOk}>Salvat</span>}
          {st === "error" && <span className={styles.badgeBad}>Eroare</span>}
        </div>
      </div>

      {/* Nume public + disponibilitate */}
      <div className={styles.fieldGroup} style={{ marginBottom: 8 }}>
        <label className={styles.label}>Nume public serviciu</label>
        <div className={styles.brandRow}>
          <input
            className={`${styles.input} ${av.available === true ? styles.ok : ""} ${av.available === false ? styles.bad : ""}`}
            value={s.profile.displayName}
            onChange={(e) => updateProfile(idx, { displayName: e.target.value })}
            placeholder="Ex: Sweet Moments – Magazin / Produse"
          />
          <span
            className={`${styles.badge} ${
              av.state==="idle" ? "" :
              av.available ? styles.badgeOk :
              av.available===false ? styles.badgeBad : styles.badgeWait
            }`}
          >
            {av.state==="idle" && ""}
            {av.state==="loading" && "Se verifică…"}
            {av.state==="done" && (av.available ? "Disponibil" : "Indisponibil")}
            {av.state==="error" && "Eroare"}
          </span>
        </div>
        {av.state==="done" && av.available===false && (
          <small className={styles.help}>
            Sugestie: <code>{av.suggestion || "adaugă un sufix (ex: -2)"}</code>
          </small>
        )}
      </div>

      <div className={styles.grid}>
        {/* Logo */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Logo</label>
          <div className={styles.fileRow}>
            <input
              className={styles.input}
              type="url"
              value={s.profile.logoUrl}
              onChange={(e) => updateProfile(idx, { logoUrl: e.target.value })}
              placeholder="URL logo (sau încarcă)"
            />
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const url = await uploadFile(f);
                  updateProfile(idx, { logoUrl: url });
                } catch (er) { setErr(er.message); }
              }}
            />
          </div>
          {s.profile.logoUrl && <img src={s.profile.logoUrl} alt="logo" className={styles.previewThumb}/>}
        </div>

        {/* Cover */}
        <div className={styles.fieldGroup} style={{ gridColumn: "1 / -1" }}>
          <label className={styles.label}>Imagine copertă</label>
          <div className={styles.fileRow}>
            <input
              className={styles.input}
              type="url"
              value={s.profile.coverUrl}
              onChange={(e) => updateProfile(idx, { coverUrl: e.target.value })}
              placeholder="URL copertă (sau încarcă)"
            />
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try {
                  const url = await uploadFile(f);
                  updateProfile(idx, { coverUrl: url });
                } catch (er) { setErr(er.message); }
              }}
            />
          </div>
          {s.profile.coverUrl && <img src={s.profile.coverUrl} alt="cover" className={styles.previewBanner}/>}
        </div>

        {/* Contact – doar email & telefon (fără website/sociale) */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Email</label>
          <input
            className={styles.input}
            type="email"
            value={s.profile.email}
            onChange={(e)=>updateProfile(idx,{email:e.target.value})}
            placeholder="contact@exemplu.ro"
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Telefon</label>
          <input
            className={styles.input}
            value={s.profile.phone}
            onChange={(e)=>updateProfile(idx,{phone:e.target.value})}
            placeholder="07xx xxx xxx"
          />
        </div>

        {/* Adresă + zonă */}
        <div className={styles.fieldGroup} style={{ gridColumn: "1 / -1" }}>
          <label className={styles.label}>Adresă</label>
          <input
            className={styles.input}
            value={s.profile.address}
            onChange={(e)=>updateProfile(idx,{address:e.target.value})}
            placeholder="Str. Exemplu 10, București"
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Oraș (override)</label>
          <input
            className={styles.input}
            value={s.profile.city}
            onChange={(e)=>updateProfile(idx,{city:e.target.value})}
            placeholder="Ex: București"
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Zonă acoperire (virgulă)</label>
          <input
            className={styles.input}
            value={stringifyCoverage(s.profile.delivery)}
            onChange={(e)=>updateProfile(idx,{delivery:parseCoverage(e.target.value)})}
            placeholder="Ex: București, Ilfov, Ploiești"
          />
        </div>

        {/* Descriere scurtă */}
        <div className={styles.fieldGroup} style={{ gridColumn: "1 / -1" }}>
          <label className={styles.label}>Descriere scurtă</label>
          <textarea
            className={`${styles.input} ${styles.textarea}`}
            rows={3}
            value={s.profile.about}
            onChange={(e)=>updateProfile(idx,{about:e.target.value})}
            placeholder="Ce oferi la acest serviciu, pe scurt."
          />
        </div>
      </div>

      {st === "error" && stErr && (
        <div className={styles.error} role="alert">{stErr}</div>
      )}
    </div>
  );
}
