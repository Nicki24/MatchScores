import type { FormResult, Match, Result, Standing, VirtualLeague } from "../types";
import { clamp, impliedProbabilities, round, scoreDistribution } from "./math";
import { riskLevel, type RiskLevel } from "./sports";

export const normalizeTeam = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Recalcule un classement à partir des résultats (utile quand le site ne montre que les scores). */
export function standingsFromResults(results: Result[]): Standing[] {
  const table = new Map<string, Standing>();
  const get = (team: string) => {
    const key = normalizeTeam(team);
    if (!table.has(key))
      table.set(key, { team, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, form: [] });
    return table.get(key)!;
  };
  for (const r of results) {
    const h = get(r.home);
    const a = get(r.away);
    h.played!++;
    a.played!++;
    h.goalsFor! += r.homeGoals;
    h.goalsAgainst! += r.awayGoals;
    a.goalsFor! += r.awayGoals;
    a.goalsAgainst! += r.homeGoals;
    const [rh, ra]: [FormResult, FormResult] =
      r.homeGoals > r.awayGoals ? ["W", "L"] : r.homeGoals < r.awayGoals ? ["L", "W"] : ["D", "D"];
    for (const [t, res] of [[h, rh], [a, ra]] as const) {
      if (res === "W") (t.won!++, (t.points! += 3));
      else if (res === "D") (t.drawn!++, (t.points! += 1));
      else t.lost!++;
      t.form!.push(res);
    }
  }
  const list = [...table.values()];
  list.sort(
    (x, y) =>
      y.points! - x.points! ||
      y.goalsFor! - y.goalsAgainst! - (x.goalsFor! - x.goalsAgainst!) ||
      y.goalsFor! - x.goalsFor!,
  );
  list.forEach((s, i) => {
    s.position = i + 1;
    s.form = s.form!.slice(-5);
  });
  return list;
}

/** Fusionne classement affiché et classement recalculé (le classement du site est prioritaire). */
export function effectiveStandings(league: VirtualLeague): Standing[] {
  const fromResults = league.results.length ? standingsFromResults(league.results) : [];
  if (!league.standings.length) return fromResults;
  const byKey = new Map(fromResults.map((s) => [normalizeTeam(s.team), s]));
  return league.standings.map((s) => {
    const r = byKey.get(normalizeTeam(s.team));
    return r ? { ...r, ...stripUndefined(s), form: s.form?.length ? s.form : r.form } : s;
  });
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function formScore(form: FormResult[] = []) {
  if (!form.length) return 0.5;
  let total = 0;
  let weight = 0;
  form.forEach((r, i) => {
    const w = i + 1; // les matchs récents pèsent plus
    total += w * (r === "W" ? 1 : r === "D" ? 0.4 : 0);
    weight += w;
  });
  return total / weight;
}

export interface TeamRating {
  standing?: Standing;
  ppg: number;
  attack: number;
  defense: number;
  form: number;
  played: number;
}

function rateTeam(team: string, standings: Standing[], leagueGoalsAvg: number, teamsCount: number): TeamRating {
  const s = standings.find((x) => normalizeTeam(x.team) === normalizeTeam(team));
  const played = s?.played ?? 0;
  let attack = 1;
  let defense = 1;
  let ppg = 1.35;
  if (s && played > 0) {
    if (s.goalsFor != null) attack = (s.goalsFor / played + leagueGoalsAvg) / (2 * leagueGoalsAvg); // régression vers la moyenne
    if (s.goalsAgainst != null) defense = (s.goalsAgainst / played + leagueGoalsAvg) / (2 * leagueGoalsAvg);
    if (s.points != null) ppg = s.points / played;
  } else if (s?.position && teamsCount > 1) {
    // Seule la position est connue : on l'utilise comme indicateur de force.
    const rel = 1 - (s.position - 1) / (teamsCount - 1); // 1 = premier, 0 = dernier
    attack = 0.85 + rel * 0.3;
    defense = 1.15 - rel * 0.3;
    ppg = 0.8 + rel * 1.4;
  }
  return { standing: s, ppg, attack, defense, form: formScore(s?.form), played };
}

export interface VirtualPick {
  label: string;
  description: string;
  probability: number;
  odds?: number;
  /** Espérance de gain par unité misée (négative = défavorable). */
  edge?: number;
  safety: number;
  risk: RiskLevel;
}

export interface VirtualAnalysis {
  match: Match;
  home: TeamRating;
  away: TeamRating;
  expectedGoals: [number, number];
  model: { home: number; draw: number; away: number; over15: number; over25: number; btts: number };
  market?: { home: number; draw: number; away: number; margin: number };
  blended: { home: number; draw: number; away: number };
  modelWeight: number;
  mostLikelyScore: [number, number];
  picks: VirtualPick[];
  best?: VirtualPick;
  insights: string[];
}

const HOME_ADVANTAGE = 1.12;

export function analyzeVirtualMatch(match: Match, league: VirtualLeague, minOdds = 1.15): VirtualAnalysis {
  const standings = effectiveStandings(league);
  const withGoals = standings.filter((s) => s.played && s.goalsFor != null);
  const leagueGoalsAvg = withGoals.length
    ? withGoals.reduce((a, s) => a + s.goalsFor!, 0) / withGoals.reduce((a, s) => a + s.played!, 0)
    : 1.35;

  const home = rateTeam(match.home, standings, leagueGoalsAvg, standings.length);
  const away = rateTeam(match.away, standings, leagueGoalsAvg, standings.length);

  const formAdj = (r: TeamRating) => 0.9 + r.form * 0.2; // ±10 %
  const ppgAdj = (r: TeamRating, o: TeamRating) => clamp(1 + (r.ppg - o.ppg) * 0.08, 0.8, 1.2);
  const lh = clamp(leagueGoalsAvg * home.attack * away.defense * HOME_ADVANTAGE * formAdj(home) * ppgAdj(home, away), 0.2, 4.5);
  const la = clamp((leagueGoalsAvg * away.attack * home.defense * formAdj(away) * ppgAdj(away, home)) / HOME_ADVANTAGE, 0.2, 4.5);
  const dist = scoreDistribution(lh, la);

  const main = match.markets.find((m) => m.key === "1X2" && m.selections.length === 3);
  let market: VirtualAnalysis["market"];
  if (main) {
    const { fair, margin } = impliedProbabilities(main.selections.map((s) => s.odds));
    const p = (l: string) => fair[main.selections.findIndex((s) => s.label === l)] ?? 0;
    market = { home: p("1"), draw: p("X"), away: p("2"), margin };
  }

  // Les cotes du bookmaker intègrent déjà la force des équipes : on ne fait
  // confiance au modèle que proportionnellement aux données disponibles.
  const sample = Math.min(home.played, away.played);
  const hasData = !!(home.standing || away.standing);
  const modelWeight = !market ? 1 : !hasData ? 0 : clamp(sample / (sample + 12), 0.1, 0.45);
  const blend = (m: number, k: number) => (market ? modelWeight * m + (1 - modelWeight) * k : m);
  const blended = {
    home: blend(dist.home, market?.home ?? 0),
    draw: blend(dist.draw, market?.draw ?? 0),
    away: blend(dist.away, market?.away ?? 0),
  };

  const picks: VirtualPick[] = [];
  const oddsOf = (key: string, label: RegExp, line?: number) =>
    match.markets
      .find((m) => m.key === key && (line == null || m.line === line))
      ?.selections.find((s) => label.test(s.label))?.odds;

  const add = (label: string, description: string, probability: number, odds?: number) => {
    const edge = odds ? probability * odds - 1 : undefined;
    let safety = probability * 100;
    if (edge != null) safety += clamp(edge * 40, -8, 6);
    if (market && market.margin > 0.12) safety -= 3;
    safety = clamp(safety, 0, 100);
    picks.push({ label, description, probability, odds, edge, safety: round(safety, 1), risk: riskLevel(safety) });
  };

  add("1", `Victoire ${match.home}`, blended.home, oddsOf("1X2", /^1$/));
  add("X", "Match nul", blended.draw, oddsOf("1X2", /^X$/));
  add("2", `Victoire ${match.away}`, blended.away, oddsOf("1X2", /^2$/));
  add("1X", `${match.home} ou nul`, blended.home + blended.draw, oddsOf("DC", /^1X$/));
  add("X2", `${match.away} ou nul`, blended.away + blended.draw, oddsOf("DC", /^X2$/));
  add("12", "Pas de match nul", blended.home + blended.away, oddsOf("DC", /^12$/));
  add("O1.5", "Plus de 1.5 buts", dist.over15, oddsOf("OU", /^(over|plus|\+)/i, 1.5));
  add("O2.5", "Plus de 2.5 buts", dist.over25, oddsOf("OU", /^(over|plus|\+)/i, 2.5));
  add("U3.5", "Moins de 3.5 buts", 1 - dist.over35, oddsOf("OU", /^(under|moins|-)/i, 3.5));
  add("BTTS", "Les deux équipes marquent", dist.btts, oddsOf("BTTS", /^(oui|yes)/i));

  picks.sort((a, b) => b.safety - a.safety);
  // Le plus sûr parmi les paris jouables (cote connue suffisante, ou cote absente : à vérifier sur le site).
  // On préfère un pari dont la cote est affichée sur le site, sauf s'il est nettement moins sûr.
  const top = picks.find((p) => p.odds == null || p.odds >= minOdds) ?? picks[0];
  const quoted = picks.find((p) => p.odds != null && p.odds >= minOdds);
  const best = quoted && quoted.safety >= top.safety - 10 ? quoted : top;

  const insights: string[] = [];
  const pos = (r: TeamRating) => r.standing?.position;
  if (pos(home) && pos(away)) insights.push(`Classement : ${match.home} ${pos(home)}e vs ${match.away} ${pos(away)}e`);
  if (home.standing?.form?.length) insights.push(`Forme ${match.home} : ${home.standing.form.join("")}`);
  if (away.standing?.form?.length) insights.push(`Forme ${match.away} : ${away.standing.form.join("")}`);
  insights.push(`Buts attendus : ${round(lh, 2)} – ${round(la, 2)} (score probable ${dist.mostLikelyScore.join("-")})`);
  if (market && hasData) {
    const diff = dist.home - market.home;
    if (Math.abs(diff) > 0.08)
      insights.push(
        diff > 0
          ? `Le modèle voit ${match.home} plus fort que la cote ne l'indique (+${round(diff * 100, 0)} pts)`
          : `Le modèle voit ${match.home} plus faible que la cote ne l'indique (${round(diff * 100, 0)} pts)`,
      );
  }
  if (!hasData) insights.push("Aucun classement trouvé : analyse basée uniquement sur les cotes");

  return {
    match,
    home,
    away,
    expectedGoals: [round(lh, 2), round(la, 2)],
    model: { home: dist.home, draw: dist.draw, away: dist.away, over15: dist.over15, over25: dist.over25, btts: dist.btts },
    market,
    blended,
    modelWeight,
    mostLikelyScore: dist.mostLikelyScore,
    picks,
    best,
    insights,
  };
}

export function analyzeLeague(league: VirtualLeague, minOdds?: number) {
  return league.matches
    .map((m) => analyzeVirtualMatch(m, league, minOdds))
    .sort((a, b) => (b.best?.safety ?? 0) - (a.best?.safety ?? 0));
}
