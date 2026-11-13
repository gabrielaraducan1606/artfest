// backend/src/services/containerMemory.js
//
// Memoria ÎNTREGULUI container (Linux, cgroup), nu doar a procesului Node:
// include Chrome (PDF-uri: facturi, etichete), worker-ul HEIC și orice alt
// proces din container. Folosită de uploadMemoryGuard.js (instanța Render de
// 512 MB).
//
//   cgroup v2: memory.current, memory.max, memory.stat (inactive_file)
//   cgroup v1: memory.usage_in_bytes, memory.limit_in_bytes, memory.stat
//              (total_inactive_file / inactive_file)
//
// „Memorie folosită” = consum - cache de fișiere INACTIV (eliberabil oricând
// de kernel) - aceeași regulă ca „working set” în Kubernetes / cAdvisor.
// Cache-ul ACTIV (ex. fișierul temporar al unui upload abia citit) rămâne
// numărat: estimare prudentă.
//
// NU presupune nimic: orice valoare lipsă, nenumerică sau neplauzibilă ->
// { ok: false, reason }, iar apelantul revine la memoria procesului Node.
// Plauzibil = consumul containerului e cel puțin cât procesul curent (altfel
// nu citim cgroup-ul nostru) și limita e între 64 MB și 1 PiB.

import fs from "node:fs";

const MB = 1024 * 1024;
export const CGROUP_ROOT = "/sys/fs/cgroup";
const UNLIMITED_THRESHOLD = 2 ** 50; // ~1 PiB: valorile v1 „fără limită” (9223372036854771712)
const MIN_PLAUSIBLE_LIMIT = 64 * MB;

function readText(fsApi, file) {
  try {
    return String(fsApi.readFileSync(file, "utf8")).trim();
  } catch {
    return null;
  }
}

/** "12345" -> 12345, "max" -> Infinity, altceva -> NaN */
export function parseCgroupBytes(text) {
  if (text === null || text === undefined) return Number.NaN;
  const value = String(text).trim();
  if (value === "max") return Number.POSITIVE_INFINITY;
  if (!/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

/** Valoarea unei chei din memory.stat ("inactive_file 1234"), sau null. */
export function parseMemoryStat(text, keys) {
  if (!text) return null;
  for (const key of keys) {
    const match = String(text).match(new RegExp(`^${key} (\\d+)$`, "m"));
    if (match) return Number(match[1]);
  }
  return null;
}

/** Calea cgroup a procesului din /proc/self/cgroup: { v2: "/x", v1Memory: "/y" } */
export function parseProcSelfCgroup(text) {
  const out = { v2: null, v1Memory: null };
  for (const line of String(text || "").split("\n")) {
    const [, controllers, cgPath] = line.match(/^\d+:([^:]*):(.*)$/) || [];
    if (cgPath === undefined) continue;
    if (controllers === "") out.v2 = cgPath.trim() || "/";
    else if (controllers.split(",").includes("memory")) out.v1Memory = cgPath.trim() || "/";
  }
  return out;
}

function uniqueDirs(root, subPath) {
  const dirs = [];
  if (subPath && subPath !== "/") dirs.push(`${root}${subPath}`);
  dirs.push(root);
  return [...new Set(dirs)];
}

function readV2(fsApi, root, selfPath) {
  for (const dir of uniqueDirs(root, selfPath)) {
    const usage = parseCgroupBytes(readText(fsApi, `${dir}/memory.current`));
    if (!Number.isFinite(usage)) continue;
    const limit = parseCgroupBytes(readText(fsApi, `${dir}/memory.max`));
    const inactive = parseMemoryStat(readText(fsApi, `${dir}/memory.stat`), ["inactive_file"]);
    return { version: "v2", usage, limit, inactive };
  }
  return null;
}

function readV1(fsApi, root, selfPath) {
  for (const dir of uniqueDirs(`${root}/memory`, selfPath)) {
    const usage = parseCgroupBytes(readText(fsApi, `${dir}/memory.usage_in_bytes`));
    if (!Number.isFinite(usage)) continue;
    const limit = parseCgroupBytes(readText(fsApi, `${dir}/memory.limit_in_bytes`));
    const inactive = parseMemoryStat(readText(fsApi, `${dir}/memory.stat`), ["total_inactive_file", "inactive_file"]);
    return { version: "v1", usage, limit, inactive };
  }
  return null;
}

/**
 * @returns {{ ok: true, version: "v1"|"v2", usageBytes: number, inactiveFileBytes: number,
 *             workingSetBytes: number, limitBytes: number|null }
 *         | { ok: false, reason: string }}
 */
export function readContainerMemory({
  fsApi = fs,
  platform = process.platform,
  root = CGROUP_ROOT,
  processRssBytes = process.memoryUsage().rss,
} = {}) {
  if (platform !== "linux") return { ok: false, reason: "not_linux" };

  const self = parseProcSelfCgroup(readText(fsApi, "/proc/self/cgroup"));
  const unified = readText(fsApi, `${root}/cgroup.controllers`) !== null;
  const raw = (unified ? readV2(fsApi, root, self.v2) : null) || readV1(fsApi, root, self.v1Memory);
  if (!raw) return { ok: false, reason: "cgroup_unavailable" };

  const { version, usage, limit, inactive } = raw;
  if (!(usage > 0)) return { ok: false, reason: "invalid_usage" };

  const inactiveFile = Number.isFinite(inactive) && inactive >= 0 ? Math.min(inactive, usage) : 0;
  const workingSet = usage - inactiveFile;

  let limitBytes = null;
  if (Number.isFinite(limit) && limit < UNLIMITED_THRESHOLD) {
    if (limit < MIN_PLAUSIBLE_LIMIT) return { ok: false, reason: "invalid_limit" };
    limitBytes = limit;
  } else if (!(limit === Number.POSITIVE_INFINITY || limit >= UNLIMITED_THRESHOLD)) {
    return { ok: false, reason: "invalid_limit" };
  }

  // confirmare: containerul ÎL CONȚINE pe procesul curent -> consumul lui nu poate fi mai mic
  if (Number(processRssBytes) > 0 && usage < Number(processRssBytes) * 0.8) {
    return { ok: false, reason: "not_own_cgroup" };
  }

  return {
    ok: true,
    version,
    usageBytes: usage,
    inactiveFileBytes: inactiveFile,
    workingSetBytes: workingSet,
    limitBytes,
  };
}
