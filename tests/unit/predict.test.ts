import { describe, expect, it } from "vitest";
import { marketsOf } from "../../app/src/core/analysis";
import { backtest, combined, expectedReturn, fitGoals, openingMarkets, predict, scoreGrid } from "../../app/src/core/predict";
import { defaultConfig, VirtualLeague } from "../../app/src/core/sim/engine";
import type { MatchRow, OddsRow } from "../../app/src/core/types";

const T0 = Date.UTC(2026, 0, 1);
const league = new VirtualLeague(defaultConfig({ startedAt: T0, roundSeconds: 120, liveSeconds: 20 }));
const at = (ms: number) => new Date(ms).toISOString();

function oddsRows(key: string, m: ReturnType<VirtualLeague["match"]>, when: number): OddsRow[] {
  const row = (market: string, selection: string, value: number) => ({ match_key: key, market, selection, value, captured_at: at(when), method: "C" as const });
  return [
    row("1X2", "1", m.odds["1X2"][0]),
    row("1X2", "X", m.odds["1X2"][1]),
    row("1X2", "2", m.odds["1X2"][2]),
    row("OU2.5", "Over", m.odds["OU2.5"][0]),
    row("OU2.5", "Under", m.odds["OU2.5"][1]),
    row("BTTS", "Oui", m.odds.BTTS[0]),
    row("BTTS", "Non", m.odds.BTTS[1]),
  ];
}

describe("pronostics", () => {
  it("retrouve les buts attendus à partir des probabilités 1X2 et plus/moins 2.5", () => {
    const grid = scoreGrid(1.6, 0.9);
    let p1 = 0, pX = 0, p2 = 0, over = 0;
    grid.forEach((r, i) => r.forEach((p, j) => { if (i > j) p1 += p; else if (i === j) pX += p; else p2 += p; if (i + j > 2) over += p; }));
    const fit = fitGoals({ p1, pX, p2, over25: over });
    expect(fit.home).toBeCloseTo(1.6, 1);
    expect(fit.away).toBeCloseTo(0.9, 1);
    // Avec le 1X2 seul, le modèle reste cohérent
    const fit1x2 = fitGoals({ p1, pX, p2 });
    expect(Math.abs(fit1x2.home - 1.6)).toBeLessThan(0.15);
    expect(Math.abs(fit1x2.away - 0.9)).toBeLessThan(0.15);
  });

  it("donne l'issue la plus probable, la double chance, le risque et les scores exacts", () => {
    const m = league.match(3, 0, T0);
    const pred = predict(marketsOf(oddsRows("k", m, T0)))!;
    expect(pred.p1 + pred.pX + pred.p2).toBeCloseTo(1, 6);
    expect(pred.outcome.probability).toBe(Math.max(pred.p1, pred.pX, pred.p2));
    expect(pred.safest.probability).toBeGreaterThan(pred.outcome.probability);
    expect(pred.scores).toHaveLength(5);
    expect(pred.scores[0].probability).toBeGreaterThanOrEqual(pred.scores[4].probability);
    expect(pred.scoreSource).toBe("modèle");
    // Le score affiché avec le pronostic va dans le même sens que lui
    const s = pred.scoreFor[pred.outcome.selection as "1" | "X" | "2"]!;
    expect(s.home > s.away ? "1" : s.home === s.away ? "X" : "2").toBe(pred.outcome.selection);
    // Le modèle reproduit les probabilités des cotes
    const g = scoreGrid(pred.expected.home, pred.expected.away);
    const p1 = g.reduce((s, r, i) => s + r.reduce((t, p, j) => t + (i > j ? p : 0), 0), 0);
    expect(Math.abs(p1 - pred.p1)).toBeLessThan(0.02);
    expect(pred.margin).toBeGreaterThan(0.05);
    expect(expectedReturn(pred.margin)).toBeLessThan(0);
  });

  it("utilise le marché « score exact » quand il est relevé", () => {
    const cs = [["1:0", 6.5], ["0:0", 9], ["1:1", 7], ["2:0", 8], ["2:1", 8.5], ["0:1", 11], ["0:2", 19], ["3:0", 15], ["Autre", 4]] as const;
    const rows: OddsRow[] = [
      ...oddsRows("k", league.match(3, 0, T0), T0),
      ...cs.map(([selection, value]) => ({ match_key: "k", market: "CS", selection, value, captured_at: at(T0), method: "C" as const })),
    ];
    const pred = predict(marketsOf(rows))!;
    expect(pred.scoreSource).toBe("marché");
    expect(pred.scores[0]).toMatchObject({ home: 1, away: 0 });
  });

  it("bilan : sur une ligue simulée, les taux réels suivent les probabilités annoncées", () => {
    const matches: MatchRow[] = [];
    const odds = new Map<string, OddsRow[]>();
    for (let slot = 0; slot < 38 * 6; slot++) {
      for (let i = 0; i < 10; i++) {
        const kickoff = T0 + slot * 120_000;
        const m = league.match(slot, i, T0 + 1e12);
        const key = `bet261|${m.id}`;
        matches.push({
          key, source_id: "bet261", external_id: m.id, league: "English League", season: String(m.season), round: m.round,
          home_team: m.home, away_team: m.away, pair: "", kickoff_at: at(kickoff), status: "finished",
          home_score: m.homeGoals, away_score: m.awayGoals, first_seen_at: at(kickoff - 60_000), updated_at: at(kickoff + 20_000 + i), methods: ["C"],
        });
        odds.set(key, oddsRows(key, m, kickoff - 60_000));
      }
    }
    const b = backtest(matches, (k) => odds.get(k) ?? []);
    expect(b.matches).toBe(2280);
    expect(Math.abs(b.outcome.hits - b.outcome.expected) / b.matches).toBeLessThan(0.03);
    expect(Math.abs(b.score.hits - b.score.expected) / b.matches).toBeLessThan(0.02);
    const sure = b.buckets.find((x) => x.label === "très probable")!;
    expect(sure.matches).toBeGreaterThan(100);
    expect(sure.hits / sure.matches).toBeGreaterThan(0.65);
    // La forme récente ne fait pas mieux que les cotes sur les mêmes matchs
    expect(b.form.matches).toBeGreaterThan(500);
    expect(b.form.hits).toBeLessThan(b.form.oddsHits);
  });

  it("cotes d'avant-match et pari combiné", () => {
    const rows: OddsRow[] = [
      { match_key: "k", market: "1X2", selection: "1", value: 1.5, captured_at: at(T0), method: "C" },
      { match_key: "k", market: "1X2", selection: "1", value: 1.2, captured_at: at(T0 + 60_000), method: "C" },
      { match_key: "k", market: "1X2", selection: "X", value: 4, captured_at: at(T0), method: "C" },
      { match_key: "k", market: "1X2", selection: "2", value: 6, captured_at: at(T0), method: "C" },
    ];
    expect(openingMarkets(rows)[0].selections.find((s) => s.selection === "1")!.value).toBe(1.5);
    expect(combined([0.8, 0.7, 0.75])).toBeCloseTo(0.42, 2);
  });
});
