/**
 * Base locale du téléphone (IndexedDB), au modèle du cahier des charges :
 * sources, raw_captures, matches, odds, standings + journal des cycles.
 */
import Dexie, { type Table } from "dexie";
import { adapterFor } from "./normalize/adapters";
import { hash, teamKey } from "./normalize/util";
import {
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
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export interface IngestResult {
  stored: boolean;
  duplicate: boolean;
  matches: number;
  odds: number;
  standings: number;
  error?: string;
}

/**
 * Enregistre une capture brute puis la normalise (cycle complet).
 * Une capture identique à une capture récente n'est pas ré-enregistrée.
 */
export async function ingestCapture(
  db: MatchScoresDB,
  input: Omit<RawCapture, "id" | "hash" | "captured_at"> & { captured_at?: string },
): Promise<IngestResult> {
  const started = Date.now();
  const capture: RawCapture = { ...input, captured_at: input.captured_at ?? new Date().toISOString(), hash: hash(input.kind + "|" + input.payload) };
  const prev = await db.raw_captures.where("[source_id+hash]").equals([capture.source_id, capture.hash]).last();
  if (prev && Date.parse(capture.captured_at) - Date.parse(prev.captured_at) < DUPLICATE_WINDOW_MS) {
    await db.cycles.add({
      source_id: capture.source_id,
      started_at: capture.captured_at,
      duration_ms: Date.now() - started,
      kind: capture.kind,
      url: capture.url.slice(0, 300),
      matches: 0,
      odds: 0,
      standings: 0,
      unchanged: true,
    });
    return { stored: false, duplicate: true, matches: 0, odds: 0, standings: 0 };
  }
  capture.id = await db.raw_captures.add(capture);
  let batch: NormalizedBatch = { matches: [], odds: [], standings: [] };
  let error: string | undefined;
  try {
    batch = adapterFor(capture.source_id)(capture);
    await applyBatch(db, capture.source_id, batch, KIND_METHOD[capture.kind], capture.captured_at);
  } catch (e) {
    error = (e as Error).message;
  }
  await db.cycles.add({
    source_id: capture.source_id,
    started_at: capture.captured_at,
    duration_ms: Date.now() - started,
    kind: capture.kind,
    url: capture.url.slice(0, 300),
    matches: batch.matches.length,
    odds: batch.odds.length,
    standings: batch.standings.length,
    error,
  });
  return { stored: true, duplicate: false, matches: batch.matches.length, odds: batch.odds.length, standings: batch.standings.length, error };
}

function sameMatch(existing: MatchRow, m: MatchInput, capturedAt: string): boolean {
  if (existing.round != null && m.round != null && existing.round !== m.round) return false;
  if (existing.season && m.season && existing.season !== m.season) return false;
  if (existing.kickoff_at && m.kickoff_at) {
    return Math.abs(Date.parse(existing.kickoff_at) - Date.parse(m.kickoff_at)) <= 30 * 60 * 1000;
  }
  // Ni heure commune : on se fie à la proximité dans le temps (un même couple revient à chaque saison virtuelle).
  return Date.parse(capturedAt) - Date.parse(existing.updated_at) <= SAME_MATCH_WINDOW_MS;
}

async function resolveKey(db: MatchScoresDB, sourceId: string, m: MatchInput, capturedAt: string): Promise<string> {
  const aliasKey = `${sourceId}|${m.external_id}`;
  const alias = await db.aliases.get(aliasKey);
  if (alias) return alias.key;
  const pair = `${teamKey(m.home_team)}|${teamKey(m.away_team)}`;
  const candidates = await db.matches.where("[source_id+pair]").equals([sourceId, pair]).toArray();
  const found = candidates.filter((c) => sameMatch(c, m, capturedAt)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const key = found?.key ?? aliasKey;
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

/** F7 : re-normalise toutes les captures brutes après une correction d'adaptateur. */
export async function renormalize(db: MatchScoresDB, onProgress?: (done: number, total: number) => void) {
  await db.transaction("rw", [db.matches, db.aliases, db.odds, db.standings], async () => {
    await Promise.all([db.matches.clear(), db.aliases.clear(), db.odds.clear(), db.standings.clear()]);
  });
  const total = await db.raw_captures.count();
  let done = 0;
  const all = await db.raw_captures.orderBy("id").toArray();
  for (const c of all) {
    try {
      await applyBatch(db, c.source_id, adapterFor(c.source_id)(c), KIND_METHOD[c.kind], c.captured_at);
    } catch {
      /* capture illisible : ignorée */
    }
    onProgress?.(++done, total);
  }
}

/** Conservation limitée des captures brutes (place sur le téléphone). */
export async function pruneRawCaptures(db: MatchScoresDB, days = 7) {
  const limit = new Date(Date.now() - days * 86400_000).toISOString();
  await db.raw_captures.where("captured_at").below(limit).delete();
  await db.cycles.where("started_at").below(limit).delete();
}

export async function getSetting<T>(db: MatchScoresDB, key: string, fallback: T): Promise<T> {
  return ((await db.settings.get(key))?.value as T) ?? fallback;
}

export async function setSetting(db: MatchScoresDB, key: string, value: unknown) {
  await db.settings.put({ key, value });
}

export const methodOfKind = (k: CaptureKind) => KIND_METHOD[k];
