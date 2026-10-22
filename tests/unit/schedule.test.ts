import { describe, expect, it } from "vitest";
import { categorize, categoryResolver } from "../../app/src/core/category";
import { phaseOf, playedRounds, upcomingMatches } from "../../app/src/core/schedule";
import type { MatchRow } from "../../app/src/core/types";

const NOW = Date.UTC(2026, 9, 22, 12, 0);
const iso = (ms: number) => new Date(ms).toISOString();
let n = 0;
const match = (p: Partial<MatchRow>): MatchRow => ({
  key: `k${n++}`,
  source_id: "bet261",
  external_id: `e${n}`,
  league: "English League",
  home_team: `H${n}`,
  away_team: `A${n}`,
  pair: "",
  status: "scheduled",
  first_seen_at: iso(NOW - 5 * 60_000),
  updated_at: iso(NOW - 30_000),
  methods: ["C"],
  category: "virtual",
  ...p,
});

describe("matchs à venir", () => {
  it("écarte un match dont le coup d'envoi est passé, même si son résultat n'a pas été relevé", () => {
    const past = match({ kickoff_at: iso(NOW - 5 * 60_000) });
    const soon = match({ kickoff_at: iso(NOW + 2 * 60_000) });
    expect(upcomingMatches([past, soon], NOW).map((m) => m.key)).toEqual([soon.key]);
  });

  it("écarte les journées déjà commencées de la ligue (sans heure de coup d'envoi)", () => {
    const finished = match({ round: 12, status: "finished", home_score: 1, away_score: 0 });
    const stale = match({ round: 12 });
    const older = match({ round: 11 });
    const next = match({ round: 13 });
    expect(playedRounds([finished, stale, older, next], NOW).get("English League|")).toBe(12);
    expect(upcomingMatches([finished, stale, older, next], NOW).map((m) => m.key)).toEqual([next.key]);
  });

  it("nouvelle saison : la journée 1 suit la journée 38", () => {
    const finished = match({ round: 38, status: "finished", home_score: 1, away_score: 0 });
    const first = match({ round: 1 });
    expect(upcomingMatches([finished, first], NOW).map((m) => m.key)).toEqual([first.key]);
  });

  it("un match « en direct » sans nouvelles depuis 15 min est terminé ; un match réel à venir reste affiché", () => {
    const played = playedRounds([], NOW);
    expect(phaseOf(match({ status: "live", updated_at: iso(NOW - 20 * 60_000) }), NOW, played)).toBe("played");
    expect(phaseOf(match({ status: "live" }), NOW, played)).toBe("live");
    expect(phaseOf(match({ category: "real", kickoff_at: iso(NOW + 2 * 86400_000), updated_at: iso(NOW - 86400_000) }), NOW, played)).toBe("upcoming");
    expect(phaseOf(match({ updated_at: iso(NOW - 30 * 60_000) }), NOW, played)).toBe("played");
  });
});

describe("virtuel ou réel", () => {
  it("d'après la page, l'adresse, la ligue puis la journée", () => {
    expect(categorize({}, { frame: "https://bet261.mg/virtual/football" })).toEqual({ category: "virtual", strong: true });
    expect(categorize({}, { url: "https://vgs.example.com/vfl/events", frame: "https://bet261.mg/" }).category).toBe("virtual");
    expect(categorize({ league: "English League" }, { frame: "https://provider.example/game" })).toEqual({ category: "virtual", strong: true });
    expect(categorize({ league: "Premier League", round: 9 }, { frame: "https://bet261.mg/sport/football/england" })).toEqual({ category: "real", strong: true });
    expect(categorize({ round: 4 }, { frame: "https://bet261.mg/" })).toEqual({ category: "virtual", strong: false });
    expect(categorize({ league: "Premier League" }, { frame: "https://bet261.mg/" })).toEqual({ category: "real", strong: false });
    // « VfL Bochum », « VfB Stuttgart » sont des équipes réelles
    expect(categorize({ league: "Bundesliga" }, { frame: "https://bet261.mg/sport/football/germany/vfl-bochum-vfb-stuttgart" }).category).toBe("real");
  });

  it("toute une ligue suit le classement majoritaire de ses matchs, sauf correction de l'utilisateur", () => {
    const ms = [match({ league: "Liga X", category: "virtual" }), match({ league: "Liga X", category: "virtual" }), match({ league: "Liga X", category: "real" })];
    expect(ms.map(categoryResolver(ms))).toEqual(["virtual", "virtual", "virtual"]);
    expect(ms.map(categoryResolver(ms, { "Liga X": "real" }))).toEqual(["real", "real", "real"]);
  });
});
