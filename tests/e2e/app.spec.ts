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

test("pronostics : issue la plus probable, moins risqués, scores exacts et bilan", async ({ context }) => {
  const { app } = await pipeline(context, "api");
  await expectMatchesShown(app);
  await app.getByTestId("tab-predictions").click();
  // Une carte par match à venir ; le pronostic est l'issue à la cote la plus basse
  await expect
    .poll(
      async () => {
        const truth = await getTruth(app);
        const upcoming = truth.matches.filter((m) => m.status === "scheduled");
        const cards = await app.getByTestId("prediction-card").evaluateAll((els) =>
          els.map((e) => ({
            home: e.querySelector('[data-testid="pred-home"]')?.textContent,
            away: e.querySelector('[data-testid="pred-away"]')?.textContent,
            outcome: e.querySelector('[data-testid="prediction-outcome"]')?.textContent,
          })),
        );
        // Le pronostic dit en clair qui devrait gagner : « Leeds gagne », « Match nul »
        const wrong = upcoming.filter((m) => {
          const o = m.odds["1X2"];
          const best = o.indexOf(Math.min(...o));
          const label = best === 0 ? `${m.home} gagne` : best === 1 ? "Match nul" : `${m.away} gagne`;
          return !cards.some((c) => c.home === m.home && c.away === m.away && c.outcome === label);
        });
        return upcoming.length === 10 && cards.length === 10 ? wrong.length : -1;
      },
      { timeout: 40_000, intervals: [1000] },
    )
    .toBe(0);
  await expect(app.getByTestId("prediction-scores").first()).toContainText(/Score probable : \d+-\d+/);
  // Les moins risqués : du plus probable au moins probable
  const probs = (await app.getByTestId("safe-probability").allTextContents()).map((t) => Number.parseInt(t, 10));
  expect(probs).toHaveLength(5);
  expect([...probs].sort((a, b) => b - a)).toEqual(probs);
  await shot(app, "8-pronostics");

  await app.getByTestId("prediction-card").first().click();
  await expect(app.getByTestId("detail-prediction")).toBeVisible();
  await expect(app.getByTestId("detail-score")).toHaveCount(5);
  await shot(app, "9-detail-pronostic");
  await app.getByRole("button", { name: "Retour" }).click();

  // Bilan : dès que les matchs pronostiqués sont terminés, ils sont comparés aux résultats
  await expect
    .poll(async () => Number((await app.getByTestId("backtest-matches").textContent({ timeout: 1000 }).catch(() => "0")) ?? 0), { timeout: 45_000, intervals: [2000] })
    .toBeGreaterThanOrEqual(10);
  await expect(app.getByTestId("backtest-outcome")).toBeVisible();
});

test("virtuel et réel ne sont jamais mélangés", async ({ context }) => {
  const { app } = await pipeline(context, "api");
  await expectMatchesShown(app);
  // Un match réel relevé en passant sur la page Sport
  const real = { events: [{ eventId: "real-1", homeTeam: "Arsenal", awayTeam: "Chelsea", startTime: new Date(Date.now() + 86400_000).toISOString(), tournament: "Premier League", odds: { "1": 2.1, X: 3.4, "2": 3.3 } }] };
  await app.evaluate(
    (body) => window.__msFromNative?.(JSON.stringify({ t: "capture", kind: "xhr", url: "https://api.example/api/events", frame: "https://bet261.mg/sport/football", body, at: Date.now() })),
    JSON.stringify(real),
  );
  await app.getByTestId("tab-predictions").click();
  await expect(app.getByTestId("prediction-card").first()).toBeVisible({ timeout: 30_000 });
  await expect(app.getByText("Arsenal")).toHaveCount(0);
  await app.getByTestId("cat-real").click();
  await expect(app.getByTestId("pred-home")).toHaveText(["Arsenal"]);
  await expect(app.getByTestId("prediction-outcome")).toHaveText(["Arsenal gagne"]);
  await app.getByTestId("tab-matches").click();
  await expect(app.getByTestId("match-card")).toHaveCount(1);
  await expect(app.getByTestId("match-card").getByTestId("home")).toHaveText("Arsenal");
  await shot(app, "10-reel");
  await app.getByTestId("cat-virtual").click();
  await expect(app.getByText("Arsenal")).toHaveCount(0);
  await expectMatchesShown(app);
});

/** Résultats enregistrés dans la base de l'appli qui ne sont pas de vrais résultats du site. */
async function inventedResults(app: Page) {
  const stored: string[] = await app.evaluate(async () => {
    const open = indexedDB.open("matchscores");
    const db: IDBDatabase = await new Promise((r, j) => {
      open.onsuccess = () => r(open.result);
      open.onerror = () => j(open.error);
    });
    const all: { status: string; home_team: string; away_team: string; home_score: number; away_score: number; round: number }[] = await new Promise((r) => {
      const q = db.transaction("matches").objectStore("matches").getAll();
      q.onsuccess = () => r(q.result);
    });
    db.close();
    return all.filter((m) => m.status === "finished").map((m) => [m.home_team, m.away_team, m.home_score, m.away_score, m.round].join("|"));
  });
  const known = new Set((await getTruth(app)).results.map((r) => [r.home, r.away, r.homeGoals, r.awayGoals, r.round].join("|")));
  return { stored: stored.length, invented: stored.filter((r) => !known.has(r)) };
}

test("chaîne complète — texte de la page seulement (méthode D)", async ({ context }) => {
  const { app } = await pipeline(context, "dom");
  await expectMatchesShown(app);
  // Le texte affiche « EN DIRECT 1 - 0 » et les heures « 07:56 » : aucun ne doit devenir un résultat
  const from = (await getTruth(app)).round;
  await expect.poll(async () => (await getTruth(app)).round, { timeout: 60_000, intervals: [1000] }).toBeGreaterThan(from + 1);
  await expect.poll(async () => (await inventedResults(app)).stored, { timeout: 20_000 }).toBeGreaterThanOrEqual(10);
  expect((await inventedResults(app)).invented).toEqual([]);
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
