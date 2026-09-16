// src/utils/productConfigurationValidator.test.js
//
// Teste unitare pentru validateProductConfiguration - rulate cu
// test runner-ul nativ din Node (node:test), fără nicio dependință
// nouă de test framework.
//
// Rulare: node --test src/utils/productConfigurationValidator.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateProductConfiguration } from "./productConfigurationValidator.js";

test("produs valid (READY_TO_BUY, fără schema) => 0 blocking, 0 warnings", () => {
  const result = validateProductConfiguration({
    orderMode: "READY_TO_BUY",
    optionsSchema: [],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.blockingIssues, []);
  assert.deepEqual(result.warnings, []);
});

test("produs valid (OPTIONS, câmp select cu label + opțiuni cu label) => 0 blocking", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "culoare",
        label: "Culoare",
        required: true,
        options: [
          { value: "white", label: "Alb" },
          { value: "pink", label: "Roz" },
        ],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.blockingIssues, []);
});

test("choice/select obligatoriu fără opțiuni => blocking EMPTY_REQUIRED_CHOICE", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "culoare",
        label: "Culoare",
        required: true,
        options: [],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.blockingIssues.some(
      (issue) => issue.code === "EMPTY_REQUIRED_CHOICE"
    )
  );
});

test("field required fără key => blocking MISSING_FIELD_KEY", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      { label: "Mărime", required: true },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.blockingIssues.some(
      (issue) => issue.code === "MISSING_FIELD_KEY"
    )
  );
});

test("field required fără label => blocking MISSING_FIELD_LABEL", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      { key: "marime", required: true },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.blockingIssues.some(
      (issue) => issue.code === "MISSING_FIELD_LABEL"
    )
  );
});

test("duplicate option values (după normalizare) => blocking DUPLICATE_OPTION_VALUES", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "culoare",
        label: "Culoare",
        required: true,
        options: [
          { value: "white", label: "Alb" },
          { value: "White", label: "Alb deschis" },
        ],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.blockingIssues.some(
      (issue) =>
        issue.code === "DUPLICATE_OPTION_VALUES"
    )
  );
});

test("unsafe key (__proto__/constructor/prototype) => blocking UNSAFE_FIELD_KEY", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "__proto__",
        label: "Culoare",
        required: true,
        options: [{ value: "a", label: "A" }],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.blockingIssues.some(
      (issue) => issue.code === "UNSAFE_FIELD_KEY"
    )
  );
});

test("repeatedGroup fără key => blocking MISSING_GROUP_KEY", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [],
    customSchema: [],
    repeatedGroups: [
      {
        label: "Membri",
        fields: [
          { key: "nume", label: "Nume", required: true },
        ],
      },
    ],
    quoteSchema: [],
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.blockingIssues.some(
      (issue) => issue.code === "MISSING_GROUP_KEY"
    )
  );
});

test("repeatedGroup fără fields => blocking EMPTY_GROUP_FIELDS", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [],
    customSchema: [],
    repeatedGroups: [
      { key: "membri", label: "Membri", fields: [] },
    ],
    quoteSchema: [],
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.blockingIssues.some(
      (issue) => issue.code === "EMPTY_GROUP_FIELDS"
    )
  );
});

test("technical value fără label human-readable (slug necunoscut în dicționar) => warning TECHNICAL_VALUE_NO_LABEL", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "model",
        label: "Model",
        required: true,
        options: ["extra_large_size", "compact_model_v2"],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, true);

  assert.ok(
    result.warnings.some(
      (issue) =>
        issue.code === "TECHNICAL_VALUE_NO_LABEL" &&
        issue.message.includes("extra_large_size")
    )
  );
});

test("technical value CUNOSCUTĂ în dicționarul optionLabels.js (brown_light) NU declanșează warning", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "culoare",
        label: "Culoare",
        required: true,
        options: ["brown_light", "multicolor"],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, true);
  assert.ok(
    !result.warnings.some(
      (issue) =>
        issue.code === "TECHNICAL_VALUE_NO_LABEL"
    )
  );
});

test("valoare din dicționarul optionLabels.js (ex. white) NU declanșează TECHNICAL_VALUE_NO_LABEL", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "culoare",
        label: "Culoare",
        required: true,
        options: ["white"],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.ok(
    !result.warnings.some(
      (issue) =>
        issue.code === "TECHNICAL_VALUE_NO_LABEL"
    )
  );
});

test("QUOTE_ONLY cu quoteSchema gol => warning VAGUE_QUOTE_SCHEMA, nu blocking", () => {
  const result = validateProductConfiguration({
    orderMode: "QUOTE_ONLY",
    optionsSchema: [],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, true);
  assert.ok(
    result.warnings.some(
      (issue) => issue.code === "VAGUE_QUOTE_SCHEMA"
    )
  );
});

test("QUOTE_ONLY cu quoteSchema populat => fără VAGUE_QUOTE_SCHEMA", () => {
  const result = validateProductConfiguration({
    orderMode: "QUOTE_ONLY",
    optionsSchema: [],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [
      {
        key: "detalii",
        label: "Detalii despre comandă",
        required: false,
      },
    ],
  });

  assert.ok(
    !result.warnings.some(
      (issue) => issue.code === "VAGUE_QUOTE_SCHEMA"
    )
  );
});

test("label generic => warning GENERIC_LABEL", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "camp1",
        label: "camp",
        required: true,
        options: [{ value: "a", label: "A" }],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.ok(
    result.warnings.some(
      (issue) => issue.code === "GENERIC_LABEL"
    )
  );
});

test("required free-text fără description => warning REQUIRED_FREE_TEXT_NO_HELP", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [],
    customSchema: [
      {
        key: "mesaj",
        label: "Mesaj personalizat",
        required: true,
      },
    ],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.ok(
    result.warnings.some(
      (issue) =>
        issue.code === "REQUIRED_FREE_TEXT_NO_HELP"
    )
  );
});

test("câmp complex (multe opțiuni, label neevident) fără description => warning MISSING_DESCRIPTION", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "tip_ambalaj",
        label: "Tip ambalaj",
        required: true,
        options: [
          "a",
          "b",
          "c",
          "d",
          "e",
        ],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.ok(
    result.warnings.some(
      (issue) => issue.code === "MISSING_DESCRIPTION"
    )
  );
});

test("câmp cu label evident (Culoare/Mărime/Material/Cantitate/Model), câteva opțiuni, fără description => NU declanșează MISSING_DESCRIPTION", () => {
  for (const label of [
    "Culoare",
    "Mărime",
    "Material",
    "Cantitate",
    "Model",
  ]) {
    const result = validateProductConfiguration({
      orderMode: "OPTIONS",
      optionsSchema: [
        {
          key: "camp_evident",
          label,
          required: true,
          options: ["a", "b", "c", "d", "e"],
        },
      ],
      customSchema: [],
      repeatedGroups: [],
      quoteSchema: [],
    });

    assert.ok(
      !result.warnings.some(
        (issue) => issue.code === "MISSING_DESCRIPTION"
      ),
      `label "${label}" nu ar trebui să ceară descriere`
    );
  }
});

test("câmp cu label evident dar neobișnuit de multe opțiuni (peste pragul de grupare) tot cere description", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "culoare",
        label: "Culoare",
        required: true,
        options: ["a", "b", "c", "d", "e", "f", "g", "h"],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.ok(
    result.warnings.some(
      (issue) => issue.code === "MISSING_DESCRIPTION"
    )
  );
});

test("valorile canonice grey_light/pink_light/green_dark (backend/constants/colors.js) NU declanșează TECHNICAL_VALUE_NO_LABEL", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [
      {
        key: "culoare",
        label: "Culoare",
        required: true,
        description: "Alege culoarea dorită",
        options: [
          "white",
          "grey_light",
          "pink_light",
          "green_dark",
          "multicolor",
        ],
      },
    ],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(
    result.warnings.filter(
      (issue) => issue.code === "TECHNICAL_VALUE_NO_LABEL"
    ),
    []
  );
});

test("structuri non-array (optionsSchema/customSchema lipsă) => tratate ca [], fără crash", () => {
  const result = validateProductConfiguration({
    orderMode: "READY_TO_BUY",
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.blockingIssues, []);
});

test("field invalid (null în array) => blocking INVALID_FIELD, fără crash", () => {
  const result = validateProductConfiguration({
    orderMode: "OPTIONS",
    optionsSchema: [null],
    customSchema: [],
    repeatedGroups: [],
    quoteSchema: [],
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.blockingIssues.some(
      (issue) => issue.code === "INVALID_FIELD"
    )
  );
});
