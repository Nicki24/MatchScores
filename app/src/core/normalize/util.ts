/** Outils communs aux adaptateurs. */

export const ODDS_RE = /^\d{1,3}[.,]\d{1,3}$/;

export function parseOdds(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim().replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 1.01 && n <= 1000 ? Math.round(n * 100) / 100 : undefined;
}

export function parseIntSafe(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

export function cleanName(s: string): string {
  return s.replace(/\s+/g, " ").replace(/^[\s•·\-–:]+|[\s•·\-–:]+$/g, "").trim();
}

/** Clé de comparaison d'un nom d'équipe (accents, casse, ponctuation ignorés). */
export function teamKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Empreinte FNV-1a 32 bits, suffisante pour dédoublonner. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const HALF_DAY_MS = 12 * 3600_000;

/**
 * Date ISO depuis un horodatage (s ou ms), une chaîne ISO ou « HH:MM » (heure locale).
 * Une heure seule désigne l'occurrence la plus proche de la capture : « 00:05 » relevé
 * à 23:58 est le lendemain, « 23:55 » relevé à 00:02 est la veille.
 */
export function parseTime(v: unknown, reference = new Date()): string | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") {
    const ms = v < 1e11 ? v * 1000 : v;
    const d = new Date(ms);
    return isNaN(d.getTime()) || d.getFullYear() < 2000 ? undefined : d.toISOString();
  }
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  const hm = s.match(/^(\d{1,2})[:h](\d{2})(?::(\d{2}))?$/);
  if (hm) {
    const h = Number(hm[1]);
    const min = Number(hm[2]);
    if (h > 23 || min > 59) return undefined;
    const d = new Date(reference);
    d.setHours(h, min, Number(hm[3] ?? 0), 0);
    const diff = d.getTime() - reference.getTime();
    if (diff > HALF_DAY_MS) d.setDate(d.getDate() - 1);
    else if (diff < -HALF_DAY_MS) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (/^\d{10,13}$/.test(s)) return parseTime(Number(s), reference);
  const d = new Date(s);
  return isNaN(d.getTime()) || d.getFullYear() < 2000 ? undefined : d.toISOString();
}

/** Numéro de journée : 12, "12", "Journée 12", "Round 12", "J12", "Week 12", "MD 12". */
export function parseRound(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 10000) return Math.trunc(v);
  if (typeof v !== "string") return undefined;
  const m = v.match(/(?:journ[ée]e|round|week|semaine|matchday|md|j|r|w|tour)\s*[:#°n.]*\s*(\d{1,4})/i) ?? v.match(/^\s*(\d{1,4})\s*$/);
  return m ? Number(m[1]) : undefined;
}

/** Score « 2:1 », « 2-1 », « 2 – 1 ». */
export function parseScore(v: unknown): [number, number] | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.trim().match(/^(\d{1,2})\s*[:\-–]\s*(\d{1,2})$/);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}

/** Libellé d'issue normalisé pour les marchés courants. */
export function normalizeSelection(label: string, index: number, count: number, market: string): string {
  const l = label.trim().toLowerCase();
  if (market === "1X2" || market === "12") {
    if (["1", "w1", "p1", "home", "domicile", "h", "1 (home)"].includes(l)) return "1";
    if (["x", "n", "draw", "nul", "d", "match nul"].includes(l)) return "X";
    if (["2", "w2", "p2", "away", "extérieur", "exterieur", "a", "2 (away)"].includes(l)) return "2";
    if (count === 3) return ["1", "X", "2"][index];
    if (count === 2) return ["1", "2"][index];
  }
  if (market === "DC") {
    const c = l.replace(/[\s/]/g, "").toUpperCase();
    if (["1X", "X2", "12"].includes(c)) return c;
  }
  if (market.startsWith("OU")) {
    if (/^(over|plus|\+|o\b|sup)/.test(l)) return "Over";
    if (/^(under|moins|-|u\b|inf)/.test(l)) return "Under";
    return index === 0 ? "Over" : "Under";
  }
  if (market === "BTTS") {
    if (/^(yes|oui|gg|y)\b/.test(l)) return "Oui";
    if (/^(no|non|ng|n)\b/.test(l)) return "Non";
    return index === 0 ? "Oui" : "Non";
  }
  if (market === "CS") {
    const sc = parseScore(label);
    if (sc) return `${sc[0]}:${sc[1]}`;
  }
  return label.trim();
}

/** Marché d'une période (mi-temps, 10 premières minutes…) : jamais celui du match entier. */
const PERIOD = /(mi-?temps|half|\bht\b|\b1st\b|\b2nd\b|\bfirst\b|\bsecond\b|1[eè]re|2[eè]me|premi[eè]re p|seconde p|p[ée]riode|period|\b\d{1,2}\s*-\s*\d{1,2}\s*min)/i;
/** Issues « mi-temps / fin de match » : 1/1, 1/X, X/2, Home/Draw… */
const HTFT_LABEL = /^([1x2n]|home|draw|away|dom|nul|ext)\s*[/-]\s*([1x2n]|home|draw|away|dom|nul|ext)$/i;
const BTTS_NAME = /(btts|both teams|deux [ée]quipes marquent|les deux marquent|gg\s*\/\s*ng|^gg|goal\s*\/\s*no ?goal)/i;
/** Marchés annexes qui reprennent les issues 1 / X / 2 ou plus / moins sans être ceux du match. */
const SIDE =
  /(handicap|asian|asiatique|corner|carton|card|booking|pair|impair|odd\s*\/\s*even|premier but|first goal|dernier but|last goal|marque|score first|scorer|buteur|clean sheet|win to nil|sans encaisser|rembours|draw no bet|\bdnb\b|multi|exact goals|nombre (exact )?de buts|combo|&|\+|qualif|outright|domicile|ext[ée]rieur|home team|away team|[ée]quipe|\bteam\b)/i;

/**
 * Identifie un marché à partir de son nom, de ses issues et du contexte où il a été trouvé
 * (`scope` : noms et clés des objets parents). Les marchés de mi-temps, mi-temps/fin de match,
 * handicap ou d'une seule équipe ne sont jamais confondus avec ceux du match (le marché est alors
 * laissé de côté) : mélangés au résultat du match, ils faussaient les cotes et les pronostics.
 */
export function classifyMarket(name: string, labels: string[], scope = "", teams: string[] = []): string {
  const n = name.toLowerCase();
  const ls = labels.map((l) => l.trim().toLowerCase());
  const other = name.trim() || "AUTRE";
  if (PERIOD.test(`${name} ${scope}`)) return `MT ${other}`;
  if (ls.length >= 4 && ls.filter((l) => HTFT_LABEL.test(l)).length >= ls.length * 0.6) return "HTFT";
  if (BTTS_NAME.test(n)) return "BTTS";
  const own = teamKey(name);
  if (SIDE.test(`${name} ${scope}`) || teams.some((t) => teamKey(t).length >= 3 && own.includes(teamKey(t)))) return `AUTRE ${other}`;
  const line = (n.match(/(\d+[.,]5)/) ?? ls.join(" ").match(/(\d+[.,]5)/))?.[1]?.replace(",", ".");
  if (/double|chance|dc\b/.test(n) || (ls.length === 3 && ls.every((l) => ["1x", "x2", "12", "1/x", "x/2", "1/2"].includes(l.replace(/\s/g, ""))))) return ls.length === 3 ? "DC" : other;
  if (/(correct|exact|score\s*exact|cs\b)/.test(n) || (ls.length > 3 && ls.filter((l) => parseScore(l)).length >= ls.length * 0.6)) return "CS";
  if (ls.some((l) => ["yes", "oui", "gg", "no", "non", "ng"].includes(l))) return "BTTS";
  if (/(over|under|plus|moins|total|o\/u|goals)/.test(n) || ls.some((l) => /^(over|under|plus|moins)/.test(l))) return line ? `OU${line}` : "OU";
  // Résultat du match : exactement trois issues
  if (/(1x2|result|résultat|resultat|match winner|3[- ]?way|full ?time|\bft\b)/.test(n)) return ls.length === 3 ? "1X2" : other;
  if (ls.length === 3 && (ls.includes("x") || ls.includes("draw") || ls.includes("nul"))) return "1X2";
  if (ls.length === 3 && ls[0] === "1" && ls[2] === "2") return "1X2";
  if (ls.length === 2 && ls[0] === "1" && ls[1] === "2") return "12";
  return other;
}

/** Issues reconnues de chaque marché (les autres viennent d'un marché mal identifié). */
export function isStandardSelection(market: string, selection: string): boolean {
  if (market === "1X2") return selection === "1" || selection === "X" || selection === "2";
  if (market === "12") return selection === "1" || selection === "2";
  if (market === "DC") return selection === "1X" || selection === "12" || selection === "X2";
  if (market === "BTTS") return selection === "Oui" || selection === "Non";
  if (market.startsWith("OU")) return selection === "Over" || selection === "Under";
  return true;
}

/** Recherche d'une clé insensible à la casse et aux tirets/soulignés. */
const norm = (k: string) => k.toLowerCase().replace(/[_\-\s]/g, "");
export function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in obj && obj[k] != null && obj[k] !== "") return obj[k];
  const wanted = new Set(keys.map(norm));
  for (const [k, v] of Object.entries(obj)) if (wanted.has(norm(k)) && v != null && v !== "") return v;
  return undefined;
}

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
