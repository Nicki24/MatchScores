import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "../db";
import { setSetting } from "../core/store";
import type { MatchRow, OddsRow, StandingRow } from "../core/types";

/** Source affichée : réglage, sinon celle qui a des données (bet261 en priorité). */
export function useViewSource(): [string, (id: string) => void] {
  const setting = useLiveQuery(() => db.settings.get("viewSource"), []);
  const withData = useLiveQuery(async () => {
    const ids: string[] = [];
    for (const id of ["bet261", "demo"]) if (await db.matches.where("source_id").equals(id).count()) ids.push(id);
    return ids;
  }, []);
  const chosen = (setting?.value as string | undefined) ?? withData?.[0] ?? "bet261";
  return [chosen, (id) => setSetting(db, "viewSource", id)];
}

export function useSetting<T>(key: string, fallback: T): [T, (v: T) => void] {
  const row = useLiveQuery(() => db.settings.get(key), [key]);
  return [(row?.value as T | undefined) ?? fallback, (v: T) => setSetting(db, key, v)];
}

/** Matchs d'une source (les plus récents d'abord), mis à jour en direct. */
export function useMatches(source: string, limit = 600): MatchRow[] | undefined {
  return useLiveQuery(
    () =>
      db.matches
        .orderBy("updated_at")
        .reverse()
        .filter((m) => m.source_id === source)
        .limit(limit)
        .toArray(),
    [source, limit],
  );
}

/** Dernier classement enregistré d'une source (même ligue, saison et journée), trié par position. */
export function useLatestStandings(source: string): StandingRow[] | undefined {
  return useLiveQuery(async () => {
    const last = await db.standings
      .orderBy("captured_at")
      .reverse()
      .filter((r) => r.source_id === source)
      .first();
    if (!last) return [];
    const rows = await db.standings.where("[source_id+league+season]").equals([source, last.league, last.season]).toArray();
    return rows.filter((r) => r.round === last.round).sort((a, b) => a.position - b.position);
  }, [source]);
}

export function useOddsFor(keys: string[]): Map<string, OddsRow[]> | undefined {
  const sig = keys.join(",");
  return useLiveQuery(async () => {
    const rows = keys.length ? await db.odds.where("match_key").anyOf(keys).toArray() : [];
    const map = new Map<string, OddsRow[]>();
    for (const r of rows) map.set(r.match_key, [...(map.get(r.match_key) ?? []), r]);
    return map;
  }, [sig]);
}

/** Force un nouveau rendu régulier (comptes à rebours, « il y a… »). */
export function useTick(ms = 1000) {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
