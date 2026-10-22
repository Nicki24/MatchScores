/**
 * Pronostics des matchs virtuels. Les résultats sont tirés au sort : la meilleure estimation
 * disponible des chances de chaque issue est donnée par les cotes du site, marge retirée.
 * Le score exact vient du marché « score exact » quand il est relevé, sinon d'un modèle de
 * Poisson (buts de chaque équipe) ajusté sur les cotes 1X2 et plus/moins de 2.5 buts.
 * Aucun pronostic n'est une certitude : chaque issue est accompagnée de son risque.
 */
import { marketsOf, type MarketOdds } from "./analysis";
import { teamKey } from "./normalize/util";
import type { MatchRow, OddsRow } from "./types";

export interface ScoreProbability {
  home: number;
  away: number;
  probability: number;
}

export interface Choice {
  market: "1X2" | "DC";
  /** 1, X, 2 ou 1X, X2, 12. */
  selection: string;
  probability: number;
  /** Cote affichée par le site pour cette issue, si elle a été relevée. */
  odds?: number;
}

export type Confidence = "très probable" | "probable" | "incertain";

export interface Prediction {
  /** Probabilités du résultat (1 / X / 2), marge du bookmaker retirée. */
  p1: number;
  pX: number;
  p2: number;
  /** Marge du bookmaker sur le marché 1X2 (0.07 = 7 %). */
  margin: number;
  /** Résultat le plus probable. */
  outcome: Choice;
  /** Double chance la plus probable (deux issues sur trois). */
  safest: Choice;
  confidence: Confidence;
  /** Buts attendus de chaque équipe. */
  expected: { home: number; away: number };
  /** Scores exacts les plus probables. */
  scores: ScoreProbability[];
  /** Score le plus probable pour chaque issue (1, X, 2) : celui qui va avec le pronostic. */
  scoreFor: Partial<Record<"1" | "X" | "2", ScoreProbability>>;
  scoreSource: "marché" | "modèle";
  over25: number;
  btts: number;
}

const MAX_GOALS = 10;

function pmf(lambda: number): number[] {
  const out = [Math.exp(-lambda)];
  for (let k = 1; k <= MAX_GOALS; k++) out.push((out[k - 1] * lambda) / k);
  return out;
}

/** Probabilités de chaque score (buts à domicile × buts à l'extérieur), buts indépendants. */
export function scoreGrid(home: number, away: number): number[][] {
  const ph = pmf(home);
  const pa = pmf(away);
  return ph.map((x) => pa.map((y) => x * y));
}

function summarize(grid: number[][]) {
  let p1 = 0;
  let pX = 0;
  let p2 = 0;
  let over25 = 0;
  let btts = 0;
  for (let i = 0; i < grid.length; i++)
    for (let j = 0; j < grid[i].length; j++) {
      const p = grid[i][j];
      if (i > j) p1 += p;
      else if (i === j) pX += p;
      else p2 += p;
      if (i + j > 2) over25 += p;
      if (i > 0 && j > 0) btts += p;
    }
  return { p1, pX, p2, over25, btts };
}

/** Buts attendus de chaque équipe qui reproduisent au mieux les probabilités des cotes. */
export function fitGoals(target: { p1: number; pX: number; p2: number; over25?: number }): { home: number; away: number } {
  const ph = new Float64Array(MAX_GOALS + 1);
  const pa = new Float64Array(MAX_GOALS + 1);
  const fill = (out: Float64Array, l: number) => {
    out[0] = Math.exp(-l);
    for (let k = 1; k <= MAX_GOALS; k++) out[k] = (out[k - 1] * l) / k;
  };
  const error = (h: number, a: number) => {
    fill(ph, h);
    fill(pa, a);
    let p1 = 0;
    let pX = 0;
    let over = 0;
    let total = 0;
    for (let i = 0; i <= MAX_GOALS; i++)
      for (let j = 0; j <= MAX_GOALS; j++) {
        const p = ph[i] * pa[j];
        total += p;
        if (i > j) p1 += p;
        else if (i === j) pX += p;
        if (i + j > 2) over += p;
      }
    const p2 = total - p1 - pX;
    let e = (p1 - target.p1) ** 2 + (pX - target.pX) ** 2 + (p2 - target.p2) ** 2;
    if (target.over25 != null) e += (over - target.over25) ** 2;
    return e;
  };
  let best = { h: 1.3, a: 1.1, e: Infinity };
  for (let h = 0.2; h <= 5; h += 0.25)
    for (let a = 0.2; a <= 5; a += 0.25) {
      const e = error(h, a);
      if (e < best.e) best = { h, a, e };
    }
  // Affinage autour du meilleur point
  for (let step = 0.1; step >= 0.005; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [dh, da] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ]) {
        const h = best.h + dh;
        const a = best.a + da;
        if (h < 0.05 || a < 0.05) continue;
        const e = error(h, a);
        if (e < best.e) {
          best = { h, a, e };
          improved = true;
        }
      }
    }
  }
  return { home: best.h, away: best.a };
}

const fair = (m?: MarketOdds) => (m ? new Map(m.selections.map((s) => [s.selection, s.probability])) : undefined);
const SCORE_RE = /^(\d{1,2})\s*[-:]\s*(\d{1,2})$/;

export function confidenceOf(p: number): Confidence {
  return p >= 0.7 ? "très probable" : p >= 0.55 ? "probable" : "incertain";
}

const cache = new Map<string, Prediction | undefined>();

/** Pronostic d'un match à partir de ses cotes (dernières valeurs relevées). */
export function predict(markets: MarketOdds[]): Prediction | undefined {
  const m1x2 = markets.find((m) => m.market === "1X2");
  if (!m1x2 || m1x2.selections.length !== 3) return undefined;
  const ou = markets.find((m) => m.market === "OU2.5");
  const cs = markets.find((m) => m.market === "CS");
  const key = JSON.stringify(markets.map((m) => [m.market, m.selections.map((s) => [s.selection, s.value])]));
  if (cache.has(key)) return cache.get(key);

  const p = fair(m1x2)!;
  const [p1, pX, p2] = [p.get("1") ?? 0, p.get("X") ?? 0, p.get("2") ?? 0];
  const over = fair(ou)?.get("Over");
  const goals = fitGoals({ p1, pX, p2, over25: over });
  const grid = scoreGrid(goals.home, goals.away);
  const model = summarize(grid);

  let scores: ScoreProbability[] = [];
  let scoreSource: Prediction["scoreSource"] = "modèle";
  const csScores = (cs?.selections ?? []).map((s) => ({ m: s.selection.match(SCORE_RE), probability: s.probability })).filter((s) => s.m);
  if (csScores.length >= 6) {
    scores = csScores.map((s) => ({ home: Number(s.m![1]), away: Number(s.m![2]), probability: s.probability }));
    scoreSource = "marché";
  } else {
    for (let i = 0; i < grid.length; i++) for (let j = 0; j < grid[i].length; j++) scores.push({ home: i, away: j, probability: grid[i][j] });
  }
  scores.sort((a, b) => b.probability - a.probability);
  const scoreFor: Prediction["scoreFor"] = {};
  for (const s of scores) {
    const o = s.home > s.away ? "1" : s.home === s.away ? "X" : "2";
    scoreFor[o] ??= s;
  }

  const odds1x2 = new Map(m1x2.selections.map((s) => [s.selection, s.value]));
  const outcome = (["1", "X", "2"] as const).map((s) => ({ market: "1X2" as const, selection: s, probability: p.get(s) ?? 0, odds: odds1x2.get(s) })).sort((a, b) => b.probability - a.probability)[0];
  const dcOdds = new Map((markets.find((m) => m.market === "DC")?.selections ?? []).map((s) => [s.selection, s.value]));
  const safest = [
    { market: "DC" as const, selection: "1X", probability: p1 + pX },
    { market: "DC" as const, selection: "X2", probability: pX + p2 },
    { market: "DC" as const, selection: "12", probability: p1 + p2 },
  ]
    .map((d) => ({ ...d, odds: dcOdds.get(d.selection) }))
    .sort((a, b) => b.probability - a.probability)[0];

  const result: Prediction = {
    p1,
    pX,
    p2,
    margin: m1x2.margin,
    outcome,
    safest,
    confidence: confidenceOf(outcome.probability),
    expected: goals,
    scores: scores.slice(0, 5),
    scoreFor,
    scoreSource,
    over25: over ?? model.over25,
    btts: fair(markets.find((m) => m.market === "BTTS"))?.get("Oui") ?? model.btts,
  };
  if (cache.size > 2000) cache.clear();
  cache.set(key, result);
  return result;
}

/** Cotes d'avant-match : la première valeur relevée de chaque issue. */
export function openingMarkets(rows: OddsRow[]): MarketOdds[] {
  const first = new Map<string, OddsRow>();
  for (const r of rows) {
    const k = `${r.market}|${r.selection}`;
    const f = first.get(k);
    if (!f || r.captured_at < f.captured_at) first.set(k, r);
  }
  return marketsOf([...first.values()]);
}

export const outcomeOf = (m: Pick<MatchRow, "home_score" | "away_score">) =>
  m.home_score! > m.away_score! ? "1" : m.home_score === m.away_score ? "X" : "2";

/** Gain moyen d'une mise sur ce marché, à long terme (négatif : la marge du bookmaker). */
export const expectedReturn = (margin: number) => 1 / (1 + margin) - 1;

export interface BacktestBucket {
  label: Confidence;
  matches: number;
  hits: number;
  expected: number;
}

export interface Backtest {
  matches: number;
  outcome: { hits: number; expected: number };
  score: { hits: number; expected: number };
  buckets: BacktestBucket[];
  /** Pronostic « équipe en meilleure forme » comparé au favori des cotes sur les mêmes matchs. */
  form: { matches: number; hits: number; oddsHits: number };
}

const POINTS = { "1": [3, 0], X: [1, 1], "2": [0, 3] } as const;

/**
 * Bilan des pronostics sur les matchs terminés dont les cotes ont été relevées avant le match :
 * combien de fois l'issue et le score les plus probables se sont produits, comparé à ce que
 * les probabilités annonçaient. Les matchs sont parcourus dans l'ordre chronologique.
 */
export function backtest(finished: MatchRow[], oddsOf: (key: string) => OddsRow[]): Backtest {
  const out: Backtest = {
    matches: 0,
    outcome: { hits: 0, expected: 0 },
    score: { hits: 0, expected: 0 },
    buckets: (["très probable", "probable", "incertain"] as const).map((label) => ({ label, matches: 0, hits: 0, expected: 0 })),
    form: { matches: 0, hits: 0, oddsHits: 0 },
  };
  // Points des 5 derniers matchs de chaque équipe, avant le match en cours
  const recent = new Map<string, number[]>();
  const games = finished
    .filter((m) => m.status === "finished" && m.home_score != null && m.away_score != null)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  for (const m of games) {
    const actual = outcomeOf(m);
    const fh = recent.get(teamKey(m.home_team)) ?? [];
    const fa = recent.get(teamKey(m.away_team)) ?? [];
    const pred = predict(openingMarkets(oddsOf(m.key)));
    if (pred) {
      const hit = pred.outcome.selection === actual;
      out.matches++;
      out.outcome.expected += pred.outcome.probability;
      if (hit) out.outcome.hits++;
      const top = pred.scores[0];
      out.score.expected += top.probability;
      if (top.home === m.home_score && top.away === m.away_score) out.score.hits++;
      const bucket = out.buckets.find((b) => b.label === pred.confidence)!;
      bucket.matches++;
      bucket.expected += pred.outcome.probability;
      if (hit) bucket.hits++;
      // Comparaison : l'équipe en meilleure forme gagne-t-elle plus souvent que le favori des cotes ?
      if (fh.length >= 3 && fa.length >= 3) {
        const avg = (f: number[]) => f.reduce((a, b) => a + b, 0) / f.length;
        if (avg(fh) !== avg(fa)) {
          out.form.matches++;
          if ((avg(fh) > avg(fa) ? "1" : "2") === actual) out.form.hits++;
          if (hit) out.form.oddsHits++;
        }
      }
    }
    const [ptsHome, ptsAway] = POINTS[actual];
    recent.set(teamKey(m.home_team), [...fh, ptsHome].slice(-5));
    recent.set(teamKey(m.away_team), [...fa, ptsAway].slice(-5));
  }
  return out;
}

/** Probabilité que plusieurs pronostics indépendants passent tous (pari combiné). */
export const combined = (probabilities: number[]) => probabilities.reduce((a, p) => a * p, 1);
