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

/** Recherche d'une clé insensible à la casse et aux tirets/soulignés. */
const norm = (k: string) => k.toLowerCase().replace(/[_\-\s]/g, "");
export function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in obj && obj[k] != null && obj[k] !== "") return obj[k];
  const wanted = new Set(keys.map(norm));
  for (const [k, v] of Object.entries(obj)) if (wanted.has(norm(k)) && v != null && v !== "") return v;
  return undefined;
}

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
