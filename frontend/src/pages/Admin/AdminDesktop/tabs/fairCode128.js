// src/pages/Admin/AdminDesktop/tabs/fairCode128.js
//
// Decodor Code128 în JavaScript, pentru codul de bare de pe etichetele Târgului
// (POS -> „Scanează cu camera”). Se folosește când browserul nu are
// BarcodeDetector cu Code128 (ex. iPhone / Safari, Firefox, Chrome pe desktop).
// Fără dependențe și fără React - testabil cu node --test.
//
// Metoda (ca la cititoarele 1D clasice): mai multe linii orizontale și verticale
// prin cadru -> prag local -> lățimile barelor -> start A/B/C, simboluri de câte
// 11 module, stop, suma de control. Un rezultat e acceptat doar dacă cel puțin
// două linii citesc exact același text (fără citiri false din zgomot).

// lățimile (bară, spațiu, ...) ale celor 107 simboluri Code128; 106 = STOP (7 elemente)
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
].map((p) => p.split("").map(Number));

const START_A = 103;
const START_B = 104;
const START_C = 105;
const STOP = 106;
const MAX_AVG_VARIANCE = 0.25;
const MAX_ELEMENT_VARIANCE = 0.7;

// cât de diferite sunt lățimile măsurate față de model (0 = identic); Infinity = respins
function patternVariance(runs, offset, pattern) {
  const n = pattern.length;
  let total = 0;
  let modules = 0;
  for (let i = 0; i < n; i += 1) {
    total += runs[offset + i];
    modules += pattern[i];
  }
  if (!total) return Infinity;
  const unit = total / modules;
  let variance = 0;
  for (let i = 0; i < n; i += 1) {
    const diff = Math.abs(runs[offset + i] - pattern[i] * unit);
    if (diff > MAX_ELEMENT_VARIANCE * unit) return Infinity;
    variance += diff;
  }
  return variance / total;
}

function bestSymbol(runs, offset, candidates) {
  let best = -1;
  let bestVariance = MAX_AVG_VARIANCE;
  for (const code of candidates) {
    const v = patternVariance(runs, offset, PATTERNS[code]);
    if (v < bestVariance) {
      bestVariance = v;
      best = code;
    }
  }
  return best;
}

const DATA_CODES = Array.from({ length: 106 }, (_, i) => i);
const START_CODES = [START_A, START_B, START_C];

// valorile simbolurilor (fără start / control / stop) -> text
function symbolsToText(start, values) {
  let set = start === START_A ? "A" : start === START_B ? "B" : "C";
  let shift = false;
  let out = "";
  for (const v of values) {
    const current = shift ? (set === "A" ? "B" : "A") : set;
    shift = false;
    if (current === "C") {
      if (v < 100) out += String(v).padStart(2, "0");
      else if (v === 100) set = "B";
      else if (v === 101) set = "A";
      // 102 = FNC1: ignorat
      continue;
    }
    if (v < 96) {
      if (current === "B") out += String.fromCharCode(v + 32);
      else out += String.fromCharCode(v < 64 ? v + 32 : v - 64);
      continue;
    }
    if (v === 98) shift = true;
    else if (v === 99) set = "C";
    else if (v === 100 && current === "A") set = "B";
    else if (v === 101 && current === "B") set = "A";
    // 96, 97, 102 = FNC; 100 în B / 101 în A = FNC4: ignorate
  }
  return out;
}

/**
 * Decodează o secvență de lățimi (alternant: spațiu sau bară la `firstIsBar`).
 * @param {number[]} runs
 * @param {boolean} firstIsBar
 * @returns {string|null}
 */
export function decodeCode128Runs(runs, firstIsBar) {
  for (let i = firstIsBar ? 0 : 1; i + 6 + 6 + 7 <= runs.length; i += 2) {
    const start = bestSymbol(runs, i, START_CODES);
    if (start < 0) continue;
    // zonă liberă (spațiu alb) înainte de start: cel puțin ~3 module
    let startWidth = 0;
    for (let k = 0; k < 6; k += 1) startWidth += runs[i + k];
    const unit = startWidth / 11;
    if (i > 0 && runs[i - 1] < 3 * unit) continue;

    const values = [];
    let pos = i + 6;
    let ok = false;
    while (pos + 6 <= runs.length) {
      if (pos + 7 <= runs.length && patternVariance(runs, pos, PATTERNS[STOP]) < MAX_AVG_VARIANCE) {
        ok = true;
        break;
      }
      const code = bestSymbol(runs, pos, DATA_CODES);
      if (code < 0) break;
      values.push(code);
      pos += 6;
    }
    if (!ok || values.length < 2) continue;

    const check = values.pop();
    let sum = start;
    values.forEach((v, idx) => {
      sum += v * (idx + 1);
    });
    if (sum % 103 !== check) continue;
    const text = symbolsToText(start, values);
    if (text) return text;
  }
  return null;
}

// o linie de luminozitate -> lățimile zonelor închise / deschise (prag local)
export function lineToRuns(lum) {
  const n = lum.length;
  if (n < 30) return null;
  const prefix = new Float64Array(n + 1);
  let min = 255;
  let max = 0;
  for (let i = 0; i < n; i += 1) {
    prefix[i + 1] = prefix[i] + lum[i];
    if (lum[i] < min) min = lum[i];
    if (lum[i] > max) max = lum[i];
  }
  if (max - min < 40) return null; // fără contrast: nu e un cod de bare
  const half = Math.max(8, Math.round(n / 24));
  const runs = [];
  let firstIsBar = null;
  let current = null;
  let length = 0;
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    const mean = (prefix[b] - prefix[a]) / (b - a);
    const dark = lum[i] < mean - 0.04 * (max - min);
    if (current === null) {
      current = dark;
      firstIsBar = dark;
      length = 1;
    } else if (dark === current) {
      length += 1;
    } else {
      runs.push(length);
      current = dark;
      length = 1;
    }
  }
  runs.push(length);
  return { runs, firstIsBar };
}

function decodeLine(lum) {
  const line = lineToRuns(lum);
  if (!line || line.runs.length < 25) return null;
  const forward = decodeCode128Runs(line.runs, line.firstIsBar);
  if (forward) return forward;
  // eticheta întoarsă cu 180°: aceeași linie, citită invers
  const reversed = line.runs.slice().reverse();
  const lastIsBar = line.runs.length % 2 === 1 ? line.firstIsBar : !line.firstIsBar;
  return decodeCode128Runs(reversed, lastIsBar);
}

/**
 * Caută un cod Code128 într-un cadru (ImageData sau { data, width, height } RGBA).
 * Citește linii orizontale și verticale (eticheta poate fi ținută și rotit).
 * @returns {string|null} textul, doar dacă cel puțin `minAgree` linii îl citesc identic
 */
export function decodeCode128Image(image, { lines = 24, minAgree = 2 } = {}) {
  const { data, width, height } = image || {};
  if (!data || !width || !height) return null;
  const lumAt = (x, y) => {
    const i = (y * width + x) * 4;
    return (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  };
  const votes = new Map();
  const vote = (text) => {
    if (!text) return null;
    const n = (votes.get(text) || 0) + 1;
    votes.set(text, n);
    return n >= minAgree ? text : null;
  };
  for (const horizontal of [true, false]) {
    const span = horizontal ? height : width;
    const length = horizontal ? width : height;
    const lum = new Float32Array(length);
    for (let k = 1; k <= lines; k += 1) {
      const at = Math.min(span - 1, Math.round((span * k) / (lines + 1)));
      for (let p = 0; p < length; p += 1) lum[p] = horizontal ? lumAt(p, at) : lumAt(at, p);
      const found = vote(decodeLine(lum));
      if (found) return found;
    }
  }
  return null;
}
