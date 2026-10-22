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

/** Identifie un marché à partir de son nom et de ses issues. */
export function classifyMarket(name: string, labels: string[]): string {
  const n = name.toLowerCase();
  const ls = labels.map((l) => l.trim().toLowerCase());
  const line = (n.match(/(\d+[.,]5)/) ?? ls.join(" ").match(/(\d+[.,]5)/))?.[1]?.replace(",", ".");
  if (/double|chance|dc\b/.test(n) || (ls.length === 3 && ls.every((l) => ["1x", "x2", "12", "1/x", "x/2", "1/2"].includes(l.replace(/\s/g, ""))))) return "DC";
  if (/(correct|exact|score\s*exact|cs\b)/.test(n) || (ls.length > 3 && ls.filter((l) => parseScore(l)).length >= ls.length * 0.6)) return "CS";
  if (/(btts|both|deux [ée]quipes|gg|les deux)/.test(n) || ls.some((l) => ["yes", "oui", "gg", "no", "non", "ng"].includes(l))) return "BTTS";
  if (/(over|under|plus|moins|total|o\/u|goals)/.test(n) || ls.some((l) => /^(over|under|plus|moins)/.test(l))) return line ? `OU${line}` : "OU";
  if (/(1x2|result|résultat|resultat|match winner|3[- ]?way|full ?time|ft)/.test(n)) return "1X2";
  if (ls.length === 3 && (ls.includes("x") || ls.includes("draw") || ls.includes("nul"))) return "1X2";
  if (ls.length === 3 && ls[0] === "1" && ls[2] === "2") return "1X2";
  if (ls.length === 2 && ls[0] === "1" && ls[1] === "2") return "12";
  return name.trim() || "AUTRE";
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
