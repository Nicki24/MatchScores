/**
 * Marchés d'un match. Seuls ceux du match entier sont gardés : résultat (1X2), vainqueur (12),
 * double chance, les deux équipes marquent, score exact et plus/moins de buts. Tout ce qui leur
 * ressemble sans l'être est écarté : mi-temps (« MT », « 1st Half », « HT1X2 », clé « htOdds »…),
 * mi-temps/fin de match, tranches de minutes, handicap, total d'une seule équipe, combinés
 * (« 1X2 & GG/NG »)… Mélangés au résultat du match, ils faussaient les cotes et empêchaient les pronostics.
 */
import { parseScore } from "./util";

/** Où le marché a été trouvé. */
export interface MarketScope {
  /** Clés des objets parents (« htOdds », « firstHalf », « markets »…). */
  keys: string;
  /** Noms des objets parents (« 1ère mi-temps »…) et valeurs de leurs champs « période » (« HT »). */
  names: string;
}

export const NO_SCOPE: MarketScope = { keys: "", names: "" };

/** Mots d'un texte, en minuscules et sans accents ; « htOdds » → ht odds, « 1X2_HT » → 1x2 ht, « 2,5 » → 2.5. */
export function words(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .split(/[^a-z0-9.]+|\.(?!\d)|(?<!\d)\./)
    .filter(Boolean);
}
const plain = (s: string) => ` ${words(s).join(" ")} `;

/* ---------- Périodes ---------- */

/** Un mot qui désigne une période : ht, mt, 1h, h1, ht1x2, 1x2ht, htft, half, 1ere, 2nde, pause… */
const PERIOD_WORD =
  /^(?:(?:ht|mt|fh|sh|h1|h2|1h|2h|p1|p2)(?:ft|1x2|1n2|x2|\d)?|(?:1x2|1n2|odds?|result|res|score|total|gg)(?:ht|mt|1h|h1)|(?:period|periode|half|mitemps)[12]|half|halftime|halves|halfs|1st|2nd|1er|1re|1ere|2e|2eme|2nde|deuxieme|pause|intervalle?|mitemps|mitps)$/;
/** Expressions de période (texte en mots) ; « 90 min » est le match entier. */
const PERIOD_TEXT =
  / (?:mi (?:temps|tps)|first (?:half|period)|second (?:half|period)|premiere (?:periode|mi)|seconde (?:periode|mi)|a la pause|(?!90 )\d{1,2} (?:premieres? )?min(?:ute)?s?|\d{1,2} \d{2} \d{1,2} \d{2}) /;
/** Tranche de minutes (« 1-15 », « 00:00-14:59 »), dans le nom brut. */
const MINUTE_RANGE = /\b(\d{1,2})(?::\d{2})?\s*-\s*(\d{1,2})(?::\d{2})?\b/;
/** Tranche de minutes qui n'est pas le match entier (« 0-90 min » l'est). */
const isMinuteRange = (name: string) => {
  const m = name.match(MINUTE_RANGE);
  return !!m && Number(m[2]) < 90;
};

function isPeriod(...texts: string[]): boolean {
  return texts.some((t) => t && (words(t).some((w) => PERIOD_WORD.test(w)) || PERIOD_TEXT.test(plain(t))));
}

/* ---------- Marchés annexes ---------- */

/** Combinés : « 1X2 & GG/NG », « 1X2 et Plus/Moins », « GG/NG 2+ ». */
const COMBO = /&|\+|\s(?:and|et|with|avec)\s|\bcombo|\bcombin/i;
/** « +/- 2.5 » (plus/moins) et « 90 min + arrêts de jeu » ne sont pas des combinés. */
const NOT_COMBO = /\+\s*\/\s*-|\+\s*(?:arr[eê]ts?|temps additionnel|stoppage|injury)/gi;
/** Marchés annexes qui reprennent les issues 1 / X / 2, oui / non ou plus / moins. */
const SIDE =
  / (?:handicap|hcp|eh|ah|asian|asiatique|corners?|cartons?|cards?|bookings?|odd even|pair|impair|premier but|1er but|prochain but|next goal|first goal|first team to score|dernier but|last goal|marque[nr]?t?|to score|score first|scorers?|buteurs?|clean sheet|win to nil|sans encaisser|rembourse|draw no bet|dnb|multi\w*|exact goals|goals exact|buts exacts|nombre exact de buts|qualif\w*|outright|penalt\w*|own goal|contre son camp|both halves|deux mi temps|highest scoring|winning margin|ecart|range|tranche|sans (?:match )?nul|coups? de coin|tirs?|shots?|hors jeu|offsides?|fautes?|fouls?|touches?|throw ins?|possession|remplacements?) /;
/** Marchés annexes reconnaissables au nom d'un groupe parent. */
const SIDE_GROUP = / (?:handicap|hcp|asian|asiatique|corners?|cartons?|bookings?|buteurs?|scorers?|combin\w*|penalt\w*) /;
/** Handicap écrit dans le nom : « 1X2 (0:1) », « Résultat (-1) ». */
const HANDICAP_NAME = /\b\d+:\d+\b|\(\s*[+-]\d+(?:[.,]\d+)?\s*\)/;
/** Total d'une seule équipe : « Home Over/Under », « Plus/Moins 2.5 Visiteurs », « Total 1 ». */
const GOALS = / (?:over|under|plus|moins|total|o u|goals?|buts?) /;
const ONE_TEAM = / (?:home|away|domicile|dom|exterieur|ext|locaux|visiteurs?|team|equipe|t1|t2|total [12]|[12] total) /;

/* ---------- Issues ---------- */

const HOME = /^(?:1|w1|p1|h|home|homewin|home win|domicile|dom|local|locaux|1 home|victoire domicile)$/;
const DRAW = /^(?:x|n|d|draw|the draw|nul|match nul|tie|egalite|x draw)$/;
const AWAY = /^(?:2|w2|p2|a|away|awaywin|away win|exterieur|ext|visiteurs?|2 away|victoire exterieur)$/;
const ISSUE_DRAW = /^(?:x|n|d|draw|the draw|nul|match nul|tie|egalite)$/;

/** Issue 1 / X / 2 d'un libellé : « Home », « Domicile », « N », « Victoire Arsenal »… */
export function outcome(label: string, teams: string[] = []): "1" | "X" | "2" | undefined {
  const l = words(label).join(" ");
  if (HOME.test(l)) return "1";
  if (DRAW.test(l)) return "X";
  if (AWAY.test(l)) return "2";
  const has = (team?: string) => {
    const t = team ? words(team) : [];
    const lw = new Set(words(label));
    return t.length > 0 && t.every((w) => lw.has(w));
  };
  const [home, away] = teams;
  if (has(home) && !has(away)) return "1";
  if (has(away) && !has(home)) return "2";
  return undefined;
}

/** Double chance : « 1X », « Home or Draw », « 1 ou X », « X/2 »… */
export function doubleChance(label: string): "1X" | "12" | "X2" | undefined {
  const ws = words(label).filter((w) => w !== "or" && w !== "ou");
  const parts = ws.length === 1 && /^[1x2n]{2}$/.test(ws[0]) ? [...ws[0]] : ws;
  const set = new Set(parts.map((p) => outcome(p)).filter(Boolean));
  if (set.size !== 2) return undefined;
  return set.has("2") ? (set.has("1") ? "12" : "X2") : "1X";
}

/** Issues « mi-temps / fin de match » : 1/1, X/2, Home/Draw… */
const HTFT_LABEL = /^([1x2n]|home|draw|away|dom|nul|ext)\s*\/\s*([1x2n]|home|draw|away|dom|nul|ext)$/i;

function isHtFt(labels: string[]): boolean {
  const l = labels.map((x) => x.trim().toLowerCase());
  const htft = l.filter((x) => HTFT_LABEL.test(x));
  if (l.length >= 4) return htft.length >= l.length * 0.6;
  // Trois issues 1/1, X/X, 2/2 : mi-temps / fin de match (la double chance s'écrit 1/X, X/2, 1/2)
  return l.length > 0 && htft.length === l.length && l.some((x) => {
    const [a, b] = x.split("/").map((s) => s.trim());
    return a === b;
  });
}

/* ---------- Identifiants Sporty-tech / Betradar ---------- */

/** Marchés courants de la plateforme de bet261 (identifiants Betradar), quand le nom manque ou pour le compléter. */
const MARKET_IDS: Record<string, string> = {
  "1": "1X2",
  "10": "Double chance",
  "18": "Total",
  "29": "GG/NG",
  "45": "Correct score",
  "11": "Draw no bet",
  "8": "First goal",
  "14": "Handicap 1X2",
  "16": "Handicap",
  "19": "Home total",
  "20": "Away total",
  "26": "Odd/even",
  "35": "1X2 & GG/NG",
  "36": "Total & GG/NG",
  "37": "1X2 & total",
  "47": "HT/FT",
  "60": "1st half - 1X2",
  "63": "1st half - double chance",
  "68": "1st half - total",
  "75": "1st half - GG/NG",
  "81": "1st half - correct score",
  "83": "2nd half - 1X2",
  "90": "2nd half - total",
};
const OUTCOME_IDS: Record<string, Record<string, string>> = {
  "1": { "1": "1", "2": "X", "3": "2" },
  "10": { "9": "1X", "10": "12", "11": "X2" },
  "18": { "12": "Over", "13": "Under" },
  "29": { "74": "Yes", "76": "No" },
};

/** Nom d'un marché d'après son identifiant (formats Sporty-tech, reconnus à leur champ « specifier »). */
export const marketIdName = (id: string) => MARKET_IDS[id];
/** Libellé d'une issue d'après son identifiant, pour un marché identifié. */
export const outcomeIdLabel = (marketId: string, outcomeId: string) => OUTCOME_IDS[marketId]?.[outcomeId];

/* ---------- Classement ---------- */

export interface MarketInput {
  /** Tous les noms du marché (« 1X2 | Résultat du match | total=2.5 »). */
  name: string;
  labels: string[];
  scope?: MarketScope;
  teams?: string[];
}

/** Nom générique (clé conteneur ou rien) : on ne juge alors que les issues. */
const GENERIC_NAME = /^ (?:odds?|cotes?|markets?|bets?|prices?|selections?|outcomes?|main|principal\w*)? $/;

/**
 * Identifie un marché : 1X2, 12, DC, BTTS, CS, OU<ligne> ; tout autre résultat (« MT … »,
 * « AUTRE … ») est un marché à écarter.
 */
export function classifyMarket({ name, labels, scope = NO_SCOPE, teams = [] }: MarketInput): string {
  const n = plain(name);
  const ls = labels.map((l) => words(l).join(" "));
  const other = `AUTRE ${name.trim()}`.trim();
  const generic = GENERIC_NAME.test(n);
  if (isPeriod(name, scope.keys, scope.names) || isMinuteRange(name)) return `MT ${name.trim()}`.trim();
  if (isHtFt(labels)) return "HTFT";
  if (COMBO.test(name.replace(NOT_COMBO, " "))) return other;
  if (/ (?:btts|both teams|(?:les )?(?:deux|2) equipes marquent|les deux marquent|chaque equipe marque|both to score|gg ng|goal no ?goal) |^ gg /.test(n)) return labels.length === 2 ? "BTTS" : other;
  if (SIDE.test(n) || SIDE_GROUP.test(plain(scope.names)) || HANDICAP_NAME.test(name)) return other;
  // Un marché au nom d'une seule des deux équipes, ou le total d'une équipe
  const named = teams.filter((t) => {
    const tw = words(t).filter((w) => w.length >= 3);
    return tw.length > 0 && tw.every((w) => n.includes(` ${w} `));
  });
  if (named.length === 1 || (GOALS.test(n) && ONE_TEAM.test(n))) return other;

  const line = (name.match(/(\d+[.,]5)/) ?? labels.join(" ").match(/(\d+[.,]5)/))?.[1]?.replace(",", ".");
  if (/ (?:double chance|doublechance|dc) /.test(n)) return labels.length === 3 ? "DC" : other;
  if (/ (?:correct score|score exact|exact score|cs|resultat exact) /.test(n) || (ls.length > 3 && labels.filter((l) => parseScore(l)).length >= ls.length * 0.6)) return "CS";
  if (/ (?:over|under|plus|moins|total|o u|goals|buts) /.test(n) || ls.some((l) => /^(?:over|under|plus|moins)\b/.test(l))) return labels.length === 2 ? (line ? `OU${line}` : "OU") : other;
  if (ls.length === 2 && ls.every((l) => /^(?:gg|ng)$/.test(l))) return "BTTS";
  if (ls.length === 2 && ls.every((l) => /^(?:yes|no|oui|non)$/.test(l))) return generic ? "BTTS" : other;
  // Résultat du match : trois issues
  if (/ (?:1x2|1n2|result|resultat|match winner|vainqueur|winner|3 ?way|full ?time|fulltime|ft|match odds|temps reglementaire|final) /.test(n)) {
    return labels.length === 3 ? "1X2" : labels.length === 2 ? "12" : other;
  }
  if (ls.length === 3 && ls.every((l) => ["1x", "x2", "12", "1 x", "x 2", "1 2"].includes(l))) return "DC";
  if (ls.length === 3 && ls.some((l) => ISSUE_DRAW.test(l))) return "1X2";
  if (ls.length === 2 && ls[0] === "1" && ls[1] === "2") return "12";
  return other;
}

/** Libellé normalisé d'une issue pour un marché reconnu ; undefined si elle ne lui appartient pas. */
export function normalizeSelection(label: string, index: number, count: number, market: string, teams: string[] = []): string | undefined {
  const l = words(label).join(" ");
  if (market === "1X2" || market === "12") {
    const o = outcome(label, teams);
    if (o) return market === "12" && o === "X" ? undefined : o;
    // Sans libellé : la position (1, X, 2)
    if (!l && count === 3) return ["1", "X", "2"][index];
    if (!l && count === 2) return ["1", "2"][index];
    return undefined;
  }
  if (market === "DC") return doubleChance(label);
  if (market.startsWith("OU")) {
    if (/^(?:over|plus|o|sup|more|\+)\b/.test(l) || label.trim().startsWith("+")) return "Over";
    if (/^(?:under|moins|u|inf|less)\b/.test(l) || label.trim().startsWith("-")) return "Under";
    return count === 2 ? ["Over", "Under"][index] : undefined;
  }
  if (market === "BTTS") {
    if (/^(?:yes|oui|gg|y)\b/.test(l)) return "Oui";
    if (/^(?:no|non|ng|n)\b/.test(l)) return "Non";
    return count === 2 ? ["Oui", "Non"][index] : undefined;
  }
  if (market === "CS") {
    const sc = parseScore(label);
    return sc ? `${sc[0]}:${sc[1]}` : undefined;
  }
  return label.trim();
}

/** Issues complètes de chaque marché : sans elles, le marché est mal identifié et n'est pas gardé. */
const COMPLETE: Record<string, string[]> = { "1X2": ["1", "X", "2"], "12": ["1", "2"], DC: ["1X", "12", "X2"], BTTS: ["Oui", "Non"] };

export function isComplete(market: string, selections: string[]): boolean {
  const want = COMPLETE[market] ?? (market.startsWith("OU") ? ["Over", "Under"] : undefined);
  if (!want) return selections.length > 0 && new Set(selections).size === selections.length;
  return selections.length === want.length && want.every((w) => selections.includes(w));
}

/** Issues reconnues de chaque marché (les autres viennent d'un marché mal identifié). */
export function isStandardSelection(market: string, selection: string): boolean {
  const want = COMPLETE[market] ?? (market.startsWith("OU") ? ["Over", "Under"] : undefined);
  return !want || want.includes(selection);
}

/** Libellé ou nom qui est en fait un marché ou une cote, jamais une équipe. */
export const MARKET_WORDS =
  / (?:1x2|1n2|mi temps|half|ht|ft|mt|1st|2nd|result|resultat|over|under|plus|moins|total|handicap|score|exact|but|buts|goals?|double|chance|gg|ng|btts|odds?|cotes?|winner|vainqueur|period|periode|corners?|home|away|draw|domicile|exterieur|nul) /;
export const looksLikeMarket = (s: string) => MARKET_WORDS.test(plain(s)) || /^\s*\d+(?:[.,]\d+)?\s*$/.test(s);
