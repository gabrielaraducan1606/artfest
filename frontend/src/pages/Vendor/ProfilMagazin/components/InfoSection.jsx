import { FaEdit } from "react-icons/fa";
import ChipsInput from "../../Onboarding/fields/ChipsInput.jsx";
import s from "./css/InfoSection.module.css";

export default function InfoSection({
  tags = [],
  city,
  country,
  website,
  prettyDelivery,

  editInfo,
  savingInfo,
  infoErr,
  infoDraft,
  onToggleEditInfo = () => {},
  onChangeInfoDraft,
  onSaveInfo,
  canEdit = false,

  countySuggestions,
  countiesLoading,
  countiesErr,
  onCountiesChange,

  onTrackCTA = () => {},
}) {
  return (
    <section className={s.section}>
      <div className={s.head}>
        <h3 className={s.title}>
          Informații magazin

          {canEdit && (
            <button
              type="button"
              className={s.iconBtn}
              onClick={onToggleEditInfo}
              aria-pressed={!!editInfo}
              title={editInfo ? "Închide editarea" : "Editează"}
            >
              <FaEdit size={14} />
            </button>
          )}
        </h3>

        {infoErr && <span className={s.errorMsg}>{infoErr}</span>}
      </div>

      <div className={s.meta}>
        {tags.length > 0 && (
          <div className={s.metaRow}>
            <span className={s.metaLabel}>Tag-uri</span>

            <div className={s.tags}>
              {tags.map((t, i) => (
                <span key={i} className={s.tag}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {(city || country) && (
          <div className={s.metaRow}>
            <span className={s.metaLabel}>Locație</span>

            <span className={s.metaValue}>
              {city}
              {country ? `, ${country}` : ""}
            </span>
          </div>
        )}

        {editInfo && (
          <div className={s.metaRow}>
            <span className={s.metaLabel}>Adresă (internă)</span>

            <input
              className={s.inputInline}
              value={infoDraft?.address || ""}
              onChange={(e) =>
                onChangeInfoDraft({
                  address: e.target.value,
                })
              }
              placeholder="Str. Exemplu 10, București, jud. X"
            />
          </div>
        )}

        {(editInfo || prettyDelivery) && (
          <div className={s.metaRow}>
            <span className={s.metaLabel}>Zonă acoperire</span>

            {!editInfo ? (
              <span className={s.metaValue}>{prettyDelivery || "—"}</span>
            ) : (
              <div className={s.metaValue} style={{ width: "100%" }}>
                <ChipsInput
                  value={infoDraft?.deliveryArr || []}
                  onChange={onCountiesChange}
                  suggestions={countySuggestions}
                  placeholder={
                    countiesLoading
                      ? "Se încarcă județele…"
                      : "Toată țara, București, Ilfov, Prahova…"
                  }
                />

                {countiesErr && (
                  <small className={s.errorField}>{countiesErr}</small>
                )}
              </div>
            )}
          </div>
        )}

        {website && (
          <div className={s.metaRow}>
            <span className={s.metaLabel}>Website</span>

            <a
              href={website}
              target="_blank"
              rel="noreferrer"
              className={s.link}
              onClick={() => onTrackCTA("Website click")}
            >
              {website}
            </a>
          </div>
        )}
      </div>

      {editInfo && (
        <div className={s.footer}>
          <button
            type="button"
            className={s.saveBtn}
            onClick={onSaveInfo}
            disabled={savingInfo}
          >
            {savingInfo ? "Salvare…" : "Salvează"}
          </button>
        </div>
      )}
    </section>
  );
}