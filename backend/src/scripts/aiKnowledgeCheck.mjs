// backend/src/scripts/aiKnowledgeCheck.mjs
//
// Verificare LOCALĂ, READ-ONLY, a bazei de cunoștințe a AI Assistant-ului
// (backend/src/ai/manifests/*.manifest.js). NU modifică nimic - doar
// raportează posibile inconsistențe, ca omul să decidă ce merită
// corectat. Rulează cu:
//
//   npm run ai:knowledge-check
//
// Verificări făcute (toate deterministe, fără LLM):
//  1. manifeste pe disc dar neînregistrate în index.js (PLATFORM_MANIFESTS)
//  2. id-uri de manifest duplicate
//  3. alias-uri identice, cuvânt cu cuvânt, în mai multe manifeste
//     (pot cauza ambiguitate la retrieval)
//  4. audience/knowledgeAudience cu valori necunoscute (typo de rol)
//  5. uiLocations.path care nu apare, nici măcar parțial, în rutele
//     frontend reale (App.jsx) - best-effort, nu 100% precis pe rute
//     dinamice
//  6. endpoints[].path care nu apare, ca literal, în niciun fișier de
//     rute din backend/src/routes - best-effort
//  7. fișiere citate în notes ("Sursă: X.js, Y.js") care nu (mai)
//     există pe disc
//  8. capabilities cu available:true care nu au niciun endpoint
//     corespunzător în același manifest ȘI nicio mențiune în notes -
//     candidat pentru "afirmat, dar nedocumentat"
//  9. valori numerice (%, lei, RON, MB, zile) găsite în text, listate
//     pentru revizuire manuală - scriptul NU poate ști singur care
//     sunt constante reale din cod și care ar trebui să vină dintr-o
//     sursă centrală, doar le semnalează

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getPlatformManifests } from "../ai/manifests/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");
const MANIFESTS_DIR = path.join(BACKEND_ROOT, "src/ai/manifests");
const ROUTES_DIR = path.join(BACKEND_ROOT, "src/routes");
const FRONTEND_APP_JSX = path.join(
  REPO_ROOT,
  "frontend/src/App.jsx"
);

const KNOWN_ROLES = new Set(["USER", "VENDOR", "GUEST", "ADMIN"]);

const findings = {
  error: [],
  warning: [],
  info: [],
};

function report(level, code, detail) {
  findings[level].push({ code, detail });
}

/* =========================================================
   Helpers de fișiere
========================================================= */

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function walkDir(dir, extensions) {
  const out = [];

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "generated") {
          continue;
        }
        walk(full);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        out.push(full);
      }
    }
  }

  walk(dir);
  return out;
}

function listRouteFiles() {
  return walkDir(ROUTES_DIR, [".js"]);
}

let cachedAllProjectFileNames = null;

/*
 * Set cu toate numele de fișiere (.js/.jsx/.mjs) din backend/src și
 * frontend/src, pentru verificarea citărilor din notes - un fișier
 * poate fi citat corect fără să fie neapărat în src/routes sau
 * src/services (ex: backend/src/ai/copilotRouter.js, sau o
 * componentă React oriunde sub frontend/src).
 */
function getAllProjectFileNames() {
  if (cachedAllProjectFileNames) return cachedAllProjectFileNames;

  const backendFiles = walkDir(
    path.join(BACKEND_ROOT, "src"),
    [".js", ".mjs"]
  );

  const frontendFiles = walkDir(
    path.join(REPO_ROOT, "frontend/src"),
    [".jsx", ".js"]
  );

  // server.js trăiește la rădăcina backend/, nu sub src/
  const topLevelBackendFiles = [
    path.join(BACKEND_ROOT, "server.js"),
  ].filter((f) => fs.existsSync(f));

  cachedAllProjectFileNames = new Set(
    [...backendFiles, ...frontendFiles, ...topLevelBackendFiles].map(
      (f) => path.basename(f)
    )
  );

  return cachedAllProjectFileNames;
}

let cachedRouteFilesContent = null;

function getAllRouteFilesContent() {
  if (cachedRouteFilesContent) return cachedRouteFilesContent;

  cachedRouteFilesContent = listRouteFiles()
    .map((f) => readFileSafe(f) || "")
    .join("\n");

  return cachedRouteFilesContent;
}

let cachedAppJsxContent = null;

function getAppJsxContent() {
  if (cachedAppJsxContent !== null) return cachedAppJsxContent;
  cachedAppJsxContent = readFileSafe(FRONTEND_APP_JSX) || "";
  return cachedAppJsxContent;
}

/*
 * Normalizează un path de endpoint ("/api/vendors/:id/costing") într-un
 * fragment literal căutabil - păstrăm segmentul dinaintea primului
 * parametru dinamic, ca să nu ratăm potriviri din cauza numelui exact
 * al parametrului (":id" vs ":productId").
 */
function endpointSearchFragment(rawPath) {
  if (!rawPath) return null;

  const withoutParams = rawPath.split(/:[a-zA-Z0-9_]+/)[0];
  const trimmed = withoutParams.replace(/\/+$/, "");

  return trimmed.length > 3 ? trimmed : null;
}

/*
 * Rutele Express sunt montate cu prefix ("app.use('/api/x', router)"),
 * iar fișierul de rută conține doar sufixul ("/y"), nu path-ul complet
 * "/api/x/y" - o căutare naivă a path-ului complet, literal, în
 * fișierul de rută eșuează mereu (fals-pozitiv), chiar dacă ruta
 * există. Construim harta prefix -> conținut fișier, parsând
 * server.js o singură dată, ca să putem verifica REMAINDER-ul
 * (sufixul după prefix) în fișierul corect, nu path-ul întreg oriunde.
 */
let cachedMountMap = null;

function getMountMap() {
  if (cachedMountMap) return cachedMountMap;

  const serverJs =
    readFileSafe(path.join(BACKEND_ROOT, "server.js")) || "";

  const importMap = new Map(); // varName -> resolved file path
  for (const m of serverJs.matchAll(
    /import\s+(\w+)\s+from\s+["']([^"']+)["']/g
  )) {
    const [, varName, importPath] = m;
    if (!importPath.startsWith(".")) continue;

    const resolved = path.resolve(
      BACKEND_ROOT,
      importPath.endsWith(".js") ? importPath : `${importPath}.js`
    );

    importMap.set(varName, resolved);
  }

  const mounts = []; // { prefix, content }
  for (const m of serverJs.matchAll(
    /app\.use\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g
  )) {
    const [, prefix, varName] = m;
    const filePath = importMap.get(varName);
    if (!filePath) continue;

    const content = readFileSafe(filePath);
    if (content === null) continue;

    mounts.push({ prefix, content });
  }

  // cele mai lungi prefixe primele, ca să potrivim cel mai specific mount
  mounts.sort((a, b) => b.prefix.length - a.prefix.length);

  cachedMountMap = mounts;
  return mounts;
}

/*
 * Verifică un path complet de endpoint în două moduri: (1) literal,
 * oriunde în toate fișierele de rute (acoperă rutele care scriu
 * path-ul complet direct în router.get(...)); (2) prin prefixul de
 * mount din server.js - dacă path-ul începe cu un prefix montat,
 * verifică dacă SUFIXUL apare în fișierul de rută corespunzător.
 */
function endpointExistsInRoutes(rawPath) {
  const fullFragment = endpointSearchFragment(rawPath);
  if (!fullFragment) return true; // prea scurt ca să verificăm sigur

  const allRoutes = getAllRouteFilesContent();
  if (allRoutes.includes(fullFragment)) return true;

  for (const { prefix, content } of getMountMap()) {
    if (!rawPath.startsWith(prefix)) continue;

    const remainder = rawPath.slice(prefix.length) || "/";
    const remainderFragment = endpointSearchFragment(remainder);

    if (!remainderFragment) return true; // sufix gol/prea scurt - nu putem judeca
    if (content.includes(remainderFragment)) return true;
  }

  return false;
}

function uiPathSearchFragment(rawPath) {
  if (!rawPath) return null;

  // ia doar segmentul de path, ignoră adnotări gen "(tab Import)"
  const firstToken = rawPath.trim().split(/\s+/)[0];

  if (!firstToken.startsWith("/")) return null;

  const withoutParams = firstToken.split(/:[a-zA-Z0-9_]+/)[0];
  const trimmed = withoutParams.replace(/\/+$/, "");

  return trimmed.length > 1 ? trimmed : null;
}

/* =========================================================
   1. Manifeste neînregistrate în index.js
========================================================= */

function checkOrphanedManifestFiles(registeredIds) {
  let files;

  try {
    files = fs
      .readdirSync(MANIFESTS_DIR)
      .filter(
        (f) => f.endsWith(".manifest.js")
      );
  } catch {
    report(
      "warning",
      "manifests-dir-unreadable",
      `Nu am putut citi ${MANIFESTS_DIR}`
    );
    return;
  }

  for (const file of files) {
    const content = readFileSafe(path.join(MANIFESTS_DIR, file)) || "";
    const idMatch = content.match(/id:\s*["']([a-zA-Z0-9_-]+)["']/);
    const declaredId = idMatch?.[1];

    if (declaredId && !registeredIds.has(declaredId)) {
      report(
        "error",
        "orphaned-manifest-file",
        `${file} declară id "${declaredId}" dar nu apare în getPlatformManifests() (index.js) - manifestul nu e importat/înregistrat, deci e complet invizibil pentru retrieval.`
      );
    }
  }
}

/* =========================================================
   Main
========================================================= */

function main() {
  const manifests = getPlatformManifests();

  console.log(
    `\nVerific ${manifests.length} manifeste înregistrate...\n`
  );

  const seenIds = new Map();
  const aliasOwners = new Map(); // normalized alias -> [manifest ids]

  for (const manifest of manifests) {
    const id = manifest.id || "(fără id)";

    /* 2. id duplicat */
    if (seenIds.has(id)) {
      report(
        "error",
        "duplicate-manifest-id",
        `id "${id}" apare de mai multe ori (${seenIds.get(id)} și ${manifest.title || "?"}) - unul dintre ele va fi mereu invizibil/suprascris în retrieval.`
      );
    } else {
      seenIds.set(id, manifest.title || "?");
    }

    /* 3. alias-uri identice între manifeste */
    for (const alias of manifest.aliases || []) {
      const normalized = String(alias).trim().toLowerCase();
      if (!normalized) continue;

      if (!aliasOwners.has(normalized)) {
        aliasOwners.set(normalized, []);
      }
      aliasOwners.get(normalized).push(id);
    }

    /* 4. audience/knowledgeAudience cu roluri necunoscute */
    for (const field of ["audience", "knowledgeAudience"]) {
      const value = manifest[field];
      if (value === undefined) continue;

      if (!Array.isArray(value)) {
        report(
          "error",
          "invalid-audience-field",
          `[${id}] "${field}" nu este un array.`
        );
        continue;
      }

      for (const role of value) {
        if (!KNOWN_ROLES.has(role)) {
          report(
            "error",
            "unknown-role-in-audience",
            `[${id}] "${field}" conține rolul necunoscut "${role}" (roluri valide: ${[...KNOWN_ROLES].join(", ")}).`
          );
        }
      }
    }

    /* 5. uiLocations.path care nu apare în App.jsx */
    const appJsx = getAppJsxContent();

    for (const location of manifest.uiLocations || []) {
      const fragment = uiPathSearchFragment(location?.path);
      if (!fragment) continue;

      if (appJsx && !appJsx.includes(fragment)) {
        report(
          "warning",
          "ui-path-not-found",
          `[${id}] uiLocations.path "${location.path}" (fragment căutat: "${fragment}") nu a fost găsit în App.jsx - verifică dacă ruta încă există sau s-a redenumit (best-effort, poate fi fals-pozitiv pe rute dinamice sau nested).`
        );
      }
    }

    /* 6. endpoints[].path care nu par montate în server.js/rute reale */
    const endpoints = manifest.endpoints || {};
    const basePath = manifest.basePath || "";

    for (const [key, endpoint] of Object.entries(endpoints)) {
      if (!endpoint?.path) continue;

      const fullPath = basePath
        ? `${basePath}${endpoint.path}`.replace(/([^:])\/\//g, "$1/")
        : endpoint.path;

      if (!endpointExistsInRoutes(fullPath)) {
        report(
          "warning",
          "endpoint-path-not-found",
          `[${id}] endpoints.${key}.path "${fullPath}" nu a fost găsit nici literal, nici prin prefixul de mount din server.js - verifică dacă endpoint-ul încă există sau s-a mutat (best-effort: nu acoperă rute construite complet dinamic).`
        );
      }
    }

    /* 7. fișiere citate în notes care nu există pe disc */
    const notes = manifest.notes || "";
    const citedFiles = [
      ...notes.matchAll(/([A-Za-z0-9_][A-Za-z0-9_.]*\.jsx?)/g),
    ].map((m) => m[1]);

    const allProjectFileNames = getAllProjectFileNames();

    for (const fileName of new Set(citedFiles)) {
      const foundOnDisk = allProjectFileNames.has(fileName);

      if (!foundOnDisk) {
        report(
          "info",
          "cited-source-file-not-found",
          `[${id}] notes citează "${fileName}", nu l-am găsit direct în src/routes, src/services sau frontend/src (poate fi într-un subfolder - verificare best-effort, poate fi fals-pozitiv).`
        );
      }
    }

    /* 8. capabilities available:true fără endpoint/notes corespunzător */
    const capabilities = manifest.capabilities || {};
    const hasEndpoints = Object.keys(endpoints).length > 0;
    const hasNotes = notes.trim().length > 0;

    for (const [capKey, cap] of Object.entries(capabilities)) {
      if (cap?.available === true && !hasEndpoints && !hasNotes) {
        report(
          "warning",
          "capability-without-evidence",
          `[${id}] capabilities.${capKey} e available:true, dar manifestul nu are niciun endpoint și nici notes cu sursă - nimic de verificat determinist. Recomandat: adaugă cel puțin un endpoint sau o mențiune în notes.`
        );
      }
    }

    /* 9. valori numerice pentru revizuire manuală */
    const manifestJson = JSON.stringify(manifest);
    const numericMatches = [
      ...manifestJson.matchAll(
        /[0-9]+[.,]?[0-9]*\s?(%|lei|RON|MB|GB|zile|ore)/g
      ),
    ].map((m) => m[0]);

    if (numericMatches.length) {
      report(
        "info",
        "numeric-claim-for-review",
        `[${id}] conține valori numerice: ${[...new Set(numericMatches)].join(", ")} - verifică manual dacă sunt constante reale din cod (documentate în notes) sau ar trebui citite dintr-o sursă centrală/config.`
      );
    }
  }

  checkOrphanedManifestFiles(seenIds);

  for (const [alias, owners] of aliasOwners) {
    if (owners.length > 1) {
      report(
        "warning",
        "duplicate-alias-across-manifests",
        `alias "${alias}" apare identic în manifestele: ${owners.join(", ")} - poate cauza ambiguitate la retrieval (scor egal, ordinea depinde de alte semnale).`
      );
    }
  }

  /* =========================================================
     Raport final
  ========================================================= */

  const levels = [
    ["error", "ERORI (recomandat: reparat)"],
    ["warning", "AVERTISMENTE (verificare recomandată)"],
    ["info", "INFORMATIV (best-effort, poate fi fals-pozitiv)"],
  ];

  let totalIssues = 0;

  for (const [level, label] of levels) {
    const items = findings[level];
    totalIssues += items.length;

    console.log(`\n=== ${label}: ${items.length} ===`);

    for (const item of items) {
      console.log(`  [${item.code}] ${item.detail}`);
    }
  }

  console.log(
    `\nTotal: ${totalIssues} observații pe ${manifests.length} manifeste. Niciun fișier nu a fost modificat.\n`
  );

  process.exit(findings.error.length > 0 ? 1 : 0);
}

main();
