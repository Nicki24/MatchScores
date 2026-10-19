import { expect, test } from "@playwright/test";
import { attachCollector, getTruth, MOCK, normalizeAll, type CollectorMessage } from "./helpers";

/**
 * Méthodes C et D sur le site de test : le script collecteur doit recopier ce que
 * la page reçoit, quel que soit le mode de livraison, sans les données du compte.
 */
for (const mode of ["api", "ws", "dom", "iframe"] as const) {
  test(`collecteur — mode ${mode}`, async ({ page }) => {
    const msgs: CollectorMessage[] = [];
    await attachCollector(page, (m) => msgs.push(m));
    await page.goto(`${MOCK}/virtual?mode=${mode}`);
    await expect.poll(() => msgs.filter((m) => m.kind === "dom").length, { timeout: 20_000 }).toBeGreaterThan(0);

    const captures = msgs.filter((m) => m.t === "capture");
    // Jamais de données personnelles
    expect(captures.some((m) => m.url.includes("/account/"))).toBe(false);
    if (mode === "api" || mode === "iframe") expect(captures.filter((m) => m.kind === "xhr").length).toBeGreaterThanOrEqual(3);
    if (mode === "ws") expect(captures.some((m) => m.kind === "ws")).toBe(true);
    if (mode === "dom") expect(captures.some((m) => m.kind === "xhr")).toBe(false);
    if (mode === "iframe") expect(captures.some((m) => m.frame?.includes("/provider"))).toBe(true);

    // Exactitude : chaque match à venir est retrouvé avec ses équipes et ses cotes 1X2.
    // La vérité est relue à chaque essai (le site de test change de journée toutes les 20 s).
    let report = "";
    await expect
      .poll(
        async () => {
          const truth = await getTruth(page);
          const batch = normalizeAll(msgs);
          const missing: string[] = [];
          for (const t of truth.matches) {
            const found = batch.matches.find((m) => m.home_team === t.home && m.away_team === t.away && (m.round == null || m.round === t.round));
            const odds = found
              ? [...new Set(batch.odds.filter((o) => o.external_id === found.external_id && o.market === "1X2").map((o) => `${o.selection}:${o.value}`))].sort().join(" ")
              : "";
            const expected = ["1:" + t.odds["1X2"][0], "2:" + t.odds["1X2"][2], "X:" + t.odds["1X2"][1]].sort().join(" ");
            if (!found || odds !== expected) missing.push(`${t.home}-${t.away} (${odds || "absent"} ≠ ${expected})`);
          }
          report = missing.join(", ");
          return missing.length;
        },
        { timeout: 30_000, intervals: [1000] },
      )
      .toBe(0);
    expect(report).toBe("");
    const batch = normalizeAll(msgs);
    expect(batch.standings.length).toBeGreaterThanOrEqual(20);
  });
}
