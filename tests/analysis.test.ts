import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeMatch, buildCombos, safestPicks } from "../lib/analysis/sports";
import { analyzeVirtualMatch, standingsFromResults } from "../lib/analysis/virtuals";
import { impliedProbabilities, scoreDistribution } from "../lib/analysis/math";
import { demoSnapshot } from "../lib/demo";

test("probabilités implicites sans marge", () => {
  const { fair, margin } = impliedProbabilities([1.9, 3.4, 4.2]);
  assert.ok(Math.abs(fair.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(margin > 0.05 && margin < 0.07);
});

test("distribution de Poisson cohérente", () => {
  const d = scoreDistribution(1.5, 1.1);
  assert.ok(Math.abs(d.home + d.draw + d.away - 1) < 1e-6);
  assert.ok(d.home > d.away);
  assert.ok(d.over15 > d.over25 && d.over25 > d.over35);
});

test("le grand favori obtient le meilleur score de sécurité", () => {
  const snap = demoSnapshot();
  const city = snap.matches.find((m) => m.home === "Manchester City")!;
  const a = analyzeMatch(city);
  assert.equal(a.favorite?.label, "1");
  assert.ok(a.picks[0].probability > 0.7);
  const lens = analyzeMatch(snap.matches.find((m) => m.home === "Lens")!);
  assert.ok(a.picks[0].safety > lens.picks[0].safety);
});

test("conseils et combinés", () => {
  const picks = safestPicks(demoSnapshot().matches);
  assert.ok(picks.length > 5);
  for (let i = 1; i < picks.length; i++) assert.ok(picks[i - 1].safety >= picks[i].safety);
  const combos = buildCombos(picks);
  assert.ok(combos.length >= 1);
  for (const c of combos) assert.equal(new Set(c.legs.map((l) => l.matchId)).size, c.legs.length);
});

test("classement recalculé depuis les résultats", () => {
  const s = standingsFromResults([
    { home: "A", away: "B", homeGoals: 2, awayGoals: 0 },
    { home: "B", away: "C", homeGoals: 1, awayGoals: 1 },
    { home: "C", away: "A", homeGoals: 0, awayGoals: 3 },
  ]);
  assert.equal(s[0].team, "A");
  assert.equal(s[0].points, 6);
  assert.deepEqual(s[0].form, ["W", "W"]);
});

test("analyse d'un match virtuel", () => {
  const league = demoSnapshot().virtual[0];
  const a = analyzeVirtualMatch(league.matches[0], league);
  const sum = a.blended.home + a.blended.draw + a.blended.away;
  assert.ok(Math.abs(sum - 1) < 1e-6);
  assert.ok(a.best);
  assert.ok(a.modelWeight > 0 && a.modelWeight <= 0.45);
});
