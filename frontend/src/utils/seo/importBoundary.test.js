// src/utils/seo/importBoundary.test.js
//
// Garantează separarea dintre codul client (src/) și funcțiile serverless
// Vercel (api/):
//
//  1. NICIun fișier din src/ nu importă din frontend/api. În `vite dev`,
//     orice URL care începe cu /api/ este trimis de proxy către backend, deci
//     un import "../../api/_lib/x.js" din React dă 404 (în `vite build`
//     funcționa doar fiindcă fișierele erau bundled - defect vizibil doar
//     în dev).
//  2. Zona shared (src/utils/seo/) e PURĂ: fără API-uri Node/browser și fără
//     importuri în afara folderului - ca să poată fi folosită atât de
//     funcțiile serverless, cât și de bundle-ul React.
//  3. Funcțiile din api/ importă helper-ele SEO din zona shared, nu din
//     api/_lib (care rămâne doar pentru cod server-only, ex. htmlHead.js).
//
// Rulare: node --test src/utils/seo/importBoundary.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(here, "..", "..", "..");
const SRC = join(FRONTEND, "src");
const API = join(FRONTEND, "api");
const SHARED = here;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(js|jsx|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const SPECIFIER_RE =
  /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(source) {
  // fără comentarii, ca "import x from '...'" din exemple să nu conteze
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  return [...code.matchAll(SPECIFIER_RE)].map((m) => m[1] || m[2] || m[3]);
}

const isInside = (file, dir) => {
  const rel = relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !resolve(rel).startsWith("..");
};

/* ---------- 1. src/ nu importă din api/ ---------- */

test("niciun fișier din src/ nu importă din frontend/api (nici relativ, nici prin /api/...)", () => {
  const offenders = [];

  for (const file of walk(SRC)) {
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      const resolved = spec.startsWith(".") ? resolve(dirname(file), spec) : null;

      const intoApiDir = resolved && (resolved === API || resolved.startsWith(API + sep));
      // "/api/x.js" ca modul (nu ca URL de fetch, care nu apare în import)
      const absoluteApi = spec.startsWith("/api/");

      if (intoApiDir || absoluteApi) {
        offenders.push(`${relative(FRONTEND, file)} -> ${spec}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `importuri din api/ în src/:\n${offenders.join("\n")}`);
});

/* ---------- 2. zona shared e pură ---------- */

const FORBIDDEN = [
  [/\bfrom\s*['"]node:/, "import node:*"],
  [/\bfrom\s*['"](fs|path|os|crypto|http|https|url|child_process|stream|util)['"]/, "modul Node"],
  [/\brequire\s*\(/, "require()"],
  [/\bprocess\s*\./, "process.*"],
  [/\b__dirname\b|\b__filename\b/, "__dirname/__filename"],
  [/\bimport\.meta\b/, "import.meta"],
  [/\bBuffer\b/, "Buffer"],
  [/\bnew\s+Response\b|\bnew\s+Request\b/, "Response/Request"],
  [/\bwindow\b|\bdocument\b|\blocalStorage\b|\bsessionStorage\b/, "API de browser"],
  [/\bfetch\s*\(/, "fetch()"],
];

test("zona shared (src/utils/seo) e PURĂ: fără API-uri Node/browser, fără fetch, fără import.meta", () => {
  const files = walk(SHARED).filter((f) => !/\.test\.js$/.test(f));
  assert.ok(files.length >= 4, "zona shared trebuie să conțină helper-ele SEO");

  const problems = [];

  for (const file of files) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    for (const [re, label] of FORBIDDEN) {
      if (re.test(code)) problems.push(`${relative(FRONTEND, file)}: ${label}`);
    }
  }

  assert.deepEqual(problems, []);
});

test("zona shared nu importă nimic din afara ei (doar ./ în același folder)", () => {
  const problems = [];

  for (const file of walk(SHARED).filter((f) => !/\.test\.js$/.test(f))) {
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      const ok = /^\.\/[A-Za-z0-9_-]+\.js$/.test(spec);
      if (!ok) problems.push(`${relative(FRONTEND, file)} -> ${spec}`);
    }
  }

  assert.deepEqual(problems, []);
});

/* ---------- 3. api/ folosește zona shared ---------- */

const SEO_HELPERS = ["structuredData", "collectionSeo", "categorySeo", "pagination"];

test("api/ importă helper-ele SEO din src/utils/seo, nu din api/_lib (care rămâne pentru cod server-only)", () => {
  const problems = [];

  for (const file of walk(API)) {
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      for (const helper of SEO_HELPERS) {
        if (spec.includes("_lib/" + helper)) {
          problems.push(`${relative(FRONTEND, file)} -> ${spec}`);
        }
      }
    }
  }

  assert.deepEqual(problems, []);

  // și nu au rămas fișiere-duplicat în api/_lib
  const libFiles = readdirSync(join(API, "_lib"));
  for (const helper of SEO_HELPERS) {
    assert.ok(!libFiles.includes(helper + ".js"), `${helper}.js a rămas în api/_lib`);
  }
});

test("funcțiile SEO din api/ chiar folosesc zona shared (importurile există și se rezolvă)", () => {
  for (const [file, expected] of [
    ["seo-colectie.js", ["collectionSeo", "pagination"]],
    ["seo-categorie.js", ["categorySeo", "pagination"]],
  ]) {
    const specs = specifiers(readFileSync(join(API, file), "utf8"));
    for (const helper of expected) {
      const spec = specs.find((s) => s.endsWith(`/src/utils/seo/${helper}.js`));
      assert.ok(spec, `${file} nu importă ${helper} din src/utils/seo`);
      assert.ok(isInside(resolve(API, spec), SHARED), `${spec} nu duce în zona shared`);
    }
  }
});
