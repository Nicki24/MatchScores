import { describe, expect, it } from "vitest";
import { marketsOf } from "../../app/src/core/analysis";
import { normalizeJson } from "../../app/src/core/normalize/json";
import { predict } from "../../app/src/core/predict";
import type { OddsRow } from "../../app/src/core/types";

const at = new Date(Date.UTC(2026, 9, 22, 5, 30)).toISOString();
const sel = (name: string, odds: number) => ({ name, odds });
const htft = ["1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"];

/** Un match de football virtuel avec les marchés que bet261 affiche autour du résultat du match. */
const event = (markets: unknown[]) => ({
  events: [{ eventId: "v1", homeTeam: "Bournemouth", awayTeam: "N. Forest", startTime: "2026-10-22T05:52:00Z", round: 33, league: "English League", markets }],
});
const FT = { marketName: "Résultat du match", selections: [sel("1", 1.95), sel("X", 3.6), sel("2", 3.9)] };
const POLLUTERS = [
  { marketName: "Résultat mi-temps", selections: [sel("1", 2.58), sel("X", 2.04), sel("2", 4.96)] },
  { marketName: "1st Half - 1X2", selections: [sel("1", 2.6), sel("X", 2.05), sel("2", 4.9)] },
  { marketName: "Résultat mi-temps/fin de match", selections: htft.map((l, i) => sel(l, 2.92 + i)) },
  { marketName: "HT/FT", selections: htft.map((l, i) => sel(l, 3 + i)) },
  { marketName: "Handicap 1X2", specialValue: "0:1", selections: [sel("1", 4.1), sel("X", 3.9), sel("2", 1.7)] },
  { marketName: "Total Bournemouth", specialValue: "1.5", selections: [sel("Over", 2.4), sel("Under", 1.5)] },
  { marketName: "Total mi-temps", specialValue: "2.5", selections: [sel("Over", 6), sel("Under", 1.1)] },
  { marketName: "Score exact mi-temps", selections: [sel("0:0", 3), sel("1:0", 4), sel("0:1", 6), sel("1:1", 7), sel("2:0", 9)] },
  { marketName: "Équipe qui marque en premier", selections: [sel("1", 1.7), sel("Aucun", 9), sel("2", 2.4)] },
];

describe("marchés autour du résultat du match", () => {
  it("le résultat du match n'est jamais mélangé à la mi-temps, au handicap ou aux autres marchés", () => {
    for (const order of [[FT, ...POLLUTERS], [...POLLUTERS, FT]]) {
      const b = normalizeJson(event(order), at);
      const r = b.odds.filter((o) => o.market === "1X2").map((o) => `${o.selection}:${o.value}`);
      expect(r).toEqual(["1:1.95", "X:3.6", "2:3.9"]);
      expect(b.odds.filter((o) => o.market.startsWith("OU"))).toEqual([]);
      expect(b.odds.filter((o) => o.market === "CS")).toEqual([]);
    }
  });

  it("des cotes déjà enregistrées avec les issues mi-temps/fin de match donnent quand même un pronostic", () => {
    const row = (selection: string, value: number): OddsRow => ({ match_key: "k", market: "1X2", selection, value, captured_at: at, method: "C" });
    const rows = [row("1", 1.95), row("X", 3.6), row("2", 3.9), ...htft.map((s, i) => row(s, 2.92 + i))];
    const m = marketsOf(rows).find((x) => x.market === "1X2")!;
    expect(m.selections.map((s) => s.selection)).toEqual(["1", "X", "2"]);
    expect(m.selections.reduce((s, x) => s + x.probability, 0)).toBeCloseTo(1, 6);
    const p = predict(marketsOf(rows))!;
    expect(p.outcome.selection).toBe("1");
  });
});
