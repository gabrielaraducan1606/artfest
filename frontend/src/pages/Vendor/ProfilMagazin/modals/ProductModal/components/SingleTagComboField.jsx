import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "../../../components/css/ProductModal.module.css";

/*
 * Returnează cheia internă a opțiunii.
 *
 * Acceptăm atât:
 * "lemn"
 *
 * cât și:
 * {
 *   key: "lemn",
 *   label: "Lemn"
 * }
 */
function getOptionKey(option) {
  if (
    option &&
    typeof option === "object"
  ) {
    return String(
      option.key ??
        option.value ??
        option.label ??
        ""
    );
  }

  return String(option ?? "");
}

/*
 * Returnează textul afișat utilizatorului.
 */
function getOptionLabel(option) {
  if (
    option &&
    typeof option === "object"
  ) {
    return String(
      option.label ??
        option.name ??
        option.key ??
        option.value ??
        ""
    );
  }

  return String(option ?? "");
}

/*
 * Normalizează textul pentru căutare:
 * - elimină diacriticele;
 * - transformă în litere mici;
 * - elimină spațiile inutile.
 */
function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}

export default function SingleTagComboField({
  id,
  label,
  value,
  onChange,
  options = [],
  placeholder,
  note,
}) {
  const [inputValue, setInputValue] =
    useState("");

  const [openList, setOpenList] =
    useState(false);

  const wrapRef = useRef(null);

  /*
   * Caută eticheta aferentă valorii salvate în form.
   *
   * De exemplu:
   * value = "lemn"
   * option = {
   *   key: "lemn",
   *   label: "Lemn"
   * }
   *
   * În input afișăm "Lemn",
   * dar în form păstrăm "lemn".
   */
  const getDisplayValue =
    useCallback(
      (currentValue) => {
        const normalizedValue =
          String(
            currentValue ?? ""
          ).trim();

        if (!normalizedValue) {
          return "";
        }

        const availableOptions =
          Array.isArray(options)
            ? options
            : [];

        const matchedOption =
          availableOptions.find(
            (option) =>
              getOptionKey(
                option
              ) ===
                normalizedValue ||
              getOptionLabel(
                option
              ) ===
                normalizedValue
          );

        return matchedOption
          ? getOptionLabel(
              matchedOption
            )
          : normalizedValue;
      },
      [options]
    );

  /*
   * Sincronizăm valoarea din form
   * cu textul afișat în input.
   */
  useEffect(() => {
    setInputValue(
      getDisplayValue(value)
    );
  }, [
    value,
    getDisplayValue,
  ]);

  /*
   * Închidem lista când utilizatorul
   * apasă în afara componentei.
   */
  useEffect(() => {
    if (!openList) {
      return undefined;
    }

    function handleClickOutside(
      event
    ) {
      if (
        wrapRef.current &&
        !wrapRef.current.contains(
          event.target
        )
      ) {
        setOpenList(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleClickOutside
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside
      );
    };
  }, [openList]);

  /*
   * Transformăm toate opțiunile într-un format stabil.
   *
   * Acceptăm:
   * ["Lemn", "Metal"]
   *
   * sau:
   * [
   *   {
   *     key: "lemn",
   *     label: "Lemn"
   *   }
   * ]
   */
  const normalizedOptions =
    useMemo(() => {
      if (!Array.isArray(options)) {
        return [];
      }

      const seenOptions =
        new Set();

      return options
        .map(
          (
            option,
            index
          ) => {
            const optionKey =
              getOptionKey(
                option
              ).trim();

            const optionLabel =
              getOptionLabel(
                option
              ).trim();

            if (
              !optionKey &&
              !optionLabel
            ) {
              return null;
            }

            const finalKey =
              optionKey ||
              optionLabel;

            const finalLabel =
              optionLabel ||
              optionKey;

            /*
             * Eliminăm duplicatele după cheia și eticheta lor.
             */
            const uniqueIdentifier =
              `${finalKey}::${finalLabel}`;

            if (
              seenOptions.has(
                uniqueIdentifier
              )
            ) {
              return null;
            }

            seenOptions.add(
              uniqueIdentifier
            );

            return {
              key:
                finalKey,

              label:
                finalLabel,

              reactKey:
                `${uniqueIdentifier}-${index}`,
            };
          }
        )
        .filter(Boolean);
    }, [options]);

  /*
   * Filtrăm sugestiile după textul introdus.
   */
  const suggestions =
    useMemo(() => {
      const query =
        normalizeText(
          inputValue
        );

      return normalizedOptions
        .filter(
          (option) => {
            if (!query) {
              return true;
            }

            return (
              normalizeText(
                option.label
              ).includes(
                query
              ) ||
              normalizeText(
                option.key
              ).includes(
                query
              )
            );
          }
        )
        .slice(
          0,
          20
        );
    }, [
      normalizedOptions,
      inputValue,
    ]);

  /*
   * Completare manuală.
   *
   * Salvăm exact textul introdus.
   */
  const handleManualChange =
    useCallback(
      (event) => {
        const nextValue =
          event.target.value;

        setInputValue(
          nextValue
        );

        onChange?.(
          nextValue
        );

        setOpenList(true);
      },
      [onChange]
    );

  /*
   * Selectarea unei opțiuni din listă.
   *
   * În input afișăm eticheta,
   * iar în form salvăm cheia.
   */
  const handleSelectOption =
    useCallback(
      (option) => {
        setInputValue(
          option.label
        );

        onChange?.(
          option.key
        );

        setOpenList(false);
      },
      [onChange]
    );

  return (
    <div
      ref={wrapRef}
      style={{
        marginBottom:
          12,
      }}
    >
      {label && (
        <label
          className={
            styles.label
          }
          htmlFor={id}
        >
          {label}
        </label>
      )}

      <input
        id={id}
        className={
          styles.input
        }
        value={
          inputValue
        }
        placeholder={
          placeholder
        }
        onFocus={() =>
          setOpenList(
            true
          )
        }
        onChange={
          handleManualChange
        }
        autoComplete="off"
      />

      {note && (
        <div
          style={{
            fontSize:
              "0.7rem",

            opacity:
              0.7,

            marginTop:
              4,
          }}
        >
          {note}
        </div>
      )}

      {openList && (
        <div
          className={
            styles.tagsList
          }
        >
          <div
            className={
              styles.tagsListHeader
            }
          >
            <span
              className={
                styles.tagsListHeaderTitle
              }
            >
              {label ||
                "Sugestii"}
            </span>

            <button
              type="button"
              onClick={() =>
                setOpenList(
                  false
                )
              }
              className={
                styles.tagsListCloseBtn
              }
              aria-label="Închide lista de sugestii"
            >
              ×
            </button>
          </div>

          {suggestions.length >
          0 ? (
            suggestions.map(
              (
                option
              ) => (
                <div
                  key={
                    option.reactKey
                  }
                  className={
                    styles.tagsListItem
                  }
                  onMouseDown={(
                    event
                  ) => {
                    event.preventDefault();
                  }}
                  onClick={() =>
                    handleSelectOption(
                      option
                    )
                  }
                >
                  {
                    option.label
                  }
                </div>
              )
            )
          ) : (
            <div
              className={
                styles.tagsListEmpty
              }
            >
              Nicio sugestie.
            </div>
          )}
        </div>
      )}
    </div>
  );
}