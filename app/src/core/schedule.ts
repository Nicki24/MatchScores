/**
 * Où en est chaque match : à venir, en direct, joué (résultat pas encore relevé) ou terminé.
 * En base, un match reste « à venir » tant que son résultat n'a pas été lu : l'heure du coup
 * d'envoi et la dernière journée jouée de sa ligue disent s'il a déjà eu lieu.
 */
import type { MatchRow } from "./types";

export type Phase = "upcoming" | "live" | "played" | "finished";

/** Un coup d'envoi passé depuis plus longtemps : le match est commencé, on ne peut plus le pronostiquer. */
const KICKOFF_GRACE_MS = 60_000;
/** Match « en direct » sans nouvelle depuis plus longtemps : il est fini, son résultat n'a pas été vu. */
const LIVE_FRESH_MS = 15 * 60_000;
/** Durée d'un match réel, pauses comprises. */
const REAL_MATCH_MS = 3 * 3600_000;
/** Match sans heure qui n'est plus affiché depuis plus longtemps. */
const UNTIMED_FRESH_MS = 10 * 60_000;
/** Matchs joués pris en compte pour savoir où en est une ligue. */
const RECENT_MS = 30 * 60_000;
/** Écart de journée au-delà duquel une nouvelle saison a commencé (journée 38 → journée 1). */
const SEASON_WRAP = 20;

const leagueKey = (m: Pick<MatchRow, "league" | "season">) => `${m.league ?? ""}|${m.season ?? ""}`;

/** Dernière journée commencée de chaque ligue, d'après ses matchs en direct ou terminés récemment. */
export function playedRounds(matches: MatchRow[], now: number): Map<string, number> {
  const latest = new Map<string, { round: number; at: string }>();
  for (const m of matches) {
    if (m.round == null || m.status === "scheduled" || now - Date.parse(m.updated_at) > RECENT_MS) continue;
    const at = m.kickoff_at ?? m.first_seen_at;
    const k = leagueKey(m);
    const l = latest.get(k);
    if (!l || at > l.at) latest.set(k, { round: m.round, at });
  }
  return new Map([...latest].map(([k, v]) => [k, v.round]));
}

export function phaseOf(m: MatchRow, now: number, played: Map<string, number>): Phase {
  if (m.status === "finished") return "finished";
  const kickoff = m.kickoff_at ? Date.parse(m.kickoff_at) : undefined;
  const age = now - Date.parse(m.updated_at);
  if (m.status === "live") {
    const fresh = age <= LIVE_FRESH_MS || (m.category === "real" && kickoff != null && now - kickoff < REAL_MATCH_MS);
    return fresh ? "live" : "played";
  }
  // Journée déjà commencée dans sa ligue : le match a eu lieu, même si son résultat n'a pas été relevé
  const r = played.get(leagueKey(m));
  if (m.round != null && r != null && m.round <= r && r - m.round < SEASON_WRAP) return "played";
  if (kickoff != null) return kickoff > now - KICKOFF_GRACE_MS ? "upcoming" : "played";
  return age <= UNTIMED_FRESH_MS ? "upcoming" : "played";
}

const byKickoff = (a: MatchRow, b: MatchRow) =>
  (a.kickoff_at ?? "9").localeCompare(b.kickoff_at ?? "9") || (a.round ?? 0) - (b.round ?? 0) || a.home_team.localeCompare(b.home_team);

/** Matchs pas encore joués (et ceux en direct si `live`), du plus proche au plus lointain. */
export function upcomingMatches(matches: MatchRow[], now: number, { live = false } = {}): MatchRow[] {
  const played = playedRounds(matches, now);
  return matches
    .filter((m) => {
      const p = phaseOf(m, now, played);
      return p === "upcoming" || (live && p === "live");
    })
    .sort(byKickoff);
}
