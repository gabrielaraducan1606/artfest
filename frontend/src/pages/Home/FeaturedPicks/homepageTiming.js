// src/pages/Home/FeaturedPicks/homepageTiming.js
//
// Instrumentare de timing pentru homepage (doar în dev, doar în consolă),
// separată de componente ca fast refresh să funcționeze.

/*
 * Instrumentare minimă de timing, doar în dev, doar în consolă.
 */
const HP_TIMING_ENABLED =
  typeof window !== "undefined" &&
  typeof performance !== "undefined" &&
  Boolean(import.meta.env?.DEV);

export function markHpTiming(name) {
  if (!HP_TIMING_ENABLED) return;
  try {
    performance.mark(name);
  } catch {
    // ignore
  }
}

export function logHpTimingSummary() {
  if (!HP_TIMING_ENABLED) return;
  try {
    const names = [
      "homepage:mount",
      "homepage:product-fetch-start",
      "homepage:product-fetch-end",
      "homepage:artisan-fetch-start",
      "homepage:artisan-fetch-end",
      "homepage:first-spotlight-paint",
      "homepage:main-image-loaded",
      "homepage:both-features-ready",
    ];
    const entries = names
      .map((name) => performance.getEntriesByName(name, "mark")[0])
      .filter(Boolean);
    if (entries.length < 2) return;
    const t0 = entries[0].startTime;
    console.info(
      "[Homepage] timing (ms de la primul reper):",
      entries
        .map(
          (e) =>
            `${e.name.replace("homepage:", "")}: ${(e.startTime - t0).toFixed(0)}ms`
        )
        .join("  →  ")
    );
  } catch {
    // ignore
  }
}
