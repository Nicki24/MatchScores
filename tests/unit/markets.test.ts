import { describe, expect, it } from "vitest";
import { marketsOf } from "../../app/src/core/analysis";
import { normalizeJson } from "../../app/src/core/normalize/json";
import { normalizeText } from "../../app/src/core/normalize/text";
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

/* ---------- Formats réels possibles (cas trouvés en essayant de piéger la lecture) ---------- */

const FT_SEL = [sel("1", 1.95), sel("X", 3.6), sel("2", 3.9)];
const HT_SEL = [sel("1", 2.58), sel("X", 2.04), sel("2", 4.96)];
const ev = (extra: Record<string, unknown>) => ({ events: [{ eventId: "e1", homeTeam: "Bournemouth", awayTeam: "N. Forest", startTime: "2026-10-22T05:52:00Z", ...extra }] });
const oddsOf = (data: unknown, market = "1X2") =>
  normalizeJson(data, at)
    .odds.filter((o) => o.market === market)
    .map((o) => `${o.selection}:${o.value}`)
    .join(" ");
const FT_ODDS = "1:1.95 X:3.6 2:3.9";

describe("mi-temps, combinés et totaux d'équipe écartés, quel que soit le format", () => {
  it.each([
    "1X2 MT",
    "Résultat MT",
    "MT 1X2",
    "1re MT - 1X2",
    "1X2 à la pause",
    "HT_1X2",
    "1X2_HT",
    "1H 1X2",
    "Mi temps - 1X2",
    "10 Minute Result",
    "Résultat 1-15",
    "1st Half - 1X2",
    "Handicap 1X2",
    "HCP 0:1",
    "1X2 (0:1)",
    "Coups de coin 1X2",
  ])("« %s » placé avant le résultat du match", (name) => {
    expect(oddsOf(ev({ markets: [{ marketName: name, selections: HT_SEL }, { marketName: "Résultat du match", selections: FT_SEL }] }))).toBe(FT_ODDS);
  });

  it("noms portés par des champs variés, groupes, périodes et clés", () => {
    // desc plus précis qu'un title générique ; type numérique
    expect(oddsOf(ev({ markets: [{ id: "60", desc: "1st Half - 1X2", title: "1,X,2", outcomes: HT_SEL }, { desc: "1X2", outcomes: FT_SEL }] }))).toBe(FT_ODDS);
    expect(oddsOf(ev({ markets: [{ type: 2, betTypeName: "Résultat mi-temps", selections: HT_SEL }, { marketName: "1X2", selections: FT_SEL }] }))).toBe(FT_ODDS);
    // groupe parent nommé, clé « periods », champ période
    expect(oddsOf(ev({ marketGroups: [{ name: "1st Half", markets: [{ desc: "1X2", outcomes: HT_SEL }] }, { name: "Main", markets: [{ desc: "1X2", outcomes: FT_SEL }] }] }))).toBe(FT_ODDS);
    expect(oddsOf(ev({ periods: [{ name: "1ère mi-temps", markets: [{ name: "1X2", selections: HT_SEL }] }, { name: "Temps réglementaire", markets: [{ name: "1X2", selections: FT_SEL }] }] }))).toBe(FT_ODDS);
    expect(oddsOf(ev({ odds: [{ period: "HT", markets: [{ name: "1X2", selections: HT_SEL }] }, { period: "FT", markets: [{ name: "1X2", selections: FT_SEL }] }] }))).toBe(FT_ODDS);
    // dictionnaires sous des clés de période
    expect(oddsOf(ev({ odds: { mt: { "1": 2.58, X: 2.04, "2": 4.96 }, ft: { "1": 1.95, X: 3.6, "2": 3.9 } } }))).toBe(FT_ODDS);
    expect(oddsOf(ev({ htOdds: { "1": 2.58, X: 2.04, "2": 4.96 }, odds: { "1": 1.95, N: 3.6, "2": 3.9 } }))).toBe(FT_ODDS);
    // tableaux sous des clés nommées
    const b = normalizeJson(ev({ odds: { DC: [1.25, 1.3, 1.85], "1X2": [1.95, 3.6, 3.9], "OU2.5": [1.8, 2.0], BTTS: [1.7, 2.1] } }), at);
    expect(b.odds.map((o) => `${o.market}:${o.selection}:${o.value}`)).toEqual(
      ["DC:1X:1.25", "DC:12:1.3", "DC:X2:1.85", "1X2:1:1.95", "1X2:X:3.6", "1X2:2:3.9", "OU2.5:Over:1.8", "OU2.5:Under:2", "BTTS:Oui:1.7", "BTTS:Non:2.1"],
    );
  });

  it("combinés et marchés oui / non annexes ne remplacent pas « les deux équipes marquent »", () => {
    const yn = (y: number, n: number) => [sel("Oui", y), sel("Non", n)];
    for (const side of ["1X2 & GG/NG", "Résultat et les deux équipes marquent", "Penalty", "Home to score"]) {
      const b = normalizeJson(ev({ markets: [{ marketName: side, selections: yn(4, 1.2) }, { marketName: "GG/NG", selections: [sel("GG", 1.7), sel("NG", 2.1)] }] }), at);
      expect(b.odds.filter((o) => o.market === "BTTS").map((o) => o.value)).toEqual([1.7, 2.1]);
    }
    expect(oddsOf(ev({ markets: [{ marketName: "Les 2 équipes marquent", selections: yn(1.7, 2.1) }] }), "BTTS")).toBe("Oui:1.7 Non:2.1");
  });

  it("le total d'une équipe ne remplace pas celui du match", () => {
    const ou = (name: string, o: number, u: number) => ({ marketName: name, selections: [sel("Over 2.5", o), sel("Under 2.5", u)] });
    for (const side of ["Home Over/Under 2.5", "Total Nottingham Forest 2.5", "Plus/Moins 2.5 Visiteurs", "Total 1 (2.5)"]) {
      expect(oddsOf(ev({ markets: [ou(side, 4.4, 1.2), ou("Over/Under 2.5", 1.8, 2.0)] }), "OU2.5")).toBe("Over:1.8 Under:2");
    }
    // Plusieurs lignes dans une même liste : un marché par ligne
    const b = normalizeJson(ev({ markets: [{ marketName: "Total", selections: [sel("Over 1.5", 1.3), sel("Under 1.5", 3.4), sel("Over 2.5", 1.8), sel("Under 2.5", 2.0)] }] }), at);
    expect(b.odds.filter((o) => o.market === "OU2.5").map((o) => o.value)).toEqual([1.8, 2.0]);
  });
});

describe("format Sporty-tech (plateforme de bet261)", () => {
  const oc = (id: string, desc: string | undefined, odds: string) => (desc ? { id, desc, odds } : { id, odds });
  const sporty = (markets: unknown[]) => ({ eventId: "sr:match:1", homeTeamName: "Bournemouth", awayTeamName: "N. Forest", estimateStartTime: 1792648320000, markets });

  it("heure de coup d'envoi, double chance et marchés identifiés par leur numéro", () => {
    const b = normalizeJson(
      sporty([
        { id: "60", specifier: "", outcomes: [oc("1", undefined, "2.58"), oc("2", undefined, "2.04"), oc("3", undefined, "4.96")] },
        { id: "1", specifier: "", outcomes: [oc("1", undefined, "1.95"), oc("2", undefined, "3.60"), oc("3", undefined, "3.90")] },
        { id: "10", specifier: "", desc: "Double Chance", outcomes: [oc("9", "Home or Draw", "1.25"), oc("10", "Home or Away", "1.30"), oc("11", "Draw or Away", "1.85")] },
      ]),
      at,
    );
    expect(b.matches[0].kickoff_at).toBe(new Date(1792648320000).toISOString());
    expect(b.odds.map((o) => `${o.market}:${o.selection}:${o.value}`)).toEqual(["1X2:1:1.95", "1X2:X:3.6", "1X2:2:3.9", "DC:1X:1.25", "DC:12:1.3", "DC:X2:1.85"]);
  });

  it("une trame de cotes sans équipes ne crée pas de match fantôme", () => {
    const frame = { eventId: "sr:match:1", markets: [{ id: "60", name: "1st Half - 1X2", outcomes: HT_SEL }] };
    expect(normalizeJson(frame, at).matches).toEqual([]);
    expect(normalizeJson({ eventId: 1, odds: { home: "1.95", draw: "3.40", away: "4.20" } }, at).matches).toEqual([]);
  });

  it("issues aux noms des équipes, dans n'importe quel ordre", () => {
    expect(oddsOf(ev({ markets: [{ marketName: "Match Result", selections: [sel("Bournemouth", 1.95), sel("N. Forest", 3.9), sel("Draw", 3.6)] }] }))).toBe(FT_ODDS);
    expect(oddsOf(ev({ markets: [{ marketName: "Match Odds", selections: [sel("Bournemouth", 1.95), sel("The Draw", 3.6), sel("N. Forest", 3.9)] }] }))).toBe(FT_ODDS);
    // Une liste de minutes n'est pas une cote
    expect(oddsOf(ev({ goalMinutes: [12, 34, 67], markets: [{ marketName: "1X2", selections: FT_SEL }] }))).toBe(FT_ODDS);
  });
});

describe("texte affiché : en-têtes et libellés de marchés", () => {
  const read = (lines: string[]) => {
    const b = normalizeText(["English League", "Journée 33", "08:52", "Arsenal", "Chelsea", ...lines].join("\n"), at);
    return { teams: b.matches.map((m) => `${m.home_team}-${m.away_team}`), odds: b.odds.map((o) => `${o.selection}:${o.value}`).join(" ") };
  };
  const OK = { teams: ["Arsenal-Chelsea"], odds: "1:2.58 X:2.04 2:4.96" };

  it.each([
    ["en-tête entre les équipes et les cotes", ["Résultat final", "1", "2.58", "X", "2.04", "2", "4.96"]],
    ["plus / moins avant le 1X2", ["Plus 2.5", "1.85", "Moins 2.5", "1.95", "1", "2.58", "X", "2.04", "2", "4.96"]],
    ["mi-temps/fin de match avant le 1X2", ["1/1", "2.92", "X/X", "5.10", "1", "2.58", "X", "2.04", "2", "4.96"]],
    ["section « Mi-temps » avant le 1X2", ["Mi-temps", "1", "3.10", "X", "2.05", "2", "5.20", "1X2", "1", "2.58", "X", "2.04", "2", "4.96"]],
    ["libellés Domicile / Nul / Extérieur", ["Domicile", "2.58", "Nul", "2.04", "Extérieur", "4.96"]],
    ["libellés Home / Draw / Away", ["Home", "2.58", "Draw", "2.04", "Away", "4.96"]],
    ["nul écrit « Nul »", ["1", "2.58", "Nul", "2.04", "2", "4.96"]],
    ["sur une seule ligne", ["1 2.58 X 2.04 2 4.96"]],
    ["libellés après les cotes", ["2.58", "1", "2.04", "X", "4.96", "2"]],
    ["section annexe après le 1X2", ["1", "2.58", "X", "2.04", "2", "4.96", "Handicap 1X2 (0:1)", "1", "5.40", "X", "3.90", "2", "1.55", "Mi-temps/Fin de match", "1/1", "2.92", "1/X", "22.76"]],
  ])("%s", (_, lines) => {
    expect(read(lines as string[])).toEqual(OK);
  });

  it("onglet « Résultat mi-temps » choisi pour toute la liste : les matchs sont lus, pas ces cotes", () => {
    const b = normalizeText(["English League", "Journée 33", "Résultat mi-temps", "08:52", "Arsenal", "Chelsea", "2.58  2.04  4.96"].join("\n"), at);
    expect(b.matches.map((m) => m.home_team)).toEqual(["Arsenal"]);
    expect(b.odds).toEqual([]);
  });
});
