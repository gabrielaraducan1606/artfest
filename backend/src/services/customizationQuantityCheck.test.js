// Rulare: node --test src/services/customizationQuantityCheck.test.js
//
// Verificarea AI a cantității la produse personalizate: doar textul public
// al produsului ajunge la AI, rezultat structurat, cache per produs,
// plafon orar, timeout/eroare -> "unclear". Fără apeluri reale (OpenAI fals).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildQuantityFacts,
  buildQuantityPrompt,
  createQuantityChecker,
  parseQuantityKind,
} from "./customizationQuantityCheck.js";

const PRODUCT = {
  id: "p1",
  title: "Cadou personalizat cu fotografii",
  description: "<p>Realizăm produsul din pozele tale.</p>",
  category: "decor",
  customSchema: [{ key: "poze", label: "Fotografii", type: "photo", description: "Încarcă pozele" }],
  updatedAt: "2026-11-01T10:00:00.000Z",
};

const config = { enabled: true, model: "gpt-4.1-mini", timeoutMs: 50, perHour: 2 };
const silent = { warn: () => {} };

function fakeOpenai(outputs) {
  const calls = [];
  return {
    calls,
    responses: {
      create: async (body, options) => {
        calls.push({ body, options });
        const next = outputs.shift();
        if (next instanceof Error) throw next;
        if (next === "hang") {
          return new Promise((_, reject) =>
            options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
          );
        }
        return { output_text: next };
      },
    },
  };
}

test("AI primește doar textul public al produsului (fără fotografii sau date client)", () => {
  const facts = buildQuantityFacts({ ...PRODUCT, customAnswers: { poze: ["https://cdn/x.jpg"] } });
  const prompt = buildQuantityPrompt(facts);

  assert.deepEqual(Object.keys(facts).sort(), ["campuriPersonalizare", "categorie", "descriere", "titlu"]);
  assert.equal(facts.descriere, "Realizăm produsul din pozele tale.");
  assert.ok(!prompt.includes("https://"));
});

test("rezultat structurat: valori necunoscute sau JSON invalid -> unclear", () => {
  assert.equal(parseQuantityKind('{"kind":"per_photo"}'), "per_photo");
  assert.equal(parseQuantityKind('{"kind":"single_product"}'), "single_product");
  assert.equal(parseQuantityKind('{"kind":"20 produse"}'), "unclear");
  assert.equal(parseQuantityKind("nu e json"), "unclear");
});

test("cache per produs: al doilea apel nu mai cheamă AI-ul", async () => {
  const openai = fakeOpenai(['{"kind":"single_product"}']);
  const checker = createQuantityChecker({ openai, config, logger: silent });

  assert.deepEqual(await checker.classify(PRODUCT), { kind: "single_product", source: "ai" });
  assert.deepEqual(await checker.classify(PRODUCT), { kind: "single_product", source: "cache" });
  assert.equal(openai.calls.length, 1);
  assert.equal(openai.calls[0].body.model, "gpt-4.1-mini");
});

test("AI indisponibil, timeout sau dezactivat -> unclear, fără cache", async () => {
  const openai = fakeOpenai([new Error("503"), "hang"]);
  const checker = createQuantityChecker({ openai, config, logger: silent });

  assert.deepEqual(await checker.classify(PRODUCT), { kind: "unclear", source: "error" });
  assert.deepEqual(await checker.classify(PRODUCT), { kind: "unclear", source: "error" });

  const off = createQuantityChecker({ openai: fakeOpenai([]), config: { ...config, enabled: false }, logger: silent });
  assert.deepEqual(await off.classify(PRODUCT), { kind: "unclear", source: "disabled" });
});

test("plafonul orar oprește apelurile AI", async () => {
  const openai = fakeOpenai(['{"kind":"per_photo"}', '{"kind":"per_photo"}', '{"kind":"per_photo"}']);
  const checker = createQuantityChecker({ openai, config, logger: silent });

  await checker.classify({ ...PRODUCT, id: "a" });
  await checker.classify({ ...PRODUCT, id: "b" });
  assert.deepEqual(await checker.classify({ ...PRODUCT, id: "c" }), { kind: "unclear", source: "limit" });
  assert.equal(openai.calls.length, 2);
});
