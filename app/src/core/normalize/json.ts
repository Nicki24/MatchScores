/**
 * Adaptateur JSON générique (méthodes B et C) : reconnaît dans n'importe quelle
 * réponse JSON les matchs (équipes, heure, statut, score, journée), leurs cotes
 * et les classements, sans dépendre des noms de champs exacts du site.
 */
import { emptyBatch, type MatchInput, type MatchStatus, type NormalizedBatch, type OddsInput, type StandingInput } from "../types";
import {
  classifyMarket,
  cleanName,
  hash,
  isObj,
  normalizeSelection,
  parseIntSafe,
  parseOdds,
  parseRound,
  parseScore,
  parseTime,
  pick,
} from "./util";

type Obj = Record<string, unknown>;

interface Ctx {
  league?: string;
  season?: string;
  round?: number;
  reference: Date;
}

const ID_KEYS = ["eventId", "matchId", "gameId", "fixtureId", "id", "Id", "code", "eventCode", "uid"];
const HOME_KEYS = ["home", "homeTeam", "homeName", "homeTeamName", "team1", "teamA", "competitor1", "localTeam", "hometeam", "h"];
const AWAY_KEYS = ["away", "awayTeam", "awayName", "awayTeamName", "team2", "teamB", "competitor2", "visitorTeam", "awayteam", "a"];
const NAME_KEYS = ["name", "teamName", "shortName", "title", "label", "displayName", "Name", "n"];
const EVENT_NAME_KEYS = ["name", "eventName", "matchName", "title", "description", "label"];
const TIME_KEYS = ["startTime", "start", "startDate", "kickoff", "kickOff", "kickoffTime", "eventDate", "date", "matchTime", "scheduled", "startsAt", "time", "dateTime"];
const STATUS_KEYS = ["status", "state", "eventStatus", "matchStatus", "phase", "statusName"];
const LEAGUE_KEYS = ["league", "leagueName", "tournament", "tournamentName", "competition", "competitionName", "championship", "categoryName"];
const SEASON_KEYS = ["season", "seasonId", "seasonName", "seasonNumber"];
const ROUND_KEYS = ["round", "roundNumber", "matchday", "matchDay", "week", "weekNumber", "gameDay", "journee", "roundName", "eventBlock"];
const ODDS_KEYS = ["odds", "odd", "price", "coef", "coefficient", "rate", "value", "decimal", "decimalOdds", "o", "Odds", "Price"];
const LABEL_KEYS = ["name", "label", "outcome", "outcomeName", "selection", "selectionName", "type", "shortName", "code", "n", "title", "Name"];
const MARKET_NAME_KEYS = ["marketName", "name", "market", "betType", "type", "title", "description", "Name", "MarketName"];
const LINE_KEYS = ["line", "handicap", "specialValue", "sv", "total", "points", "specifier", "specifiers"];

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return cleanName(v);
  if (typeof v === "number") return undefined;
  if (isObj(v)) {
    const n = pick(v, NAME_KEYS);
    if (typeof n === "string" && n.trim()) return cleanName(n);
  }
  return undefined;
}

function teamsOf(obj: Obj): [string, string] | undefined {
  const h = str(pick(obj, HOME_KEYS));
  const a = str(pick(obj, AWAY_KEYS));
  if (h && a && h !== a && !/^\d+$/.test(h)) return [h, a];
  for (const key of ["competitors", "teams", "participants", "opponents", "Participants", "Competitors"]) {
    const arr = obj[key];
    if (Array.isArray(arr) && arr.length === 2) {
      // Ordre domicile/extérieur explicite si présent
      const sorted = [...arr].sort((x, y) => side(x) - side(y));
      const names = sorted.map(str);
      if (names[0] && names[1]) return [names[0], names[1]];
    }
  }
  const name = pick(obj, EVENT_NAME_KEYS);
  if (typeof name === "string") {
    const m = name.match(/^(.{2,50}?)\s+(?:-|–|vs\.?|v)\s+(.{2,50})$/i);
    if (m && !/\d+[.,]\d+$/.test(m[2])) return [cleanName(m[1]), cleanName(m[2])];
  }
  return undefined;
}

function side(v: unknown): number {
  if (!isObj(v)) return 0;
  const q = String(pick(v, ["qualifier", "side", "position", "homeAway", "type", "isHome"]) ?? "").toLowerCase();
  if (q === "home" || q === "1" || q === "true" || q === "h") return 0;
  if (q === "away" || q === "2" || q === "false" || q === "a") return 1;
  return 0;
}

function statusOf(obj: Obj, hasScore: boolean, kickoff?: string, reference?: Date): MatchStatus {
  const raw = pick(obj, STATUS_KEYS);
  const s = (isObj(raw) ? String(pick(raw, ["name", "type", "code", "id"]) ?? "") : String(raw ?? "")).toLowerCase().replace(/[\s_\-]/g, "");
  if (s) {
    if (/(notstarted|notbegun|scheduled|pending|open|upcoming|prematch|àvenir|avenir|betting|^ns$|created)/.test(s)) return "scheduled";
    if (/(finish|ended|^end$|closed|complete|^result|^ft$|settled|termin|fini|^done$|^over$)/.test(s)) return "finished";
    if (/(live|running|inplay|progress|playing|started|ongoing|encours|half|^ht$)/.test(s)) return "live";
  }
  if (obj.isFinished === true || obj.finished === true || obj.ended === true) return "finished";
  if (obj.isLive === true || obj.live === true || obj.inPlay === true) return "live";
  if (hasScore) {
    if (kickoff && reference && new Date(kickoff).getTime() > reference.getTime()) return "scheduled";
    return "finished";
  }
  return "scheduled";
}

function scoreOf(obj: Obj): [number, number] | undefined {
  const h = parseIntSafe(pick(obj, ["homeScore", "home_score", "scoreHome", "homeGoals", "goalsHome", "hs", "HomeScore"]));
  const a = parseIntSafe(pick(obj, ["awayScore", "away_score", "scoreAway", "awayGoals", "goalsAway", "as", "AwayScore"]));
  if (h != null && a != null) return [h, a];
  for (const key of ["score", "result", "ft", "fullTime", "finalScore", "scores", "Score", "Result"]) {
    const v = obj[key];
    if (typeof v === "string") {
      const sc = parseScore(v);
      if (sc) return sc;
    }
    if (Array.isArray(v) && v.length === 2 && v.every((x) => parseIntSafe(x) != null)) return [parseIntSafe(v[0])!, parseIntSafe(v[1])!];
    if (isObj(v)) {
      const hh = parseIntSafe(pick(v, ["home", "h", "team1", "homeScore", "1"]));
      const aa = parseIntSafe(pick(v, ["away", "a", "team2", "awayScore", "2"]));
      if (hh != null && aa != null) return [hh, aa];
      const ft = v.ft ?? v.fullTime ?? v.current;
      if (typeof ft === "string" && parseScore(ft)) return parseScore(ft);
    }
  }
  for (const key of ["competitors", "participants", "teams", "Participants"]) {
    const arr = obj[key];
    if (Array.isArray(arr) && arr.length === 2) {
      const s = arr.map((c) => (isObj(c) ? parseIntSafe(pick(c, ["score", "goals", "Score"])) : undefined));
      if (s[0] != null && s[1] != null) return [s[0], s[1]];
    }
  }
  return undefined;
}

function leagueOf(obj: Obj): string | undefined {
  const v = pick(obj, LEAGUE_KEYS);
  return str(v);
}

const ROUND_KEY_SET = new Set(ROUND_KEYS.map((k) => k.toLowerCase()));

function roundOf(obj: Obj): number | undefined {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || !ROUND_KEY_SET.has(k.toLowerCase().replace(/[_\-\s]/g, ""))) continue;
    if (isObj(v)) {
      const r = parseRound(pick(v, ["number", "roundNumber", "id", "name", "index", "matchday"]));
      if (r != null) return r;
    } else {
      const r = parseRound(v);
      if (r != null) return r;
    }
  }
  return undefined;
}

function seasonOf(obj: Obj): string | undefined {
  const v = pick(obj, SEASON_KEYS);
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (isObj(v)) {
    const s = pick(v, ["id", "name", "number", "year"]);
    if (typeof s === "string" || typeof s === "number") return String(s);
  }
  return undefined;
}

/* ---------- Cotes ---------- */

interface Sel {
  label: string;
  odds: number;
}

function selectionOf(v: unknown): Sel | undefined {
  if (!isObj(v)) return undefined;
  const odds = parseOdds(pick(v, ODDS_KEYS));
  if (!odds) return undefined;
  const raw = pick(v, LABEL_KEYS);
  return { label: typeof raw === "string" || typeof raw === "number" ? String(raw) : "", odds };
}

function marketNameOf(obj: Obj, fallback: string): string {
  const n = pick(obj, MARKET_NAME_KEYS);
  let name = typeof n === "string" ? n : isObj(n) ? String(pick(n, ["name", "title"]) ?? fallback) : fallback;
  const line = pick(obj, LINE_KEYS);
  if ((typeof line === "string" || typeof line === "number") && !/\d+[.,]5/.test(name)) {
    const m = String(line).match(/(\d+[.,]5)/);
    if (m) name += ` ${m[1]}`;
  }
  return name;
}

/** Marchés retenus : les autres listes de nombres (statistiques…) sont ignorées. */
export const KNOWN_MARKET = /^(1X2|12|DC|BTTS|CS|OU(\d+\.5)?)$/;

function addMarket(out: OddsInput[], externalId: string, name: string, sels: Sel[]) {
  const market = classifyMarket(name, sels.map((s) => s.label));
  if (!KNOWN_MARKET.test(market)) return;
  sels.forEach((s, i) => {
    out.push({ external_id: externalId, market, selection: normalizeSelection(s.label, i, sels.length, market), value: s.odds });
  });
}

function collectOdds(node: unknown, externalId: string, out: OddsInput[], name = "", depth = 0): void {
  if (depth > 7 || node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    const sels = node.map(selectionOf);
    if (node.length >= 2 && sels.every((s): s is Sel => !!s)) {
      addMarket(out, externalId, name, sels);
      return;
    }
    const nums = node.map(parseOdds);
    if ((node.length === 2 || node.length === 3) && nums.every((n): n is number => n != null)) {
      addMarket(out, externalId, name || (node.length === 3 ? "1X2" : "12"), nums.map((odds, i) => ({ label: node.length === 3 ? ["1", "X", "2"][i] : ["1", "2"][i], odds })));
      return;
    }
    for (const item of node) collectOdds(item, externalId, out, name, depth + 1);
    return;
  }
  const obj = node as Obj;
  // Cotes en dictionnaire : { "1": 1.85, "X": 3.4, "2": 4.2 }
  const entries = Object.entries(obj);
  if (entries.length >= 2 && entries.length <= 3 && entries.every(([k, v]) => /^(1|x|2|home|draw|away)$/i.test(k) && parseOdds(v))) {
    const order = (k: string) => ["1", "home", "x", "draw", "2", "away"].indexOf(k.toLowerCase()) >> 1;
    const sorted = [...entries].sort((a, b) => order(a[0]) - order(b[0]));
    addMarket(out, externalId, "1X2", sorted.map(([k, v]) => ({ label: k, odds: parseOdds(v)! })));
    return;
  }
  const marketName = marketNameOf(obj, name);
  for (const [k, v] of entries) {
    if (v && typeof v === "object") collectOdds(v, externalId, out, Array.isArray(v) ? marketName : marketNameOf(isObj(v) ? v : {}, marketName || k), depth + 1);
  }
}

function directOdds(obj: Obj, externalId: string, out: OddsInput[]) {
  const sets = [
    ["odd1", "oddX", "odd2"],
    ["homeOdds", "drawOdds", "awayOdds"],
    ["home_odds", "draw_odds", "away_odds"],
    ["w1", "x", "w2"],
    ["odds1", "oddsX", "odds2"],
  ];
  for (const keys of sets) {
    const vals = keys.map((k) => parseOdds(pick(obj, [k])));
    if (vals[0] && vals[2]) {
      const sels = vals[1] ? [vals[0], vals[1], vals[2]] : [vals[0], vals[2]];
      addMarket(out, externalId, sels.length === 3 ? "1X2" : "12", sels.map((odds, i) => ({ label: sels.length === 3 ? ["1", "X", "2"][i] : ["1", "2"][i], odds: odds! })));
      return;
    }
  }
}

/* ---------- Classements ---------- */

function standingOf(v: unknown, index: number): StandingInput | undefined {
  if (!isObj(v)) return undefined;
  const team = str(pick(v, ["team", "teamName", "name", "club", "participant", "competitor", "Team"]));
  const points = parseIntSafe(pick(v, ["points", "pts", "Points", "point"]));
  if (!team || points == null) return undefined;
  const played = parseIntSafe(pick(v, ["played", "matches", "gp", "mp", "games", "matchesPlayed", "p"]));
  const position = parseIntSafe(pick(v, ["position", "rank", "pos", "place", "ranking"])) ?? index + 1;
  let gf = parseIntSafe(pick(v, ["goalsFor", "gf", "scored", "for", "goalsScored", "goals_for"]));
  let ga = parseIntSafe(pick(v, ["goalsAgainst", "ga", "conceded", "against", "goalsConceded", "goals_against"]));
  const goals = pick(v, ["goals", "goalDiff"]);
  if (gf == null && typeof goals === "string" && parseScore(goals)) [gf, ga] = parseScore(goals)!;
  const form = pick(v, ["form", "lastResults", "last5", "recentForm"]);
  return {
    team,
    position,
    points,
    played: played ?? 0,
    won: parseIntSafe(pick(v, ["won", "wins", "w"])),
    drawn: parseIntSafe(pick(v, ["drawn", "draws", "d", "draw"])),
    lost: parseIntSafe(pick(v, ["lost", "losses", "l", "loss"])),
    goals_for: gf ?? 0,
    goals_against: ga ?? 0,
    form: typeof form === "string" ? form : Array.isArray(form) ? form.map(String).join("") : undefined,
  };
}

function asStandings(arr: unknown[]): StandingInput[] | undefined {
  if (arr.length < 4) return undefined;
  const rows = arr.map(standingOf);
  if (rows.filter(Boolean).length < Math.max(4, arr.length * 0.8)) return undefined;
  return rows.filter((r): r is StandingInput => !!r);
}

/* ---------- Parcours ---------- */

export function normalizeJson(data: unknown, capturedAt = new Date().toISOString()): NormalizedBatch {
  const out = emptyBatch();
  const reference = new Date(capturedAt);
  const seen = new Set<unknown>();

  const visit = (node: unknown, ctx: Ctx, depth: number, parentKey = "") => {
    if (depth > 16 || node == null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const st = asStandings(node);
      if (st) {
        for (const s of st) out.standings.push({ ...s, league: ctx.league, season: ctx.season, round: ctx.round });
        return;
      }
      for (const item of node) visit(item, ctx, depth + 1, parentKey);
      return;
    }
    const obj = node as Obj;
    const teams = teamsOf(obj);
    if (teams) {
      const m = eventOf(obj, teams, ctx);
      if (m) {
        out.matches.push(m.match);
        out.odds.push(...m.odds);
        return;
      }
    }
    // Contexte transmis aux enfants : ligue, saison, journée
    const next: Ctx = { ...ctx };
    const lg = leagueOf(obj) ?? (/(league|tournament|competition)/i.test(parentKey) ? str(obj) : undefined);
    if (lg) next.league = lg;
    const se = seasonOf(obj);
    if (se) next.season = se;
    const ro = roundOf(obj) ?? (/(round|matchday|week|journee)/i.test(parentKey) ? parseRound(pick(obj, ["number", "roundNumber", "id", "name", "index"])) : undefined);
    if (ro != null) next.round = ro;
    for (const [k, v] of Object.entries(obj)) visit(v, next, depth + 1, k);
  };

  visit(data, { reference }, 0);
  return out;
}

function eventOf(obj: Obj, [home, away]: [string, string], ctx: Ctx): { match: MatchInput; odds: OddsInput[] } | undefined {
  const kickoff = parseTime(pick(obj, TIME_KEYS), ctx.reference);
  const score = scoreOf(obj);
  const rawId = pick(obj, ID_KEYS);
  const round = roundOf(obj) ?? ctx.round;
  const league = leagueOf(obj) ?? ctx.league;
  const season = seasonOf(obj) ?? ctx.season;
  const hasSignal = rawId != null || kickoff != null || score != null || round != null;
  const id = typeof rawId === "string" || typeof rawId === "number" ? String(rawId) : undefined;
  const fuzzy = !id && round == null && !kickoff;
  const externalId = id ?? `h${hash([league, season, round, kickoff, home, away].join("|"))}`;
  const odds: OddsInput[] = [];
  collectOdds(obj, externalId, odds);
  if (!odds.length) directOdds(obj, externalId, odds);
  if (!hasSignal && !odds.length) return undefined;
  const status = statusOf(obj, !!score, kickoff, ctx.reference);
  return {
    match: {
      external_id: externalId,
      league,
      season,
      round,
      home_team: home,
      away_team: away,
      kickoff_at: kickoff,
      status,
      home_score: score?.[0],
      away_score: score?.[1],
      fuzzy,
    },
    odds,
  };
}

/** Normalise un texte qui contient du JSON (réponse HTTP, trame WebSocket). */
export function normalizeJsonText(text: string, capturedAt?: string): NormalizedBatch {
  const t = text.trim();
  // Trames Socket.IO « 42["event",{...}] » et SignalR terminées par \x1e
  const candidates = t.split("\x1e").map((p) => p.trim().replace(/^\d+(?=[[{])/, "")).filter(Boolean);
  const out = emptyBatch();
  for (const c of candidates) {
    if (!/^[[{]/.test(c)) continue;
    try {
      const b = normalizeJson(JSON.parse(c), capturedAt);
      out.matches.push(...b.matches);
      out.odds.push(...b.odds);
      out.standings.push(...b.standings);
    } catch {
      /* pas du JSON valide */
    }
  }
  return out;
}
