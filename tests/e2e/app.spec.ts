import { expect, test, type Page } from "@playwright/test";
import { APP, attachCollector, getTruth, MOCK } from "./helpers";

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

/** Comme dans l'appli Android : le collecteur (page bet261) envoie ses messages à l'interface. */
async function pipeline(context: import("@playwright/test").BrowserContext, mode: string) {
  const app = await context.newPage();
  await app.addInitScript(() => {
    (window as unknown as { MSNative: { postMessage(s: string): void }; __native: string[] }).__native = [];
    (window as unknown as { MSNative: { postMessage(s: string): void } }).MSNative = {
      postMessage: (s: string) => (window as unknown as { __native: string[] }).__native.push(s),
    };
  });
  await app.goto(APP);
  await app.evaluate(() => window.__msFromNative?.(JSON.stringify({ t: "app", version: "test" })));
  const site = await context.newPage();
  await attachCollector(site, (m) => {
    app.evaluate((json) => window.__msFromNative?.(json), JSON.stringify(m)).catch(() => {});
  });
  await site.goto(`${MOCK}/virtual?mode=${mode}`);
  await app.evaluate(() => window.__msFromNative?.(JSON.stringify({ t: "collector", visible: false, url: "http://localhost:4173/virtual", loading: false, title: "Virtuels" })));
  return { app, site };
}

async function expectMatchesShown(app: Page) {
  // Les cartes affichées correspondent exactement à la journée en cours du site (équipes + cotes 1X2)
  await expect
    .poll(
      async () => {
        const truth = await getTruth(app);
        const cards = await app.getByTestId("match-card").evaluateAll((els) =>
          els.map((e) => ({
            home: e.querySelector('[data-testid="home"]')?.textContent,
            away: e.querySelector('[data-testid="away"]')?.textContent,
            odds: ["1", "X", "2"].map((s) => e.querySelector(`[data-testid="odd-${s}"]`)?.textContent),
          })),
        );
        const missing = truth.matches.filter(
          (t) => !cards.some((c) => c.home === t.home && c.away === t.away && c.odds.join(" ") === t.odds["1X2"].map((o) => o.toFixed(2)).join(" ")),
        );
        return missing.length;
      },
      { timeout: 40_000, intervals: [1000] },
    )
    .toBe(0);
}

test("chaîne complète — API JSON (méthode C) → base → écrans", async ({ context }) => {
  const { app } = await pipeline(context, "api");
  await expectMatchesShown(app);
  await shot(app, "1-matchs");

  await app.getByTestId("match-card").first().click();
  await expect(app.getByTestId("match-detail")).toBeVisible();
  await expect(app.getByText("Résultat (1X2)")).toBeVisible();
  await shot(app, "2-detail-match");
  await app.getByRole("button", { name: "Retour" }).click();

  await app.getByTestId("tab-results").click();
  await expect(app.getByTestId("result-row").first()).toBeVisible();
  const truth = await getTruth(app);
  const lastRound = Math.max(...truth.results.map((r) => r.round));
  for (const r of truth.results.filter((x) => x.round === lastRound)) {
    await expect(app.getByTestId("result-row").filter({ hasText: r.home }).filter({ hasText: `${r.homeGoals} - ${r.awayGoals}` }).first()).toBeVisible();
  }
  await shot(app, "3-resultats");

  await app.getByTestId("tab-standings").click();
  await expect(app.getByTestId("standings").locator("tbody tr")).toHaveCount(20);
  const first = (await getTruth(app)).standings[0];
  await expect(app.getByTestId("standings").locator("tbody tr").first()).toContainText(first.team);
  await shot(app, "4-classement");

  await app.getByTestId("tab-collect").click();
  await expect(app.getByText("Données reçues")).toBeVisible();
  await shot(app, "5-collecte");

  await app.getByTestId("tab-more").click();
  await expect(app.getByTestId("score-C")).toBeVisible();
  await shot(app, "6-qualite");
  await app.getByTestId("more-journal").click();
  await expect(app.getByTestId("cycle").first()).toBeVisible();
});

test("chaîne complète — texte de la page seulement (méthode D)", async ({ context }) => {
  const { app } = await pipeline(context, "dom");
  await expectMatchesShown(app);
  await app.getByTestId("tab-standings").click();
  await expect(app.getByTestId("standings").locator("tbody tr")).toHaveCount(20);
});

test("chaîne complète — WebSocket et iframe d'une autre origine", async ({ context }) => {
  const ws = await pipeline(context, "ws");
  await expectMatchesShown(ws.app);
  const ifr = await pipeline(context, "iframe");
  await expectMatchesShown(ifr.app);
});

test("démo : l'appli s'utilise sans bet261", async ({ page }) => {
  await page.goto(APP);
  await page.getByTestId("go-demo").click();
  await expect(page.getByTestId("match-card")).toHaveCount(10, { timeout: 15_000 });
  await page.getByTestId("tab-standings").click();
  await expect(page.getByTestId("standings").locator("tbody tr")).toHaveCount(20);
  await page.getByTestId("tab-matches").click();
  await shot(page, "7-demo");
});
