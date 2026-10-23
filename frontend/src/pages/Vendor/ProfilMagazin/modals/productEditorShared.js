// src/pages/Vendor/ProfilMagazin/modals/productEditorShared.js
//
// Părțile PURE ale editorului de produs (fără upload / AI / endpoint-uri
// de vendor), extrase din useProductEditorController.js ca să fie
// folosite IDENTIC și de editorul Admin (AdminProductEditModal.jsx):
//   - listele de opțiuni pentru ProductDetailsSection;
//   - CRUD-ul câmpurilor de cerere ofertă pentru ProductOrderModeSection.

import { useCallback, useMemo } from "react";

import { COLORS_DETAILED } from "../../../../../../backend/src/constants/colors.js";
import { MATERIALS_DETAILED } from "../../../../../../backend/src/constants/materials.js";
import { TECHNIQUES_DETAILED } from "../../../../../../backend/src/constants/tehniques.js";
import { STYLE_TAGS_DETAILED } from "../../../../../../backend/src/constants/stylesTags.js";
import { OCCASION_TAGS_DETAILED } from "../../../../../../backend/src/constants/occasinsTags.js";
import { CARE_TAGS_DETAILED } from "../../../../../../backend/src/constants/careInstructions.js";

const toKeyLabel = (item) => ({ key: item.key, label: item.label });
const toLabel = (item) => item.label;

const MATERIAL_OPTIONS = MATERIALS_DETAILED.map(toKeyLabel);
const TECHNIQUE_OPTIONS = TECHNIQUES_DETAILED.map(toKeyLabel);
const COLOR_OPTIONS = COLORS_DETAILED.map(toKeyLabel);
const STYLE_OPTIONS = STYLE_TAGS_DETAILED.map(toLabel);
const OCCASION_OPTIONS = OCCASION_TAGS_DETAILED.map(toLabel);
const CARE_OPTIONS = CARE_TAGS_DETAILED.map(toLabel);

/*
 * categories: listă de chei (string) sau detaliată ({ key, label, group,
 * groupLabel }) - exact ce primea controllerul.
 */
export function useProductFieldOptions(categoriesInput = []) {
  const categories = useMemo(
    () => (Array.isArray(categoriesInput) ? categoriesInput : []),
    [categoriesInput]
  );

  const isDetailed =
    categories.length > 0 &&
    typeof categories[0] === "object" &&
    categories[0] !== null &&
    "key" in categories[0];

  const options = useMemo(() => {
    if (isDetailed) {
      return categories.map((category) => ({
        key: category.key,
        label: category.label || category.key,
        group: category.group || "alte",
        groupLabel: category.groupLabel || "Altele",
      }));
    }

    return categories.map((key) => ({
      key,
      label: key,
      group: "alte",
      groupLabel: "Altele",
    }));
  }, [categories, isDetailed]);

  const getLabelFor = useCallback(
    (key) => options.find((option) => option.key === key)?.label || key || "",
    [options]
  );

  return {
    options,
    getLabelFor,
    materialOptions: MATERIAL_OPTIONS,
    techniqueOptions: TECHNIQUE_OPTIONS,
    colorOptions: COLOR_OPTIONS,
    styleOptions: STYLE_OPTIONS,
    occasionOptions: OCCASION_OPTIONS,
    careOptions: CARE_OPTIONS,
  };
}

const quoteFieldsOf = (current) =>
  Array.isArray(current.quoteSchema) ? current.quoteSchema : [];

const optionsOf = (field) =>
  Array.isArray(field.options) ? field.options : [];

/*
 * CRUD pe form.quoteSchema - câmpurile sunt identificate prin `id`.
 */
export function useQuoteSchemaEditor(setForm) {
  const addQuoteField = useCallback(() => {
    setForm((current) => {
      const id = `quote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      return {
        ...current,
        quoteSchema: [
          ...quoteFieldsOf(current),
          {
            id,
            key: id,
            label: "",
            type: "text",
            required: true,
            options: [],
          },
        ],
      };
    });
  }, [setForm]);

  const updateQuoteField = useCallback(
    (fieldId, patch) => {
      setForm((current) => ({
        ...current,
        quoteSchema: quoteFieldsOf(current).map((field) =>
          field.id === fieldId ? { ...field, ...patch } : field
        ),
      }));
    },
    [setForm]
  );

  const removeQuoteField = useCallback(
    (fieldId) => {
      setForm((current) => ({
        ...current,
        quoteSchema: quoteFieldsOf(current).filter((field) => field.id !== fieldId),
      }));
    },
    [setForm]
  );

  const addQuoteFieldOption = useCallback(
    (fieldId) => {
      setForm((current) => ({
        ...current,
        quoteSchema: quoteFieldsOf(current).map((field) =>
          field.id === fieldId ? { ...field, options: [...optionsOf(field), ""] } : field
        ),
      }));
    },
    [setForm]
  );

  const updateQuoteFieldOption = useCallback(
    (fieldId, optionIndex, value) => {
      setForm((current) => ({
        ...current,
        quoteSchema: quoteFieldsOf(current).map((field) => {
          if (field.id !== fieldId) return field;
          const options = [...optionsOf(field)];
          options[optionIndex] = value;
          return { ...field, options };
        }),
      }));
    },
    [setForm]
  );

  const removeQuoteFieldOption = useCallback(
    (fieldId, optionIndex) => {
      setForm((current) => ({
        ...current,
        quoteSchema: quoteFieldsOf(current).map((field) =>
          field.id === fieldId
            ? { ...field, options: optionsOf(field).filter((_, index) => index !== optionIndex) }
            : field
        ),
      }));
    },
    [setForm]
  );

  return {
    addQuoteField,
    updateQuoteField,
    removeQuoteField,
    addQuoteFieldOption,
    updateQuoteFieldOption,
    removeQuoteFieldOption,
  };
}
