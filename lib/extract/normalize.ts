import type { FormResult, Market, MarketKey, Selection, Sport } from "../types";

const SPORT_PATTERNS: [Sport, RegExp][] = [
  ["table-tennis", /tennis\s*de\s*table|table\s*tennis|ping/i],
  ["basketball", /basket|nba|euroleague/i],
  ["tennis", /tennis|atp|wta|itf/i],
  ["volleyball", /volley/i],
  ["handball", /hand/i],
  ["rugby", /rugby/i],
  ["hockey", /hockey|nhl/i],
  ["baseball", /baseball|mlb/i],
  ["esport", /e-?sport|fifa|efootball|counter|dota|league of legends|valorant/i],
  ["football", /foot|soccer|premier league|liga|serie a|bundesliga|ligue 1|champions/i],
];

export function detectSport(text?: string | null): Sport | undefined {
  if (!text) return undefined;
  for (const [sport, re] of SPORT_PATTERNS) if (re.test(text)) return sport;
  return undefined;
}

export const ODDS_RE = /^\d{1,3}[.,]\d{1,3}$/;

/** Cote contenue dans un petit texte : « 1.85 » ou « 1 1.85 », « X 3,40 », « +2.5 1.90 ». */
export function oddsInLabel(text: string): number | undefined {
  if (ODDS_RE.test(text)) return parseOdds(text);
  if (text.length > 24) return undefined;
  const m = text.match(/(?:^|\s)(\d{1,3}[.,]\d{2})$/);
  return m ? parseOdds(m[1]) : undefined;
}

export function parseOdds(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim().replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 1.01 && n <= 1000 ? n : undefined;
}

/** Ramène les libellés d'issues vers "1", "X", "2". */
export function normalizeOutcome(label: string, index: number, count: number): string {
  const l = label.trim().toLowerCase();
  if (["1", "w1", "p1", "home", "domicile", "h"].includes(l)) return "1";
  if (["x", "n", "draw", "nul", "d"].includes(l)) return "X";
  if (["2", "w2", "p2", "away", "extérieur", "exterieur", "a"].includes(l)) return "2";
  if (["1x", "x2", "12"].includes(l)) return l.toUpperCase();
  if (/^(over|plus|\+|o)\b/.test(l)) return "Over";
  if (/^(under|moins|-|u)\b/.test(l)) return "Under";
  if (["yes", "oui", "gg"].includes(l)) return "Oui";
  if (["no", "non", "ng"].includes(l)) return "Non";
  // Libellé inconnu : on se base sur la position.
  if (count === 3) return ["1", "X", "2"][index];
  if (count === 2) return ["1", "2"][index];
  return label;
}

export function buildMainMarket(odds: number[], sport: Sport): Market | undefined {
  if (odds.length === 3) {
    return { key: "1X2", name: "Résultat (1X2)", selections: odds.map((o, i) => ({ label: ["1", "X", "2"][i], odds: o })) };
  }
  if (odds.length === 2) {
    return { key: "12", name: sport === "football" ? "Vainqueur" : "Vainqueur (match)", selections: [{ label: "1", odds: odds[0] }, { label: "2", odds: odds[1] }] };
  }
  return undefined;
}

export function classifyMarket(name: string, selections: Selection[]): { key: MarketKey; line?: number } {
  const n = name.toLowerCase();
  const labels = selections.map((s) => s.label);
  const lineMatch = n.match(/(\d+[.,]5)/) ?? labels.join(" ").match(/(\d+[.,]5)/);
  const line = lineMatch ? Number(lineMatch[1].replace(",", ".")) : undefined;
  if (labels.every((l) => ["1X", "X2", "12"].includes(l)) || /double/.test(n)) return { key: "DC" };
  if (labels.some((l) => l === "Over" || l === "Under") || /(over|under|plus|moins|total)/.test(n)) return { key: "OU", line };
  if (labels.some((l) => l === "Oui" || l === "Non") || /(btts|deux équipes|both teams|gg)/.test(n)) return { key: "BTTS" };
  if (labels.length === 3 && labels.includes("X")) return { key: "1X2" };
  if (labels.length === 2 && labels[0] === "1" && labels[1] === "2") return { key: "12" };
  return { key: "OTHER", line };
}

/** Forme "WWDLW" ou "VVNDP" (FR : Victoire / Nul / Défaite-Perdu). */
export function parseForm(text: string): FormResult[] | undefined {
  const t = text.replace(/[\s,|-]/g, "").toUpperCase();
  if (!/^[WDLVNP]{2,10}$/.test(t)) return undefined;
  const french = /[VNP]/.test(t);
  return [...t].map((c) => {
    if (c === "W" || c === "V") return "W";
    if (c === "N") return "D";
    if (c === "D") return french ? "L" : "D";
    return "L";
  });
}

let counter = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function cleanName(s: string) {
  return s.replace(/\s+/g, " ").replace(/^[\s•·\-–]+|[\s•·\-–]+$/g, "").trim();
}
