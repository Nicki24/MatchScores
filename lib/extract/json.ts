import type { Market, Match, Selection, Sport } from "../types";
import { buildMainMarket, classifyMarket, cleanName, detectSport, normalizeOutcome, parseOdds, uid } from "./normalize";

/**
 * Extracteur générique : parcourt n'importe quel JSON (réponse d'API,
 * état embarqué dans la page…) et reconnaît les objets qui ressemblent
 * à un match avec des cotes. Il ne dépend pas de la structure exacte de Bet261.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

const HOME_KEYS = ["home", "homeTeam", "homeName", "team1", "competitor1", "teamHome", "localTeam", "h", "home_team", "hn"];
const AWAY_KEYS = ["away", "awayTeam", "awayName", "team2", "competitor2", "teamAway", "visitorTeam", "a", "away_team", "an"];
const NAME_KEYS = ["name", "title", "eventName", "matchName", "n", "label", "description"];
const ODDS_KEYS = ["odds", "odd", "price", "coef", "coefficient", "rate", "value", "o", "c", "decimal", "decimalOdds"];
const LABEL_KEYS = ["name", "label", "outcome", "outcomeName", "type", "shortName", "sn", "code", "selection", "t", "n"];
const SPORT_KEYS = ["sport", "sportName", "sportId", "discipline", "category"];
const LEAGUE_KEYS = ["league", "leagueName", "tournament", "tournamentName", "competition", "championship", "categoryName"];
const TIME_KEYS = ["startTime", "start", "date", "startDate", "kickoff", "eventDate", "time", "startsAt"];

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (isObj(v)) for (const k of NAME_KEYS) if (typeof v[k] === "string" && (v[k] as string).trim()) return (v[k] as string).trim();
  return undefined;
}

function pick(obj: Obj, keys: string[]): unknown {
  for (const k of keys) if (k in obj && obj[k] != null) return obj[k];
  const lower = Object.keys(obj).find((k) => keys.some((kk) => kk.toLowerCase() === k.toLowerCase()));
  return lower ? obj[lower] : undefined;
}

function teams(obj: Obj): [string, string] | undefined {
  const h = str(pick(obj, HOME_KEYS));
  const a = str(pick(obj, AWAY_KEYS));
  if (h && a && h !== a && isNaN(Number(h))) return [h, a];
  for (const key of ["competitors", "teams", "participants", "opponents"]) {
    const arr = obj[key];
    if (Array.isArray(arr) && arr.length === 2) {
      const n = arr.map(str);
      if (n[0] && n[1]) return [n[0], n[1]];
    }
  }
  const name = str(pick(obj, NAME_KEYS));
  const m = name?.match(/^(.{2,50}?)\s+(?:-|–|vs\.?|v)\s+(.{2,50})$/i);
  if (m && !/\d+[.,]\d+$/.test(m[2])) return [cleanName(m[1]), cleanName(m[2])];
  return undefined;
}

/** Une sélection = objet avec une cote et éventuellement un libellé. */
function selectionOf(v: unknown): { label: string; odds: number } | undefined {
  if (!isObj(v)) return undefined;
  const odds = parseOdds(pick(v, ODDS_KEYS));
  if (!odds) return undefined;
  const raw = pick(v, LABEL_KEYS);
  return { label: typeof raw === "string" || typeof raw === "number" ? String(raw) : "", odds };
}

function collectMarkets(root: unknown, sport: Sport, depth = 0, name = "", out: Market[] = []): Market[] {
  if (depth > 6 || root == null) return out;
  if (Array.isArray(root)) {
    const sels = root.map(selectionOf).filter((s): s is { label: string; odds: number } => !!s);
    if (sels.length >= 2 && sels.length <= 3 && sels.length === root.length) {
      const selections: Selection[] = sels.map((s, i) => ({ label: normalizeOutcome(s.label, i, sels.length), odds: s.odds }));
      const { key, line } = classifyMarket(name, selections);
      out.push({ key, line, name: name || (key === "1X2" ? "Résultat (1X2)" : key), selections });
      return out;
    }
    // Tableau brut de cotes : [1.5, 3.2, 5.0]
    const nums = root.map(parseOdds);
    if ((root.length === 2 || root.length === 3) && nums.every((n) => n)) {
      const m = buildMainMarket(nums as number[], sport);
      if (m) out.push(m);
      return out;
    }
    for (const item of root) collectMarkets(item, sport, depth + 1, name, out);
    return out;
  }
  if (isObj(root)) {
    const marketName = str(pick(root, ["marketName", "market", "betType", "name", "title", "type"])) ?? name;
    for (const v of Object.values(root)) if (v && typeof v === "object") collectMarkets(v, sport, depth + 1, marketName, out);
  }
  return out;
}

function toMatch(obj: Obj, context: { sport?: Sport; league?: string; virtual?: boolean }): Match | undefined {
  const t = teams(obj);
  if (!t) return undefined;
  const sport = detectSport(String(pick(obj, SPORT_KEYS) ?? "")) ?? context.sport ?? "football";
  const markets = collectMarkets(obj, sport);
  // Cotes directes sur l'objet du match : { odd1, oddX, odd2 } / { w1, x, w2 }
  if (!markets.length) {
    const direct = [
      ["odd1", "oddX", "odd2"],
      ["w1", "x", "w2"],
      ["home_odds", "draw_odds", "away_odds"],
      ["homeOdds", "drawOdds", "awayOdds"],
    ];
    for (const keys of direct) {
      const vals = keys.map((k) => parseOdds(pick(obj, [k]))).filter((n): n is number => !!n);
      if (vals.length >= 2) {
        const m = buildMainMarket(vals, sport);
        if (m) markets.push(m);
        break;
      }
    }
  }
  if (!markets.length) return undefined;
  const dedup = new Map<string, Market>();
  for (const m of markets) {
    const key = `${m.key}:${m.line ?? ""}:${m.selections.map((s) => s.label).join(",")}`;
    if (!dedup.has(key)) dedup.set(key, m);
  }
  const time = pick(obj, TIME_KEYS);
  return {
    id: String(pick(obj, ["id", "eventId", "matchId", "_id"]) ?? uid("m")),
    sport,
    league: str(pick(obj, LEAGUE_KEYS)) ?? context.league,
    home: t[0],
    away: t[1],
    startTime: typeof time === "string" || typeof time === "number" ? new Date(time).toString() !== "Invalid Date" ? new Date(time).toISOString() : undefined : undefined,
    live: Boolean(pick(obj, ["live", "isLive", "inPlay"])),
    virtual: context.virtual,
    markets: [...dedup.values()],
  };
}

export function extractMatchesFromJson(data: unknown, context: { sport?: Sport; virtual?: boolean } = {}): Match[] {
  const found: Match[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number, ctx: { sport?: Sport; league?: string; virtual?: boolean }) => {
    if (depth > 14 || node == null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1, ctx);
      return;
    }
    const obj = node as Obj;
    const match = toMatch(obj, ctx);
    if (match) {
      found.push(match);
      return;
    }
    const groupName = typeof obj.name === "string" && obj.name.length < 30 ? obj.name : undefined;
    const sportHint = detectSport(String(pick(obj, SPORT_KEYS) ?? "")) ?? detectSport(groupName);
    const leagueHint = str(pick(obj, LEAGUE_KEYS));
    const next = { ...ctx, sport: sportHint ?? ctx.sport, league: leagueHint ?? ctx.league };
    for (const v of Object.values(obj)) walk(v, depth + 1, next);
  };
  walk(data, 0, context);
  return dedupeMatches(found);
}

export function dedupeMatches(matches: Match[]): Match[] {
  const map = new Map<string, Match>();
  for (const m of matches) {
    const key = `${m.home}|${m.away}`.toLowerCase();
    const prev = map.get(key);
    if (!prev) map.set(key, m);
    else if (m.markets.length > prev.markets.length) map.set(key, { ...m, league: m.league ?? prev.league });
  }
  return [...map.values()];
}

/** Repère les blocs JSON embarqués dans une page HTML (__NEXT_DATA__, window.__STATE__…). */
export function extractEmbeddedJson(html: string): unknown[] {
  const out: unknown[] = [];
  const scriptRe = /<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const m of html.matchAll(scriptRe)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {}
  }
  const assignRe = /window\.[\w$]+\s*=\s*(\{[\s\S]{20,}?\})\s*;?\s*<\/script>/gi;
  for (const m of html.matchAll(assignRe)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {}
  }
  return out;
}
