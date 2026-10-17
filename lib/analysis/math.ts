export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/** Probabilités implicites d'un marché et marge du bookmaker (overround). */
export function impliedProbabilities(odds: number[]) {
  const raw = odds.map((o) => (o > 1 ? 1 / o : 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  return {
    raw,
    fair: raw.map((p) => (sum > 0 ? p / sum : 0)),
    margin: sum - 1,
  };
}

const factorials = [1];
function factorial(n: number) {
  for (let i = factorials.length; i <= n; i++) factorials[i] = factorials[i - 1] * i;
  return factorials[n];
}

export function poisson(k: number, lambda: number) {
  return (Math.exp(-lambda) * lambda ** k) / factorial(k);
}

export interface ScoreDistribution {
  home: number;
  draw: number;
  away: number;
  over15: number;
  over25: number;
  over35: number;
  btts: number;
  mostLikelyScore: [number, number];
  mostLikelyScoreProb: number;
}

/** Distribution des scores avec deux lois de Poisson indépendantes. */
export function scoreDistribution(lambdaHome: number, lambdaAway: number, maxGoals = 10): ScoreDistribution {
  const out: ScoreDistribution = {
    home: 0,
    draw: 0,
    away: 0,
    over15: 0,
    over25: 0,
    over35: 0,
    btts: 0,
    mostLikelyScore: [0, 0],
    mostLikelyScoreProb: 0,
  };
  let total = 0;
  for (let h = 0; h <= maxGoals; h++) {
    const ph = poisson(h, lambdaHome);
    for (let a = 0; a <= maxGoals; a++) {
      const p = ph * poisson(a, lambdaAway);
      total += p;
      if (h > a) out.home += p;
      else if (h === a) out.draw += p;
      else out.away += p;
      const goals = h + a;
      if (goals > 1.5) out.over15 += p;
      if (goals > 2.5) out.over25 += p;
      if (goals > 3.5) out.over35 += p;
      if (h > 0 && a > 0) out.btts += p;
      if (p > out.mostLikelyScoreProb) {
        out.mostLikelyScoreProb = p;
        out.mostLikelyScore = [h, a];
      }
    }
  }
  for (const k of ["home", "draw", "away", "over15", "over25", "over35", "btts"] as const) out[k] /= total;
  return out;
}

export function overProbability(lambdaTotal: number, line: number) {
  let under = 0;
  for (let g = 0; g < line; g++) under += poisson(g, lambdaTotal);
  return 1 - under;
}
