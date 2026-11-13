// src/services/containerMemory.test.js
//
// Memoria CONTAINERULUI pentru protecția uploadurilor de produs (Render 512 MB):
//  - cgroup v2 / v1 citite din fișiere SIMULATE (fără Linux real);
//  - valori lipsă / invalide / neplauzibile -> revenire sigură la procesul Node;
//  - consum ridicat din cauza Chrome (proces separat) -> 503;
//  - comutatorul UPLOAD_MEMORY_SOURCE=process, Windows / local, cache, loguri.
//
// Rulare: node --test src/services/containerMemory.test.js

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { parseCgroupBytes, parseMemoryStat, parseProcSelfCgroup, readContainerMemory } from "./containerMemory.js";
import {
  UploadMemoryBusyError,
  __setContainerMemoryReaderForTests,
  containerMarginBytes,
  currentUploadMemoryState,
  effectiveMemoryLimitBytes,
  ensureUploadMemory,
  uploadMemorySource,
} from "./uploadMemoryGuard.js";

const MB = 1024 * 1024;

afterEach(() => __setContainerMemoryReaderForTests(null));

/** sistem de fișiere simulat: { "/cale": "conținut" } */
function fakeFs(files) {
  return {
    readFileSync(file) {
      if (!(file in files)) {
        const error = new Error(`ENOENT: ${file}`);
        error.code = "ENOENT";
        throw error;
      }
      if (files[file] instanceof Error) throw files[file];
      return files[file];
    },
  };
}

const read = (files, extra = {}) => readContainerMemory({ fsApi: fakeFs(files), platform: "linux", processRssBytes: 150 * MB, ...extra });

function silentLogger() {
  const lines = [];
  return { lines, info: (...args) => lines.push(["info", ...args]), warn: (...args) => lines.push(["warn", ...args]) };
}

/* ======================= citirea cgroup ======================= */

test("parsere: octeți / max / gunoi; memory.stat; /proc/self/cgroup v1 + v2", () => {
  assert.equal(parseCgroupBytes("536870912\n"), 536870912);
  assert.equal(parseCgroupBytes("max"), Infinity);
  assert.ok(Number.isNaN(parseCgroupBytes("-5")));
  assert.ok(Number.isNaN(parseCgroupBytes("12MB")));
  assert.ok(Number.isNaN(parseCgroupBytes(null)));
  assert.equal(parseMemoryStat("anon 10\ninactive_file 4096\nactive_file 7", ["inactive_file"]), 4096);
  assert.equal(parseMemoryStat("total_inactive_file 99\ninactive_file 5", ["total_inactive_file", "inactive_file"]), 99);
  assert.equal(parseMemoryStat("", ["inactive_file"]), null);
  assert.deepEqual(parseProcSelfCgroup("0::/render/svc\n"), { v2: "/render/svc", v1Memory: null });
  assert.deepEqual(parseProcSelfCgroup("12:cpu,cpuacct:/x\n4:memory:/docker/abc\n0::/"), { v2: "/", v1Memory: "/docker/abc" });
});

test("cgroup v2: consum - cache inactiv = memoria folosită; limita reală a containerului", () => {
  const result = read({
    "/proc/self/cgroup": "0::/",
    "/sys/fs/cgroup/cgroup.controllers": "cpu memory",
    "/sys/fs/cgroup/memory.current": String(300 * MB),
    "/sys/fs/cgroup/memory.max": String(512 * MB),
    "/sys/fs/cgroup/memory.stat": `anon ${200 * MB}\ninactive_file ${50 * MB}\nactive_file ${30 * MB}\n`,
  });
  assert.deepEqual(result, {
    ok: true,
    version: "v2",
    usageBytes: 300 * MB,
    inactiveFileBytes: 50 * MB,
    workingSetBytes: 250 * MB,
    limitBytes: 512 * MB,
  });
});

test("cgroup v2 cu cale proprie în /proc/self/cgroup; memory.max=max -> fără limită (folosim pragul configurat)", () => {
  const result = read({
    "/proc/self/cgroup": "0::/render/svc",
    "/sys/fs/cgroup/cgroup.controllers": "memory",
    "/sys/fs/cgroup/render/svc/memory.current": String(220 * MB),
    "/sys/fs/cgroup/render/svc/memory.max": "max",
    "/sys/fs/cgroup/render/svc/memory.stat": "inactive_file 0",
  });
  assert.equal(result.ok, true);
  assert.equal(result.limitBytes, null);
  assert.equal(result.workingSetBytes, 220 * MB);
});

test("cgroup v1 (fallback): usage - total_inactive_file; limita „nelimitată” v1 -> null", () => {
  const files = {
    "/proc/self/cgroup": "4:memory:/docker/abc\n",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes": String(400 * MB),
    "/sys/fs/cgroup/memory/memory.limit_in_bytes": String(512 * MB),
    "/sys/fs/cgroup/memory/memory.stat": `cache ${120 * MB}\ntotal_inactive_file ${100 * MB}\n`,
  };
  const result = read(files);
  assert.equal(result.ok, true);
  assert.equal(result.version, "v1");
  assert.equal(result.workingSetBytes, 300 * MB);
  assert.equal(result.limitBytes, 512 * MB);

  files["/sys/fs/cgroup/memory/memory.limit_in_bytes"] = "9223372036854771712";
  assert.equal(read(files).limitBytes, null);
});

test("valori lipsă sau invalide -> ok:false cu motiv (fără presupuneri)", () => {
  const v2 = (overrides) =>
    read({
      "/proc/self/cgroup": "0::/",
      "/sys/fs/cgroup/cgroup.controllers": "memory",
      "/sys/fs/cgroup/memory.current": String(300 * MB),
      "/sys/fs/cgroup/memory.max": String(512 * MB),
      "/sys/fs/cgroup/memory.stat": "inactive_file 0",
      ...overrides,
    });

  assert.deepEqual(read({}), { ok: false, reason: "cgroup_unavailable" });
  assert.equal(v2({ "/sys/fs/cgroup/memory.current": "nu-e-numar" }).reason, "cgroup_unavailable");
  assert.equal(v2({ "/sys/fs/cgroup/memory.current": "0" }).reason, "invalid_usage");
  assert.equal(v2({ "/sys/fs/cgroup/memory.max": "1000" }).reason, "invalid_limit", "limită absurdă (sub 64 MB)");
  assert.equal(v2({ "/sys/fs/cgroup/memory.max": "abc" }).reason, "invalid_limit");
  assert.equal(v2({ "/sys/fs/cgroup/memory.current": String(50 * MB) }).reason, "not_own_cgroup", "containerul nu poate folosi mai puțin decât procesul");
  const denied = Object.assign(new Error("EACCES"), { code: "EACCES" });
  assert.equal(v2({ "/sys/fs/cgroup/memory.current": denied }).reason, "cgroup_unavailable");

  // memory.stat lipsă: nu scădem nimic (prudent)
  const noStat = v2({ "/sys/fs/cgroup/memory.stat": denied });
  assert.equal(noStat.ok, true);
  assert.equal(noStat.workingSetBytes, 300 * MB);
  // cache inactiv raportat mai mare decât consumul: limitat la consum
  assert.equal(v2({ "/sys/fs/cgroup/memory.stat": `inactive_file ${900 * MB}` }).workingSetBytes, 0);
});

test("Windows / macOS / local: fără cgroup -> not_linux (comportamentul vechi)", () => {
  assert.deepEqual(readContainerMemory({ platform: "win32" }), { ok: false, reason: "not_linux" });
  assert.deepEqual(readContainerMemory({ platform: "darwin" }), { ok: false, reason: "not_linux" });
});

/* ======================= pragul și sursa ======================= */

test("pragul din limita reală a containerului: 512 MB -> ~461 MB; 2 GB -> ~1,8 GB; UPLOAD_MEMORY_LIMIT_MB doar îl coboară", () => {
  assert.equal(containerMarginBytes(512 * MB), Math.round(512 * MB * 0.1));
  assert.equal(effectiveMemoryLimitBytes({ env: {}, containerLimitBytes: 512 * MB }), 512 * MB - Math.round(51.2 * MB));
  assert.equal(effectiveMemoryLimitBytes({ env: {}, containerLimitBytes: 2048 * MB }), 2048 * MB - Math.round(204.8 * MB));
  assert.equal(effectiveMemoryLimitBytes({ env: { UPLOAD_MEMORY_LIMIT_MB: "300" }, containerLimitBytes: 512 * MB }), 300 * MB);
  assert.equal(effectiveMemoryLimitBytes({ env: { UPLOAD_MEMORY_LIMIT_MB: "900" }, containerLimitBytes: 512 * MB }), 512 * MB - Math.round(51.2 * MB));
  assert.equal(effectiveMemoryLimitBytes({ env: {}, containerLimitBytes: null }), 460 * MB, "fără limită cunoscută: ca înainte");
  assert.equal(effectiveMemoryLimitBytes({ env: { UPLOAD_MEMORY_LIMIT_MB: "0" }, containerLimitBytes: 512 * MB }), 0);
  assert.equal(uploadMemorySource({}), "auto");
  assert.equal(uploadMemorySource({ UPLOAD_MEMORY_SOURCE: "process" }), "process");
});

const containerReading = (workingSetMB, limitMB = 512) => ({
  ok: true,
  version: "v2",
  usageBytes: workingSetMB * MB,
  inactiveFileBytes: 0,
  workingSetBytes: workingSetMB * MB,
  limitBytes: limitMB * MB,
});

test("Chrome ocupă memorie (proces separat): Node 150 MB, container 420 MB -> 503 pentru o fotografie de 80 MB", async () => {
  __setContainerMemoryReaderForTests(async () => containerReading(420));
  const logger = silentLogger();
  await assert.rejects(
    ensureUploadMemory(80 * MB, { env: {}, rss: () => 150 * MB, logger }),
    (err) => err instanceof UploadMemoryBusyError && err.status === 503 && err.retryAfterSeconds === 10
  );
  const warn = logger.lines.find(([level]) => level === "warn");
  assert.equal(warn[2].sursa, "cgroup-v2");
  assert.equal(warn[2].containerMB, 420);
  assert.equal(warn[2].rssMB, 150);

  // vechea metodă (doar Node) ar fi lăsat-o să treacă - exact golul acoperit acum
  __setContainerMemoryReaderForTests(async () => containerReading(420));
  await ensureUploadMemory(80 * MB, { env: { UPLOAD_MEMORY_SOURCE: "process" }, rss: () => 150 * MB, logger: silentLogger() });
});

test("comutatorul UPLOAD_MEMORY_SOURCE=process: cgroup-ul nici nu e citit", async () => {
  let reads = 0;
  __setContainerMemoryReaderForTests(async () => {
    reads += 1;
    return containerReading(500);
  });
  const state = await currentUploadMemoryState({ env: { UPLOAD_MEMORY_SOURCE: "process" }, rss: () => 100 * MB, logger: silentLogger() });
  assert.equal(state.source, "process");
  assert.equal(state.usedBytes, 100 * MB);
  assert.equal(state.limitBytes, 460 * MB);
  assert.equal(reads, 0);
});

test("cititor invalid / excepție / null -> revenire sigură la procesul Node, cu motiv în log", async () => {
  for (const reader of [async () => ({ ok: false, reason: "invalid_limit" }), async () => { throw new Error("x"); }, async () => null]) {
    __setContainerMemoryReaderForTests(reader);
    const logger = silentLogger();
    const state = await currentUploadMemoryState({ env: {}, rss: () => 120 * MB, logger });
    assert.equal(state.source, "process");
    assert.equal(state.usedBytes, 120 * MB);
    assert.equal(state.limitBytes, 460 * MB);
    assert.ok(["invalid_limit", "read_error"].includes(state.detail.reason));
    assert.equal(logger.lines[0][0], "info", "diagnosticul spune de ce nu se folosește containerul");
  }
});

test("Windows / local cu cititorul REAL: sursa „process”, prag 460 MB, fără întârziere", async () => {
  __setContainerMemoryReaderForTests(null);
  const t0 = performance.now();
  const state = await currentUploadMemoryState({ env: {}, rss: () => 100 * MB, logger: silentLogger() });
  if (process.platform !== "linux") {
    assert.equal(state.source, "process");
    assert.equal(state.detail.reason, "not_linux");
    assert.equal(state.limitBytes, 460 * MB);
  }
  assert.ok(performance.now() - t0 < 200);
});

test("fotografii obișnuite: memorie suficientă -> fără 503; citirea cgroup e reținută 1 s (fără citiri la fiecare poză)", async () => {
  let reads = 0;
  __setContainerMemoryReaderForTests(async () => {
    reads += 1;
    return containerReading(260);
  });
  const t0 = performance.now();
  for (let i = 0; i < 10; i += 1) {
    await ensureUploadMemory(45 * MB, { env: {}, rss: () => 180 * MB, logger: silentLogger(), now: 1_000_000 + i * 50 });
  }
  assert.equal(reads, 1, "o singură citire în fereastra de 1 s");
  assert.ok(performance.now() - t0 < 100);
});

test("logurile de diagnostic conțin doar cifre și sursa - fără căi, fișiere sau utilizatori", async () => {
  __setContainerMemoryReaderForTests(async () => containerReading(470));
  const logger = silentLogger();
  await ensureUploadMemory(60 * MB, { env: {}, rss: () => 200 * MB, logger }).catch(() => {});
  const text = JSON.stringify(logger.lines);
  assert.doesNotMatch(text, /\/sys|\/proc|cgroup\/|user|@|\.jpg|\.png/i);
  assert.match(text, /protecție memorie/);
  assert.match(text, /memorie insuficientă/);
});
