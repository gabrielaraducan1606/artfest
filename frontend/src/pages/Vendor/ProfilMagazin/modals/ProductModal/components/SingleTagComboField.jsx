import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "../../../components/css/ProductModal.module.css";

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
   * Caută eticheta aferentă valorii din form.
   *
   * De exemplu:
   * value = "lemn"
   * opțiune = { key: "lemn", label: "Lemn" }
   *
   * În input afișăm "Lemn",
   * dar în form păstrăm "lemn".
   */
  const getDisplayValue = (currentValue) => {
    const normalizedValue =
      String(currentValue ?? "").trim();

    if (!normalizedValue) {
      return "";
    }

    const matchedOption =
      (Array.isArray(options)
        ? options
        : []
      ).find(
        (option) =>
          getOptionKey(option) ===
            normalizedValue ||
          getOptionLabel(option) ===
            normalizedValue
      );

    return matchedOption
      ? getOptionLabel(matchedOption)
      : normalizedValue;
  };

  useEffect(() => {
    setInputValue(
      getDisplayValue(value)
    );
  }, [value, options]);

  useEffect(() => {
    if (!openList) {
      return;
    }

    function handleClickOutside(event) {
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

  const normalize = (valueToNormalize) =>
    String(valueToNormalize ?? "")
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      )
      .toLowerCase()
      .trim();

  const normalizedOptions =
    useMemo(() => {
      if (!Array.isArray(options)) {
        return [];
      }

      const seenKeys =
        new Set();

      return options
        .map((option, index) => {
          const optionKey =
            getOptionKey(option);

          const optionLabel =
            getOptionLabel(option);

          /*
           * Evităm cheile duplicate sau goale.
           */
          const reactKey =
            optionKey ||
            optionLabel ||
            `option-${index}`;

          if (
            !optionKey &&
            !optionLabel
          ) {
            return null;
          }

          /*
           * Eliminăm duplicatele reale.
           */
          const uniqueKey =
            `${optionKey}::${optionLabel}`;

          if (
            seenKeys.has(uniqueKey)
          ) {
            return null;
          }

          seenKeys.add(uniqueKey);

          return {
            key:
              optionKey ||
              optionLabel,

            label:
              optionLabel ||
              optionKey,

            reactKey:
              `${reactKey}-${index}`,
          };
        })
        .filter(Boolean);
    }, [options]);

  const suggestions =
    useMemo(() => {
      const query =
        normalize(inputValue);

      return normalizedOptions
        .filter((option) => {
          if (!query) {
            return true;
          }

          return (
            normalize(
              option.label
            ).includes(query) ||
            normalize(
              option.key
            ).includes(query)
          );
        })
        .slice(0, 20);
    }, [
      normalizedOptions,
      inputValue,
    ]);

  const handleManualChange = (
    event
  ) => {
    const nextValue =
      event.target.value;

    setInputValue(nextValue);

    /*
     * La completare manuală păstrăm exact
     * textul introdus de utilizator.
     */
    onChange?.(nextValue);

    setOpenList(true);
  };

  const handleSelectOption = (
    option
  ) => {
    setInputValue(
      option.label
    );

    /*
     * În form salvăm cheia stabilă,
     * nu întregul obiect.
     */
    onChange?.(
      option.key
    );

    setOpenList(false);
  };

  return (
    <div
      ref={wrapRef}
      style={{
        marginBottom: 12,
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
        value={inputValue}
        placeholder={
          placeholder
        }
        onFocus={() =>
          setOpenList(true)
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
            >
              ×
            </button>
          </div>

          {suggestions.length >
          0 ? (
            suggestions.map(
              (option) => (
                <div
                  key={
                    option.reactKey
                  }
                  className={
                    styles.tagsListItem
                  }
                  onMouseDown={(
                    event
                  ) =>
                    event.preventDefault()
                  }
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