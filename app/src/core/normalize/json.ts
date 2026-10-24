/**
 * Adaptateur JSON générique (méthodes B et C) : reconnaît dans n'importe quelle
 * réponse JSON les matchs (équipes, heure, statut, score, journée), leurs cotes
 * et les classements, sans dépendre des noms de champs exacts du site.
 */
import { emptyBatch, type MatchInput, type MatchStatus, type NormalizedBatch, type OddsInput, type StandingInput } from "../types";
import { competitionOf } from "./competition";
import {
  classifyMarket,
  isComplete,
  looksLikeMarket,
  marketIdName,
  NO_SCOPE,
  normalizeSelection,
  outcomeIdLabel,
  words,
  type MarketScope,
} from "./markets";
import {
  cleanName,
  hash,
  isObj,
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
const TIME_KEYS = [
  "startTime",
  "estimateStartTime",
  "estimatedStartTime",
  "eventStartTime",
  "matchStartTime",
  "startTimestamp",
  "start",
  "startDate",
  "kickoff",
  "kickOff",
  "kickoffTime",
  "eventDate",
  "date",
  "matchTime",
  "scheduled",
  "scheduledTime",
  "startsAt",
  "time",
  "dateTime",
];
const STATUS_KEYS = ["status", "state", "eventStatus", "matchStatus", "phase", "statusName"];
const LEAGUE_KEYS = ["league", "leagueName", "tournament", "tournamentName", "competition", "competitionName", "championship", "categoryName"];
const SEASON_KEYS = ["season", "seasonId", "seasonName", "seasonNumber"];
const ROUND_KEYS = ["round", "roundNumber", "matchday", "matchDay", "week", "weekNumber", "gameDay", "journee", "roundName", "eventBlock"];
const ODDS_KEYS = ["odds", "odd", "price", "coef", "coefficient", "rate", "value", "decimal", "decimalOdds", "o", "Odds", "Price"];
const LABEL_KEYS = ["name", "label", "outcome", "outcomeName", "selection", "selectionName", "type", "shortName", "code", "n", "title", "Name", "desc", "outcomeDesc", "displayName"];
/** Champs qui peuvent porter le nom d'un marché : tous sont lus (« title: "1,X,2" » ne doit pas cacher « desc: "1st Half - 1X2" »). */
const MARKET_NAME_KEYS = [
  "marketName",
  "name",
  "market",
  "betType",
  "type",
  "title",
  "description",
  "desc",
  "marketDesc",
  "displayName",
  "label",
  "caption",
  "text",
  "typeName",
  "marketTypeName",
  "marketType",
  "header",
  "groupName",
  "marketCode",
  "marketId",
  "betTypeName",
  "betName",
  "marketTitle",
  "marketLabel",
  "oddsType",
  "shortName",
];
const LINE_KEYS = ["line", "handicap", "hcp", "specialValue", "specialBetValue", "sv", "total", "points", "specifier", "specifiers"];
/** Champs qui disent la période d'un groupe de marchés (« period: "HT" », « periodType: "FIRST_HALF" »). */
const PERIOD_FIELD = /^(period|periodid|periodtype|periodname|part|phase|scope|segment|subtype|stage|timeframe|halftype)$/i;
/** Clés conteneurs sans signification pour le marché. */
const GENERIC_KEY = /^(markets?|selections?|outcomes?|odds|prices?|bets?|items|list|data|values?|options|choices|lines|rows|entries|children|groups?|tabs|sections|categories|marketgroups|betgroups|parts|main|mainmarkets|offers?)$/i;

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return cleanName(v);
  if (typeof v === "number") return undefined;
  if (isObj(v)) {
    const n = pick(v, NAME_KEYS);
    if (typeof n === "string" && n.trim()) return cleanName(n);
  }
  return undefined;
}

/** Nom d'équipe plausible : ni un nombre, ni une cote (« 2.10 »). */
const isTeamName = (s: string) => !/^\s*\d+(?:[.,]\d+)?\s*$/.test(s);

function teamsOf(obj: Obj): [string, string] | undefined {
  const h = str(pick(obj, HOME_KEYS));
  const a = str(pick(obj, AWAY_KEYS));
  if (h && a && h !== a && isTeamName(h) && isTeamName(a)) return [h, a];
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
    // « Arsenal - Chelsea », mais pas « 1st Half - 1X2 » ni « 1ère mi-temps - Résultat » (un nom de marché)
    const m = name.match(/^(.{2,50}?)\s+(?:-|–|vs\.?|v)\s+(.{2,50})$/i);
    // Ni « Suède - D1 Suède » (une compétition)
    if (m && !competitionOf(name) && !/\d+[.,]\d+$/.test(m[2]) && !looksLikeMarket(m[1]) && !looksLikeMarket(m[2])) return [cleanName(m[1]), cleanName(m[2])];
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
  /** Identifiant de l'issue (formats Sporty-tech : 1, 2, 3 pour domicile, nul, extérieur). */
  id?: string;
}

function selectionOf(v: unknown): Sel | undefined {
  if (!isObj(v)) return undefined;
  const odds = parseOdds(pick(v, ODDS_KEYS));
  if (!odds) return undefined;
  const raw = pick(v, LABEL_KEYS);
  const id = pick(v, ["id", "outcomeId", "Id"]);
  return { label: typeof raw === "string" || typeof raw === "number" ? String(raw) : "", odds, id: typeof id === "string" || typeof id === "number" ? String(id) : undefined };
}

/** Chaînes d'un champ de nom (y compris un nom traduit { fr, en }). */
function nameStrings(v: unknown): string[] {
  if (typeof v === "string") return v.trim() && !/^\s*\d+(?:[.,]\d+)?\s*$/.test(v) ? [v.trim()] : [];
  if (isObj(v)) return Object.values(v).flatMap((x) => (typeof x === "string" ? nameStrings(x) : []));
  return [];
}

/** Identifiant d'un marché au format Sporty-tech (reconnu à son champ « specifier »). */
const sportyMarketId = (obj: Obj) => ("specifier" in obj || "specifiers" in obj ? String(pick(obj, ["id", "marketId"]) ?? "") : "");

const fieldKey = (k: string) => k.toLowerCase().replace(/[_\-\s]/g, "");
const NAME_FIELDS = new Set(MARKET_NAME_KEYS.map(fieldKey));
const LINE_FIELDS = new Set(LINE_KEYS.map(fieldKey));

/** Tous les noms d'un marché, réunis : « 1X2 | 1,X,2 | total=2.5 » (champs lus sans tenir compte de la casse : Name, name, NAME). */
function marketNameOf(obj: Obj): string {
  const names = new Set<string>();
  const id = sportyMarketId(obj);
  if (id && marketIdName(id)) names.add(marketIdName(id));
  for (const [k, v] of Object.entries(obj)) {
    const f = fieldKey(k);
    if (NAME_FIELDS.has(f)) for (const n of nameStrings(v)) names.add(n);
    else if (LINE_FIELDS.has(f) && ((typeof v === "string" && v.trim()) || typeof v === "number")) names.add(`${k}=${v}`);
  }
  return [...names].join(" | ");
}

/** Marchés retenus : les autres listes de nombres (statistiques…) sont ignorées. */
export const KNOWN_MARKET = /^(1X2|12|DC|BTTS|CS|OU(\d+\.5)?)$/;

interface OddsCtx {
  externalId: string;
  out: OddsInput[];
  /** Équipes du match : un marché à leur nom (« Total Leeds ») ne concerne qu'une équipe. */
  teams: string[];
}

/** Ligne d'un libellé plus/moins : « Over 2.5 » → 2.5. */
const lineOf = (label: string) => (/^\s*(?:over|under|plus|moins|o|u|\+|-)/i.test(label) ? label.match(/(\d+[.,]5)/)?.[1]?.replace(",", ".") : undefined);
/** Ordre des issues : 1, X, 2, puis 1X, 12, X2, Over, Under, Oui, Non. */
const ORDER = ["1", "X", "2", "1X", "12", "X2", "Over", "Under", "Oui", "Non"];

function addMarket(ctx: OddsCtx, name: string, sels: Sel[], scope: MarketScope, marketId = ""): void {
  // Issues sans libellé d'un marché identifié par son numéro (formats Sporty-tech)
  let labeled = sels.map((s) => ({ ...s, label: s.label || (marketId && s.id ? (outcomeIdLabel(marketId, s.id) ?? "") : "") }));
  // Issues numérotées 1, 2, 3 (domicile, nul, extérieur)
  if (labeled.length === 3 && labeled.map((s) => s.label.trim()).join(",") === "1,2,3") labeled = labeled.map((s, i) => ({ ...s, label: ["1", "X", "2"][i] }));
  // Plusieurs lignes dans une même liste (« Over 1.5 », « Under 1.5 », « Over 2.5 »…) : un marché par ligne
  const lines = [...new Set(labeled.map((s) => lineOf(s.label)))];
  if (labeled.length >= 4 && lines.length >= 2 && lines.every(Boolean)) {
    for (const l of lines) addMarket(ctx, `${name} ${l}`, labeled.filter((s) => lineOf(s.label) === l), scope, marketId);
    return;
  }
  const market = classifyMarket({ name, labels: labeled.map((s) => s.label), scope, teams: ctx.teams });
  if (!KNOWN_MARKET.test(market)) return;
  // Un seul marché de chaque sorte par match : le premier (celui du match entier, affiché en tête)
  if (ctx.out.some((o) => o.external_id === ctx.externalId && o.market === market)) return;
  const picked = labeled.map((s, i) => ({ selection: normalizeSelection(s.label, i, labeled.length, market, ctx.teams), value: s.odds }));
  // Issues incomplètes ou en double : le marché n'est pas celui qu'on croit, il n'est pas gardé
  if (!isComplete(market, picked.map((p) => p.selection ?? "?"))) return;
  const rank = (x: string) => (ORDER.includes(x) ? ORDER.indexOf(x) : ORDER.length);
  for (const p of [...picked].sort((a, b) => rank(a.selection!) - rank(b.selection!))) ctx.out.push({ external_id: ctx.externalId, market, selection: p.selection!, value: p.value });
}

/** Issue d'une clé de dictionnaire de cotes : { "1": 2.1, "N": 3.3, "2": 3.4, "1X": 1.3… }. */
function dictOutcome(k: string): string | undefined {
  const w = words(k).join("");
  if (/^(1|h|home|homewin|w1|p1|domicile)$/.test(w)) return "1";
  if (/^(x|n|d|draw|nul|tie)$/.test(w)) return "X";
  if (/^(2|a|away|awaywin|w2|p2|exterieur)$/.test(w)) return "2";
  if (/^(1x|12|x2)$/.test(w)) return w.toUpperCase();
  return undefined;
}

const dictOdds = (v: unknown) => parseOdds(v) ?? (isObj(v) ? parseOdds(pick(v, ODDS_KEYS)) : undefined);

/**
 * Cotes d'un match : parcourt les marchés en gardant leur contexte (`scope` : clés et noms des
 * parents, valeurs des champs « période ») pour reconnaître une mi-temps, un handicap…
 */
function collectOdds(node: unknown, ctx: OddsCtx, name = "", scope: MarketScope = NO_SCOPE, depth = 0, root = false): void {
  if (depth > 7 || node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    const sels = node.map(selectionOf);
    if (node.length >= 2 && sels.every((s): s is Sel => !!s)) {
      addMarket(ctx, name, sels, scope);
      return;
    }
    const nums = node.map(parseOdds);
    // Une liste de nombres sous un nom de statistique (minutes des buts, identifiants…) n'est pas une cote
    const stat = /(minute|time|goal|score|stat|count|^id|ids$|position|point|round|number|year|date|age|rank)/i.test(name) && !/(odds?|cote|price|1x2|1n2)/i.test(name);
    if ((node.length === 2 || node.length === 3) && !stat && nums.every((n): n is number => n != null)) {
      // Tableau de cotes : 1 / X / 2, ou 1X / 12 / X2 si c'est une double chance ; à deux cotes, plus / moins ou oui / non selon le nom
      const two = /(over|under|plus|moins|total|o\/?u\b|ou\s?\d)/i.test(name) ? ["Over", "Under"] : /(btts|gg|both)/i.test(name) ? ["Yes", "No"] : ["1", "2"];
      const labels = node.length === 3 ? ["1", "X", "2"] : two;
      const dc = node.length === 3 && classifyMarket({ name, labels, scope, teams: ctx.teams }) === "DC";
      addMarket(ctx, (name.replace(/^ou(\d)/i, "Over/Under $1") || (node.length === 3 ? "1X2" : "12")), nums.map((odds, i) => ({ label: dc ? ["1X", "12", "X2"][i] : labels[i], odds })), scope);
      return;
    }
    for (const item of node) collectOdds(item, ctx, name, scope, depth + 1);
    return;
  }
  const obj = node as Obj;
  const entries = Object.entries(obj);
  // Cotes en dictionnaire : { "1": 1.85, "X": 3.4, "2": 4.2 }, { "1": …, "N": …, "2": …, "1X": … }, { home: { odds } … }
  const dict = entries.map(([k, v]) => ({ o: dictOutcome(k), odds: dictOdds(v) }));
  if (entries.length >= 2 && entries.length <= 6 && dict.every((d) => d.o && d.odds)) {
    // Ordre 1, X, 2 (JavaScript range les clés « 1 », « 2 » avant « X »)
    const rank = (o: string) => ["1", "X", "2", "1X", "12", "X2"].indexOf(o);
    const sorted = [...dict].sort((a, b) => rank(a.o!) - rank(b.o!));
    const main = sorted.filter((d) => d.o!.length === 1);
    const dc = sorted.filter((d) => d.o!.length === 2);
    if (main.length >= 2) addMarket(ctx, name || "1X2", main.map((d) => ({ label: d.o!, odds: d.odds! })), scope);
    if (dc.length === 3) addMarket(ctx, "Double chance", dc.map((d) => ({ label: d.o!, odds: d.odds! })), scope);
    return;
  }
  // Issues en dictionnaire indexé : { "1": { desc: "Home", odds }, "2": { desc: "Draw", odds }… }
  if (!root && entries.length >= 2 && entries.every(([k, v]) => /^\d+$/.test(k) && selectionOf(v))) {
    addMarket(ctx, name, entries.map(([, v]) => selectionOf(v)!), scope);
    return;
  }
  // Le nom du match lui-même (« Leeds - Burnley ») n'est pas un nom de marché
  const own = root ? "" : marketNameOf(obj);
  const current = own || name;
  const marketId = root ? "" : sportyMarketId(obj);
  // Marché aux issues sans libellé, identifié par son numéro
  if (marketId) {
    for (const [, v] of entries) {
      if (!Array.isArray(v)) continue;
      const sels = v.map(selectionOf);
      if (v.length >= 2 && sels.every((x): x is Sel => !!x) && sels.some((x) => !x.label)) {
        addMarket(ctx, current, sels, scope, marketId);
        return;
      }
    }
  }
  // Période d'un groupe : « HT », « FIRST_HALF », ou numérotée (1, 2 : mi-temps ; 0 : match entier)
  const periods = root
    ? []
    : entries.filter(([k, v]) => PERIOD_FIELD.test(k) && (typeof v === "string" || v === 1 || v === 2)).map(([, v]) => (typeof v === "number" ? `half${v}` : (v as string)));
  for (const [k, v] of entries) {
    if (!v || typeof v !== "object") continue;
    const key = /^\d+$/.test(k) ? "" : k;
    const childScope: MarketScope = {
      keys: `${scope.keys} ${key}`.trim(),
      names: [scope.names, own, ...periods].filter(Boolean).join(" | "),
    };
    // Un conteneur nommé par sa clé (« dc », « ht », « 1x2 ») donne ce nom à son contenu
    const keyName = key && !GENERIC_KEY.test(key) ? key : "";
    collectOdds(v, ctx, Array.isArray(v) ? keyName || current : (isObj(v) ? marketNameOf(v) : "") || keyName || current, childScope, depth + 1);
  }
}

function directOdds(obj: Obj, ctx: OddsCtx) {
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
      addMarket(ctx, sels.length === 3 ? "1X2" : "12", sels.map((odds, i) => ({ label: sels.length === 3 ? ["1", "X", "2"][i] : ["1", "2"][i], odds: odds! })), NO_SCOPE);
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
    // « Suède - D1 Suède » : la compétition seule, comme dans le texte de la page
    if (lg) next.league = competitionOf(lg)?.league ?? lg;
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
  const oddsCtx: OddsCtx = { externalId, out: odds, teams: [home, away] };
  collectOdds(obj, oddsCtx, "", NO_SCOPE, 0, true);
  if (!odds.length) directOdds(obj, oddsCtx);
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
