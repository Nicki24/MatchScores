import { DRAW_SPORTS, type Market, type Match } from "../types";
import { clamp, impliedProbabilities, round } from "./math";

export type RiskLevel = "faible" | "modéré" | "élevé";

export interface Pick {
  id: string;
  matchId: string;
  match: Match;
  market: string;
  label: string;
  /** Texte lisible : "Victoire Arsenal", "Plus de 2.5 buts"… */
  description: string;
  odds: number;
  /** Probabilité « juste » (marge du bookmaker retirée). */
  probability: number;
  /** Cote calculée par l'outil, absente du site (à vérifier). */
  estimated: boolean;
  margin: number;
  safety: number;
  risk: RiskLevel;
  reasons: string[];
}

export interface MatchAnalysis {
  match: Match;
  main?: { market: Market; fair: number[]; margin: number };
  favorite?: { label: string; probability: number };
  picks: Pick[];
  best?: Pick;
}

export interface AnalysisSettings {
  /** Cote minimale pour qu'un pari vaille la peine. */
  minOdds: number;
  /** Cote maximale tolérée pour un pari « sûr ». */
  maxOdds: number;
  includeLive: boolean;
  includeEstimated: boolean;
}

export const DEFAULT_SETTINGS: AnalysisSettings = {
  minOdds: 1.15,
  maxOdds: 2.2,
  includeLive: false,
  includeEstimated: true,
};

export function riskLevel(safety: number): RiskLevel {
  if (safety >= 72) return "faible";
  if (safety >= 58) return "modéré";
  return "élevé";
}

/** Nombre de résultats couverts par une sélection (2 pour une double chance). */
function coverage(market: Market) {
  return market.key === "DC" ? 2 : 1;
}

function describe(match: Match, market: Market, label: string): string {
  const { home, away } = match;
  switch (market.key) {
    case "1X2":
    case "12":
      if (label === "1") return `Victoire ${home}`;
      if (label === "2") return `Victoire ${away}`;
      if (label === "X") return "Match nul";
      break;
    case "DC":
      if (label === "1X") return `${home} ou nul`;
      if (label === "X2") return `${away} ou nul`;
      if (label === "12") return `${home} ou ${away} (pas de nul)`;
      break;
    case "OU": {
      const unit = match.sport === "football" ? "buts" : "points";
      if (/^(over|plus|\+)/i.test(label)) return `Plus de ${market.line ?? "?"} ${unit}`;
      if (/^(under|moins|-)/i.test(label)) return `Moins de ${market.line ?? "?"} ${unit}`;
      break;
    }
    case "BTTS":
      return /^(oui|yes)/i.test(label) ? "Les deux équipes marquent" : "Au moins une équipe ne marque pas";
  }
  return `${market.name} : ${label}`;
}

export function mainMarket(match: Match): Market | undefined {
  return (
    match.markets.find((m) => m.key === "1X2" && m.selections.length === 3) ??
    match.markets.find((m) => m.key === "12" && m.selections.length === 2)
  );
}

function deriveDoubleChance(match: Match, main: Market, fair: number[], margin: number): Market | undefined {
  if (main.key !== "1X2" || match.markets.some((m) => m.key === "DC")) return undefined;
  const p = Object.fromEntries(main.selections.map((s, i) => [s.label, fair[i]]));
  if (p["1"] == null || p["X"] == null || p["2"] == null) return undefined;
  // Cote estimée = cote juste réduite de la même marge que le marché principal.
  const toOdds = (prob: number) => round(1 / (prob * (1 + margin)), 2);
  return {
    key: "DC",
    name: "Double chance (estimée)",
    selections: [
      { label: "1X", odds: toOdds(p["1"] + p["X"]) },
      { label: "X2", odds: toOdds(p["X"] + p["2"]) },
      { label: "12", odds: toOdds(p["1"] + p["2"]) },
    ],
  };
}

export function analyzeMatch(match: Match, settings: AnalysisSettings = DEFAULT_SETTINGS): MatchAnalysis {
  const analysis: MatchAnalysis = { match, picks: [] };
  const main = mainMarket(match);
  let drawProb = 0;

  if (main) {
    const { fair, margin } = impliedProbabilities(main.selections.map((s) => s.odds));
    analysis.main = { market: main, fair, margin };
    const favIdx = fair.indexOf(Math.max(...fair));
    analysis.favorite = { label: main.selections[favIdx].label, probability: fair[favIdx] };
    drawProb = main.selections.findIndex((s) => s.label === "X") >= 0 ? fair[main.selections.findIndex((s) => s.label === "X")] : 0;
  }

  const markets: { market: Market; estimated: boolean }[] = match.markets.map((m) => ({ market: m, estimated: false }));
  if (main && analysis.main) {
    const dc = deriveDoubleChance(match, main, analysis.main.fair, analysis.main.margin);
    if (dc) markets.push({ market: dc, estimated: true });
  }

  for (const { market, estimated } of markets) {
    if (market.selections.length < 2) continue;
    const { raw, margin: rawMargin } = impliedProbabilities(market.selections.map((s) => s.odds));
    const cover = coverage(market);
    const sum = raw.reduce((a, b) => a + b, 0);
    const margin = estimated ? analysis.main!.margin : sum / cover - 1;
    if (!estimated && (rawMargin < -0.05 || margin > 0.4)) continue; // marché incomplet ou mal lu

    market.selections.forEach((sel, i) => {
      const probability = estimated
        ? 1 / (sel.odds * (1 + margin))
        : (raw[i] / sum) * cover;
      const reasons: string[] = [];
      let safety = probability * 100;

      const marginPenalty = clamp(margin, 0, 0.3) * 50;
      safety -= marginPenalty;
      if (margin > 0.1) reasons.push(`Marge du bookmaker élevée (${round(margin * 100, 1)} %) : cotes moins fiables`);

      const isWin = (market.key === "1X2" || market.key === "12") && (sel.label === "1" || sel.label === "2");
      if (isWin && DRAW_SPORTS.includes(match.sport) && drawProb > 0.2) {
        const p = (drawProb - 0.2) * 40;
        safety -= p;
        reasons.push(`Risque de nul de ${round(drawProb * 100)} % en ${match.sport === "football" ? "football" : "ce sport"}`);
      }
      if (match.live) {
        safety -= 6;
        reasons.push("Match en direct : les cotes bougent vite");
      }
      if (market.key === "OU" && market.line != null && match.sport === "football" && market.line <= 1.5 && /^(over|plus|\+)/i.test(sel.label)) {
        reasons.push("Ligne basse de buts : historiquement l'un des paris les plus stables");
      }
      if (market.key === "DC") reasons.push("Double chance : couvre deux résultats sur trois");
      if (probability >= 0.75) reasons.push(`Probabilité estimée forte : ${round(probability * 100)} %`);
      if (estimated) reasons.push("Cote estimée par l'outil : vérifie la cote réelle sur Bet261");

      safety = clamp(safety, 0, 100);
      analysis.picks.push({
        id: `${match.id}:${market.key}:${market.line ?? ""}:${sel.label}`,
        matchId: match.id,
        match,
        market: market.name,
        label: sel.label,
        description: describe(match, market, sel.label),
        odds: sel.odds,
        probability,
        estimated,
        margin,
        safety: round(safety, 1),
        risk: riskLevel(safety),
        reasons,
      });
    });
  }

  analysis.picks.sort((a, b) => b.safety - a.safety);
  analysis.best = analysis.picks.find((p) => isEligible(p, settings));
  return analysis;
}

export function isEligible(p: Pick, s: AnalysisSettings) {
  if (p.odds < s.minOdds || p.odds > s.maxOdds) return false;
  if (p.estimated && !s.includeEstimated) return false;
  if (p.match.live && !s.includeLive) return false;
  return true;
}

/** Meilleur pari éligible de chaque match, trié du plus sûr au plus risqué. */
export function safestPicks(matches: Match[], settings: AnalysisSettings = DEFAULT_SETTINGS, limit = 20): Pick[] {
  return matches
    .map((m) => analyzeMatch(m, settings).best)
    .filter((p): p is Pick => !!p)
    .sort((a, b) => b.safety - a.safety)
    .slice(0, limit);
}

export interface Combo {
  name: string;
  target: number;
  legs: Pick[];
  odds: number;
  probability: number;
  risk: RiskLevel;
}

/**
 * Combinés : on ajoute les paris les plus probables (un par match)
 * jusqu'à atteindre la cote visée, avec au maximum `maxLegs` sélections.
 */
export function buildCombos(picks: Pick[], maxLegs = 4): Combo[] {
  const pool = picks.filter((p) => !p.estimated).sort((a, b) => b.probability - a.probability);
  const presets = [
    { name: "Prudent", target: 1.6 },
    { name: "Équilibré", target: 2.2 },
    { name: "Ambitieux", target: 3.5 },
  ];
  const combos: Combo[] = [];
  for (const { name, target } of presets) {
    const legs: Pick[] = [];
    let odds = 1;
    let probability = 1;
    // Cote minimale par sélection pour atteindre la cible en `maxLegs` sélections au plus.
    const minLegOdds = target ** (1 / maxLegs) * 0.97;
    for (const p of pool) {
      if (legs.length >= maxLegs || odds >= target) break;
      if (p.odds < minLegOdds) continue;
      if (legs.some((l) => l.matchId === p.matchId)) continue;
      legs.push(p);
      odds *= p.odds;
      probability *= p.probability;
    }
    if (legs.length >= 2 && odds >= target * 0.9) {
      combos.push({ name, target, legs, odds: round(odds), probability, risk: riskLevel(probability * 100) });
    }
  }
  return combos;
}
