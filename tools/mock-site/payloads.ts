/**
 * Réponses du site de test, dans plusieurs formats plausibles de plateformes de
 * paris (ce ne sont PAS les formats de bet261, invisibles hors de Madagascar) :
 * l'adaptateur générique doit tous les lire sans configuration.
 */
import type { SimMatch, SimState } from "../../app/src/core/sim/engine";

const iso = (ms: number) => new Date(ms).toISOString();
const st = (m: SimMatch) => (m.status === "finished" ? "Finished" : m.status === "live" ? "Live" : "NotStarted");
const fmt = (n: number) => n.toFixed(2);

/** Format 1 : API REST en camelCase (événements + marchés + sélections). */
export function apiRound(s: SimState) {
  return {
    league: { id: 7, name: s.league },
    season: { id: s.season, name: `Saison ${s.season}` },
    round: { number: s.round, startTime: iso(s.matches[0].kickoff) },
    events: s.matches.map((m) => ({
      eventId: m.id,
      homeTeam: { id: m.home.length, name: m.home },
      awayTeam: { id: m.away.length, name: m.away },
      startTime: iso(m.kickoff),
      status: st(m),
      score: m.homeGoals == null ? null : { home: m.homeGoals, away: m.awayGoals },
      markets: [
        { marketName: "1X2", selections: [{ name: "1", odds: fmt(m.odds["1X2"][0]) }, { name: "X", odds: fmt(m.odds["1X2"][1]) }, { name: "2", odds: fmt(m.odds["1X2"][2]) }] },
        { marketName: "Total", specialValue: "2.5", selections: [{ name: "Over", odds: fmt(m.odds["OU2.5"][0]) }, { name: "Under", odds: fmt(m.odds["OU2.5"][1]) }] },
        { marketName: "GG/NG", selections: [{ name: "GG", odds: fmt(m.odds.BTTS[0]) }, { name: "NG", odds: fmt(m.odds.BTTS[1]) }] },
      ],
    })),
  };
}

export function apiStandings(s: SimState) {
  return {
    league: { id: 7, name: s.league },
    season: { id: s.season },
    table: s.standings.map((r) => ({
      position: r.position,
      team: { name: r.team },
      played: r.played,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      points: r.points,
      form: r.form,
    })),
  };
}

export function apiResults(s: SimState, lastRounds = 3) {
  const rounds = new Map<number, SimMatch[]>();
  for (const m of s.results) rounds.set(m.round, [...(rounds.get(m.round) ?? []), m]);
  const keep = [...rounds.keys()].sort((a, b) => b - a).slice(0, lastRounds);
  return {
    league: { id: 7, name: s.league },
    season: { id: s.season },
    rounds: keep.map((r) => ({
      number: r,
      matches: rounds.get(r)!.map((m) => ({ eventId: m.id, home: m.home, away: m.away, result: `${m.homeGoals}:${m.awayGoals}`, status: "Finished" })),
    })),
  };
}

/** Format 2 : trames WebSocket façon SignalR (PascalCase, séparateur \x1e). */
export function wsFrames(s: SimState): string[] {
  const events = (ms: SimMatch[]) =>
    ms.map((m) => ({
      Id: m.id,
      Participants: [
        { Name: m.home, Side: "Home" },
        { Name: m.away, Side: "Away" },
      ],
      StartDate: iso(m.kickoff),
      Status: st(m),
      Score: m.homeGoals == null ? null : `${m.homeGoals}-${m.awayGoals}`,
      Markets: [
        { Name: "Match Result", Outcomes: [{ Name: "Home", Price: m.odds["1X2"][0] }, { Name: "Draw", Price: m.odds["1X2"][1] }, { Name: "Away", Price: m.odds["1X2"][2] }] },
        { Name: "Over/Under 2.5", Outcomes: [{ Name: "Over 2.5", Price: m.odds["OU2.5"][0] }, { Name: "Under 2.5", Price: m.odds["OU2.5"][1] }] },
      ],
    }));
  const lastRound = s.results.filter((m) => m.round === s.round - 1);
  return [
    JSON.stringify({ type: 1, target: "RoundUpdate", arguments: [{ LeagueName: s.league, SeasonNumber: s.season, RoundNumber: s.round, Events: events(s.matches) }] }) + "\x1e",
    JSON.stringify({ type: 1, target: "Results", arguments: [{ LeagueName: s.league, SeasonNumber: s.season, RoundNumber: s.round - 1, Events: events(lastRound) }] }) + "\x1e",
    JSON.stringify({
      type: 1,
      target: "Standings",
      arguments: [
        {
          LeagueName: s.league,
          SeasonNumber: s.season,
          Rows: s.standings.map((r) => ({ Rank: r.position, TeamName: r.team, Played: r.played, Won: r.won, Draw: r.drawn, Lost: r.lost, GoalsFor: r.goalsFor, GoalsAgainst: r.goalsAgainst, Points: r.points })),
        },
      ],
    }) + "\x1e",
  ];
}

/** Vérité terrain pour les tests d'exactitude. */
export function truth(s: SimState) {
  return {
    league: s.league,
    season: s.season,
    round: s.round,
    matches: s.matches.map((m) => ({ id: m.id, round: m.round, home: m.home, away: m.away, kickoff: m.kickoff, status: m.status, odds: m.odds })),
    results: s.results.map((m) => ({ id: m.id, round: m.round, home: m.home, away: m.away, homeGoals: m.homeGoals, awayGoals: m.awayGoals })),
    standings: s.standings,
  };
}
