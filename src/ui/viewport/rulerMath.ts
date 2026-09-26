const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];

/** Chooses label (major) and tick (minor) spacing in document pixels for a zoom level. */
export function rulerSteps(cssPxPerDocPx: number): { major: number; minor: number } {
  const major = STEPS.find((s) => s * cssPxPerDocPx >= 56) ?? STEPS[STEPS.length - 1]!;
  let minor = major;
  for (const n of [10, 5, 4, 2]) {
    const m = major / n;
    if (Number.isInteger(m) && m * cssPxPerDocPx >= 5) {
      minor = m;
      break;
    }
  }
  return { major, minor };
}
