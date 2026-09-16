// src/components/AIAssistant/Personalization/productPersonalizationFlow.test.js
//
// Teste unitare pentru mecanismul anti-abandon din
// productPersonalizationFlow.js - verifică fallback-ul spre "cerere
// de ofertă" pentru cele două cazuri confirmate ca dead-end.
//
// Rulare: node --test src/components/AIAssistant/Personalization/productPersonalizationFlow.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createFieldQuestionMessage,
  submitProductPersonalizationMessage,
} from "./productPersonalizationFlow.js";

function fakeCreateMessage(role, content, extra = {}) {
  return {
    id: `test-${Math.random()}`,
    role,
    type: "text",
    content,
    ...extra,
  };
}

function fallbackChoice(message) {
  return (message.choices || []).find(
    (choice) =>
      choice.action ===
      "personalization-fallback-quote"
  );
}

test("required choice fără opțiuni => createFieldQuestionMessage întoarce fallback-ul de cerere de ofertă, nu întrebarea", () => {
  const field = {
    key: "culoare",
    label: "Culoare",
    required: true,
    options: [],
  };

  const message = createFieldQuestionMessage({
    field,
    createMessage: fakeCreateMessage,
  });

  assert.equal(message.type, "choices");
  assert.ok(
    message.content.includes(
      "nu a configurat complet"
    )
  );

  const choice = fallbackChoice(message);

  assert.ok(choice, "trebuie să existe choice-ul de fallback");
  assert.equal(
    choice.title,
    "Continuă cu cerere de ofertă"
  );
});

test("required choice CU opțiuni => createFieldQuestionMessage întoarce întrebarea normală, nu fallback-ul", () => {
  const field = {
    key: "culoare",
    label: "Culoare",
    required: true,
    options: [
      { value: "white", label: "Alb" },
      { value: "pink", label: "Roz" },
    ],
  };

  const message = createFieldQuestionMessage({
    field,
    createMessage: fakeCreateMessage,
  });

  assert.ok(!fallbackChoice(message));
  assert.ok(
    message.content
      .toLowerCase()
      .includes("culoare")
  );
});

test("field opțional fără opțiuni => NU declanșează fallback-ul (nu e blocking, e liber să sară)", () => {
  const field = {
    key: "culoare",
    label: "Culoare",
    required: false,
    options: [],
  };

  const message = createFieldQuestionMessage({
    field,
    createMessage: fakeCreateMessage,
  });

  assert.ok(!fallbackChoice(message));
});

test("repeatedGroup fără key/id => fallback-ul apare la pasul group-count, în loc de mesajul tehnic vechi", async () => {
  const messages = [];

  const addMessage = (message) => {
    messages.push(message);
  };

  const personalizationContext = {
    productId: "prod-1",
    productTitle: "Produs test",
    optionsSchema: [],
    customSchema: [],
    repeatedGroups: [
      {
        // fără key, fără id - exact cazul confirmat ca dead-end
        label: "Membri",
        fields: [
          {
            key: "nume",
            label: "Nume",
            required: true,
          },
        ],
      },
    ],
  };

  const personalizationDraft = {
    step: "group-count",
    currentFieldIndex: 0,
    selectedOptions: {},
    customAnswers: {},
    repeatedGroupAnswers: {},
    currentGroupIndex: 0,
    currentMemberIndex: 0,
    currentRepeatedFieldIndex: 0,
  };

  let latestDraft = personalizationDraft;

  await submitProductPersonalizationMessage({
    activeFlow: "product-personalization",
    value: "2",

    personalizationContext,
    personalizationDraft,

    addMessage,
    createMessage: fakeCreateMessage,

    setPersonalizationDraft: (next) => {
      latestDraft =
        typeof next === "function"
          ? next(latestDraft)
          : next;
    },
  });

  const fallbackMessage = messages.find(
    (message) => fallbackChoice(message)
  );

  assert.ok(
    fallbackMessage,
    "trebuie să existe un mesaj cu choice-ul de fallback, nu doar mesajul tehnic vechi"
  );

  assert.ok(
    !messages.some((message) =>
      String(message.content || "").includes(
        "Nu am putut identifica acest grup"
      )
    ),
    "mesajul tehnic vechi nu mai trebuie să apară"
  );
});

test("produs valid existent (câmp cu opțiuni corecte) => comportament neschimbat, fără fallback", async () => {
  const messages = [];

  const addMessage = (message) => {
    messages.push(message);
  };

  const personalizationContext = {
    productId: "prod-2",
    productTitle: "Produs valid",
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
  };

  const personalizationDraft = {
    step: "fields",
    currentFieldIndex: 0,
    selectedOptions: {},
    customAnswers: {},
    repeatedGroupAnswers: {},
    currentGroupIndex: 0,
    currentMemberIndex: 0,
    currentRepeatedFieldIndex: 0,
  };

  let latestDraft = personalizationDraft;

  const handled = await submitProductPersonalizationMessage({
    activeFlow: "product-personalization",
    value: "alb",

    personalizationContext,
    personalizationDraft,

    addMessage,
    createMessage: fakeCreateMessage,

    setPersonalizationDraft: (next) => {
      latestDraft =
        typeof next === "function"
          ? next(latestDraft)
          : next;
    },
  });

  assert.equal(handled, true);

  assert.ok(
    !messages.some((message) =>
      fallbackChoice(message)
    ),
    "un produs configurat corect nu trebuie să declanșeze niciodată fallback-ul"
  );

  assert.equal(
    latestDraft.selectedOptions.culoare,
    "white"
  );
});
