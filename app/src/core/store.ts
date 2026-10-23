/**
 * Base locale du téléphone (IndexedDB), au modèle du cahier des charges :
 * sources, raw_captures, matches, odds, standings + journal des cycles.
 */
import Dexie, { type Table } from "dexie";
import { adapterFor } from "./normalize/adapters";
import { hash, teamKey } from "./normalize/util";
import {
  emptyBatch,
  KIND_METHOD,
  type CaptureKind,
  type CycleLog,
  type MatchInput,
  type MatchRow,
  type MatchStatus,
  type Method,
  type NormalizedBatch,
  type OddsRow,
  type RawCapture,
  type Source,
  type StandingRow,
} from "./types";

export interface Alias {
  alias: string;
  key: string;
}
export interface Check {
  match_key: string;
  ok: boolean;
  checked_at: string;
}
export interface Setting {
  key: string;
  value: unknown;
}

/** Ce que la base retient en mémoire de chaque flux (une adresse sans paramètres, ou une page pour le texte). */
interface StreamState {
  /** Empreinte de la dernière lecture enregistrée et son heure. */
  sig?: string;
  storedAt?: number;
  /** Réponses où rien n'est reconnu : dernière gardée, par forme de contenu. */
  emptyAt: Map<string, number>;
  /** Minute de la dernière ligne de journal « inchangé » et « rien de reconnu ». */
  quietMinute: { unchanged?: string; empty?: string };
}

export class MatchScoresDB extends Dexie {
  sources!: Table<Source, string>;
  raw_captures!: Table<RawCapture, number>;
  matches!: Table<MatchRow, string>;
  aliases!: Table<Alias, string>;
  odds!: Table<OddsRow, number>;
  standings!: Table<StandingRow, string>;
  cycles!: Table<CycleLog, number>;
  checks!: Table<Check, string>;
  settings!: Table<Setting, string>;
  /** État des flux depuis le lancement (non enregistré). */
  readonly streams = new Map<string, StreamState>();

  constructor(name = "matchscores") {
    super(name);
    this.version(1).stores({
      sources: "id",
      raw_captures: "++id, source_id, captured_at, [source_id+hash], kind",
      matches: "key, source_id, [source_id+pair], status, kickoff_at, round, updated_at, first_seen_at",
      aliases: "alias",
      odds: "++id, match_key, [match_key+market+selection], captured_at",
      standings: "key, [source_id+league+season], captured_at",
      cycles: "++id, started_at, source_id",
      checks: "match_key",
      settings: "key",
    });
  }
}

export const DEFAULT_SOURCES: Source[] = [
  { id: "bet261", name: "bet261 — football virtuel", method: "C", enabled: true, startUrl: "https://bet261.mg/" },
  { id: "demo", name: "Démo (données simulées)", method: "C", enabled: false },
];

export async function ensureSources(db: MatchScoresDB) {
  for (const s of DEFAULT_SOURCES) if (!(await db.sources.get(s.id))) await db.sources.put(s);
}

const STATUS_ORDER: Record<MatchStatus, number> = { scheduled: 0, live: 1, finished: 2 };
/** Durée maximale pendant laquelle un même couple d'équipes sans journée/heure est considéré comme le même match. */
const SAME_MATCH_WINDOW_MS = 60 * 60 * 1000;
/** Au-delà de ce délai après la fin d'un match, la même affiche « à venir » est un nouveau match (saison suivante). */
const REPLAY_GAP_MS = 10 * 60 * 1000;
/** Une lecture identique à la précédente du même flux n'est ré-enregistrée qu'après ce délai. */
const UNCHANGED_WINDOW_MS = 10 * 60 * 1000;
/** Réponse où rien n'est reconnu : un exemplaire par flux et par forme de contenu suffit sur cette durée (relevé, F7). */
const EMPTY_KEEP_MS = 2 * 60 * 1000;

const urlPath = (u: string) => {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch {
    return u.split("?")[0];
  }
};

/** Flux d'une capture : même adresse sans paramètres ou, pour le texte affiché, même page. */
export const streamOf = (c: Pick<RawCapture, "source_id" | "kind" | "url" | "frame">) =>
  `${c.source_id}|${c.kind}|${urlPath(c.kind === "dom" ? (c.frame ?? c.url) : c.url)}`;

/** Forme d'un contenu : son début, chiffres effacés (deux messages du même type ont la même forme). */
const shapeOf = (payload: string) => hash(payload.slice(0, 200).replace(/\d+/g, "#"));

export interface IngestResult {
  /** Capture brute enregistrée dans raw_captures. */
  stored: boolean;
  /** Même lecture que la dernière enregistrée : la source a répondu, ses données sont déjà prises en compte. */
  unchanged: boolean;
  matches: number;
  odds: number;
  standings: number;
  error?: string;
}

/**
 * Lit une capture puis l'enregistre (cycle complet). Pour ménager le téléphone, la capture brute
 * n'est gardée que si sa lecture apporte du nouveau : une page dont seul un compte à rebours change
 * n'est pas ré-enregistrée toutes les 2 secondes. Les réponses illisibles sont gardées par échantillons.
 */
export async function ingestCapture(
  db: MatchScoresDB,
  input: Omit<RawCapture, "id" | "hash" | "captured_at"> & { captured_at?: string },
): Promise<IngestResult> {
  const started = Date.now();
  const capture: RawCapture = { ...input, captured_at: input.captured_at ?? new Date().toISOString(), hash: hash(input.kind + "|" + input.payload) };
  const at = Date.parse(capture.captured_at);
  const stream = streamOf(capture);
  const st = db.streams.get(stream) ?? { emptyAt: new Map<string, number>(), quietMinute: {} };
  db.streams.set(stream, st);
  const log = (counts: { matches: number; odds: number; standings: number }, extra: { unchanged?: boolean; error?: string } = {}) =>
    db.cycles.add({
      source_id: capture.source_id,
      started_at: capture.captured_at,
      duration_ms: Date.now() - started,
      kind: capture.kind,
      url: capture.url.slice(0, 300),
      ...counts,
      ...extra,
    });
  const quiet = async (unchanged: boolean, error?: string): Promise<IngestResult> => {
    // Journal (NF3) : une ligne par flux et par minute quand rien de nouveau n'arrive
    const minute = capture.captured_at.slice(0, 16);
    const kind = unchanged ? "unchanged" : "empty";
    if (st.quietMinute[kind] !== minute) {
      st.quietMinute[kind] = minute;
      await log({ matches: 0, odds: 0, standings: 0 }, { unchanged: unchanged || undefined, error });
    }
    return { stored: false, unchanged, matches: 0, odds: 0, standings: 0, error };
  };

  let batch: NormalizedBatch = emptyBatch();
  let error: string | undefined;
  try {
    batch = adapterFor(capture.source_id)(capture);
  } catch (e) {
    error = (e as Error).message;
  }
  const items = batch.matches.length + batch.odds.length + batch.standings.length;
  const sig = items ? hash(capture.kind + "|" + JSON.stringify(batch)) : undefined;
  // Même lecture que la dernière enregistrée pour ce flux (seul un compte à rebours a changé, par exemple)
  if (sig && sig === st.sig && st.storedAt != null && at - st.storedAt < UNCHANGED_WINDOW_MS) return quiet(true);
  if (!items) {
    const shape = shapeOf(capture.payload);
    const last = st.emptyAt.get(shape);
    if (last != null && at - last < EMPTY_KEEP_MS) return quiet(false, error);
    if (st.emptyAt.size > 200) st.emptyAt.clear();
    st.emptyAt.set(shape, at);
  }

  capture.items = items;
  try {
    capture.id = await db.raw_captures.add(capture);
    if (items) {
      await applyBatch(db, capture.source_id, batch, KIND_METHOD[capture.kind], capture.captured_at);
      st.sig = sig;
      st.storedAt = at;
    }
  } catch (e) {
    error = (e as Error).message;
  }
  await log({ matches: batch.matches.length, odds: batch.odds.length, standings: batch.standings.length }, { error });
  return { stored: capture.id != null, unchanged: false, matches: batch.matches.length, odds: batch.odds.length, standings: batch.standings.length, error };
}

/**
 * `sameId` : même identifiant que le match enregistré. Sans saison ni heure, l'identifiant d'un match lu dans
 * le texte (journée + équipes) revient à chaque saison virtuelle : il ne suffit pas à dire que c'est le même match.
 */
function sameMatch(existing: MatchRow, m: MatchInput, capturedAt: string, sameId = false): boolean {
  if (existing.round != null && m.round != null && existing.round !== m.round) return false;
  if (existing.season && m.season && existing.season !== m.season) return false;
  if (existing.kickoff_at && m.kickoff_at) {
    return Math.abs(Date.parse(existing.kickoff_at) - Date.parse(m.kickoff_at)) <= 30 * 60 * 1000;
  }
  // Ni heure commune : on se fie à la proximité dans le temps (un même couple revient à chaque saison virtuelle).
  const at = Date.parse(capturedAt);
  const incoming = m.status ?? "scheduled";
  // Un match commencé ne redevient pas « à venir » : passé quelques minutes, c'est l'affiche d'une saison suivante
  if (incoming !== "finished" && existing.status !== "scheduled" && at - Date.parse(existing.finished_at ?? existing.updated_at) > REPLAY_GAP_MS) return false;
  const recent = at - Date.parse(existing.updated_at) <= SAME_MATCH_WINDOW_MS;
  // Résultat relu plus tard sous le même identifiant : même match tant que le score est le même
  if (sameId && existing.status === "finished" && incoming === "finished") {
    return recent || (existing.home_score === m.home_score && existing.away_score === m.away_score);
  }
  return recent;
}

async function resolveKey(db: MatchScoresDB, sourceId: string, m: MatchInput, capturedAt: string): Promise<string> {
  const aliasKey = `${sourceId}|${m.external_id}`;
  const alias = await db.aliases.get(aliasKey);
  if (alias) {
    const known = await db.matches.get(alias.key);
    if (!known || sameMatch(known, m, capturedAt, true)) return alias.key;
  }
  const pair = `${teamKey(m.home_team)}|${teamKey(m.away_team)}`;
  const candidates = await db.matches.where("[source_id+pair]").equals([sourceId, pair]).toArray();
  const found = candidates.filter((c) => sameMatch(c, m, capturedAt)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  // Identifiant déjà pris par le même duel d'une saison précédente : nouvelle clé, l'alias suit le nouveau match
  const taken = !found && (await db.matches.get(aliasKey));
  const key = found?.key ?? (taken ? `${aliasKey}|${Date.parse(capturedAt).toString(36)}` : aliasKey);
  await db.aliases.put({ alias: aliasKey, key });
  return key;
}

export async function applyBatch(db: MatchScoresDB, sourceId: string, batch: NormalizedBatch, method: Method, capturedAt: string) {
  await db.transaction("rw", [db.matches, db.aliases, db.odds, db.standings], async () => {
    const keys = new Map<string, string>();
    for (const m of batch.matches) {
      const key = await resolveKey(db, sourceId, m, capturedAt);
      keys.set(m.external_id, key);
      const prev = await db.matches.get(key);
      const incomingStatus = m.status ?? "scheduled";
      const status: MatchStatus = prev && STATUS_ORDER[prev.status] > STATUS_ORDER[incomingStatus] ? prev.status : incomingStatus;
      const hasScore = m.home_score != null && m.away_score != null;
      const row: MatchRow = {
        key,
        source_id: sourceId,
        external_id: prev?.external_id ?? m.external_id,
        league: prev?.league ?? m.league,
        season: prev?.season ?? m.season,
        round: prev?.round ?? m.round,
        home_team: prev?.home_team ?? m.home_team,
        away_team: prev?.away_team ?? m.away_team,
        pair: `${teamKey(m.home_team)}|${teamKey(m.away_team)}`,
        kickoff_at: prev?.kickoff_at ?? m.kickoff_at,
        status,
        home_score: hasScore && (prev?.home_score == null || incomingStatus === "finished") ? m.home_score : prev?.home_score,
        away_score: hasScore && (prev?.away_score == null || incomingStatus === "finished") ? m.away_score : prev?.away_score,
        first_seen_at: prev?.first_seen_at ?? capturedAt,
        updated_at: capturedAt,
        finished_at: prev?.finished_at ?? (status === "finished" ? capturedAt : undefined),
        methods: [...new Set([...(prev?.methods ?? []), method])],
        score_method: prev?.score_method ?? (hasScore && incomingStatus === "finished" ? method : undefined),
        result_methods: hasScore && incomingStatus === "finished" ? [...new Set([...(prev?.result_methods ?? []), method])] : prev?.result_methods,
      };
      await db.matches.put(row);
    }

    for (const o of batch.odds) {
      const matchKey = keys.get(o.external_id) ?? (await db.aliases.get(`${sourceId}|${o.external_id}`))?.key;
      if (!matchKey) continue;
      const last = await db.odds
        .where("[match_key+market+selection]")
        .equals([matchKey, o.market, o.selection])
        .filter((x) => x.method === method)
        .last();
      // Historique : une ligne par changement de cote et par méthode (F2) — permet de comparer les méthodes entre elles
      if (!last || last.value !== o.value) {
        await db.odds.add({ match_key: matchKey, market: o.market, selection: o.selection, value: o.value, captured_at: capturedAt, method });
      }
    }

    if (batch.standings.length) {
      const league = batch.standings[0].league ?? (await latestLeague(db, sourceId)) ?? "";
      const season = batch.standings[0].season ?? "";
      // Sans journée indiquée : dans un championnat aller-retour, après la journée N chaque équipe a joué N matchs
      const maxPlayed = Math.max(0, ...batch.standings.map((s) => s.played));
      const round = batch.standings[0].round ?? (maxPlayed || ((await latestFinishedRound(db, sourceId)) ?? 0));
      for (const s of batch.standings) {
        const row: StandingRow = {
          key: [sourceId, league, season, round, teamKey(s.team)].join("|"),
          source_id: sourceId,
          league,
          season,
          round,
          team: s.team,
          position: s.position,
          points: s.points,
          played: s.played,
          won: s.won,
          drawn: s.drawn,
          lost: s.lost,
          goals_for: s.goals_for,
          goals_against: s.goals_against,
          form: s.form,
          captured_at: capturedAt,
        };
        await db.standings.put(row);
      }
    }
  });
}

async function latestLeague(db: MatchScoresDB, sourceId: string) {
  const m = await db.matches.where("source_id").equals(sourceId).reverse().sortBy("updated_at");
  return m.find((x) => x.league)?.league;
}

async function latestFinishedRound(db: MatchScoresDB, sourceId: string) {
  const m = await db.matches.where("source_id").equals(sourceId).filter((x) => x.status === "finished" && x.round != null).reverse().sortBy("updated_at");
  return m[0]?.round;
}

/**
 * F7 : re-normalise les captures brutes conservées après une correction d'adaptateur.
 * Ce qui précède la plus ancienne capture conservée est gardé tel quel.
 */
export async function renormalize(db: MatchScoresDB, onProgress?: (done: number, total: number) => void) {
  const oldest = await db.raw_captures.orderBy("captured_at").first();
  const total = await db.raw_captures.count();
  if (!oldest) return;
  const since = oldest.captured_at;
  await db.transaction("rw", [db.matches, db.aliases, db.odds, db.standings], async () => {
    const keys = await db.matches.where("first_seen_at").aboveOrEqual(since).primaryKeys();
    const removed = new Set(keys);
    await db.odds.where("match_key").anyOf(keys).delete();
    await db.matches.bulkDelete(keys);
    await db.aliases.filter((a) => removed.has(a.key)).delete();
    await db.standings.where("captured_at").aboveOrEqual(since).delete();
  });
  // Par paquets : les captures ne tiennent pas toutes en mémoire
  let done = 0;
  let lastId = 0;
  for (;;) {
    const chunk = await db.raw_captures.where("id").above(lastId).limit(100).toArray();
    if (!chunk.length) break;
    for (const c of chunk) {
      try {
        await applyBatch(db, c.source_id, adapterFor(c.source_id)(c), KIND_METHOD[c.kind], c.captured_at);
      } catch {
        /* capture illisible : ignorée */
      }
      onProgress?.(++done, total);
    }
    lastId = chunk[chunk.length - 1].id!;
  }
}

/** Conservation limitée (place sur le téléphone) : captures brutes 3 jours et 3 000 au plus, journal 7 jours. */
export async function pruneStorage(db: MatchScoresDB, { rawDays = 3, maxRaw = 3000, cycleDays = 7 } = {}) {
  const before = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
  await db.raw_captures.where("captured_at").below(before(rawDays)).delete();
  const excess = (await db.raw_captures.count()) - maxRaw;
  if (excess > 0) await db.raw_captures.bulkDelete(await db.raw_captures.orderBy("id").limit(excess).primaryKeys());
  await db.cycles.where("started_at").below(before(cycleDays)).delete();
}

/** Efface tout ce qui a été collecté (captures, matchs, cotes, classements, journal, vérifications) ; sources et réglages sont gardés. */
export async function clearCollectedData(db: MatchScoresDB) {
  const tables = [db.raw_captures, db.matches, db.aliases, db.odds, db.standings, db.cycles, db.checks];
  await db.transaction("rw", tables, () => Promise.all(tables.map((t) => t.clear())));
  db.streams.clear();
}

export async function getSetting<T>(db: MatchScoresDB, key: string, fallback: T): Promise<T> {
  return ((await db.settings.get(key))?.value as T) ?? fallback;
}

export async function setSetting(db: MatchScoresDB, key: string, value: unknown) {
  await db.settings.put({ key, value });
}

export const methodOfKind = (k: CaptureKind) => KIND_METHOD[k];
