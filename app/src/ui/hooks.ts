import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { db } from "../db";
import { categoryResolver, guessCategory, type LeagueOverrides } from "../core/category";
import { setSetting } from "../core/store";
import type { Category, MatchRow, OddsRow, StandingRow } from "../core/types";

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

/** Virtuel ou réel : ce que montrent les onglets (virtuel par défaut). */
export function useCategory(): [Category, (c: Category) => void] {
  return useSetting<Category>("viewCategory", "virtual");
}

const NO_OVERRIDES: LeagueOverrides = {};

/** Corrections de l'utilisateur : ligue → virtuel ou réel (Réglages → Ligues). */
export function useLeagueOverrides(): [LeagueOverrides, (o: LeagueOverrides) => void] {
  return useSetting<LeagueOverrides>("leagueCategory", NO_OVERRIDES);
}

const minute = () => Math.floor(Date.now() / 60_000) * 60_000;

/**
 * Matchs d'une source vus ces dernières heures, plus ceux dont le coup d'envoi est à venir
 * (matchs réels affichés plusieurs jours à l'avance), mis à jour en direct.
 */
export function useRecentMatches(source: string, hours = 3): MatchRow[] | undefined {
  useTick(60_000);
  const now = minute();
  const since = new Date(now - hours * 3600_000).toISOString();
  const from = new Date(now).toISOString();
  return useLiveQuery(async () => {
    const [recent, future] = await Promise.all([db.matches.where("updated_at").above(since).toArray(), db.matches.where("kickoff_at").above(from).toArray()]);
    const byKey = new Map<string, MatchRow>();
    for (const m of [...recent, ...future]) if (m.source_id === source) byKey.set(m.key, m);
    return [...byKey.values()];
  }, [source, since, from]);
}

/** Derniers matchs terminés d'une source (les plus récents d'abord), mis à jour en direct. */
export function useFinishedMatches(source: string, limit = 600): MatchRow[] | undefined {
  return useLiveQuery(
    () =>
      db.matches
        .orderBy("updated_at")
        .reverse()
        .filter((m) => m.source_id === source && m.status === "finished")
        .limit(limit)
        .toArray(),
    [source, limit],
  );
}

export interface Scoped {
  category: Category;
  /** Catégorie affichée d'un match : correction de l'utilisateur, ligue, page où il a été vu. */
  categoryOf: (m: Pick<MatchRow, "league" | "category" | "round">) => Category;
  /** Matchs de la catégorie affichée. */
  matches: MatchRow[] | undefined;
}

/** Ne garde que les matchs de la catégorie affichée (virtuel ou réel). */
export function useScoped(list: MatchRow[] | undefined): Scoped {
  const [category] = useCategory();
  const [overrides] = useLeagueOverrides();
  return useMemo(() => {
    const categoryOf = categoryResolver(list ?? [], overrides);
    return { category, categoryOf, matches: list?.filter((m) => categoryOf(m) === category) };
  }, [list, overrides, category]);
}

/** Dernier classement enregistré d'une source dans la catégorie affichée (même ligue, saison et journée), trié par position. */
export function useLatestStandings(source: string): StandingRow[] | undefined {
  const [category] = useCategory();
  const [overrides] = useLeagueOverrides();
  return useLiveQuery(async () => {
    const last = await db.standings
      .orderBy("captured_at")
      .reverse()
      .filter((r) => r.source_id === source && (overrides[r.league] ?? r.category ?? guessCategory(r)) === category)
      .first();
    if (!last) return [];
    const rows = await db.standings.where("[source_id+league+season]").equals([source, last.league, last.season]).toArray();
    return rows.filter((r) => r.round === last.round).sort((a, b) => a.position - b.position);
  }, [source, category, overrides]);
}

export function useOddsFor(keys: string[]): Map<string, OddsRow[]> | undefined {
  const sig = keys.join(",");
  return useLiveQuery(async () => {
    const rows = keys.length ? await db.odds.where("match_key").anyOf(keys).toArray() : [];
    const map = new Map<string, OddsRow[]>();
    for (const r of rows) {
      const list = map.get(r.match_key);
      if (list) list.push(r);
      else map.set(r.match_key, [r]);
    }
    return map;
  }, [sig]);
}

/**
 * Calcul lourd (bilan, historique) relancé toutes les `ms` et quand `deps` changent,
 * plutôt qu'à chaque capture enregistrée : l'appli reste fluide pendant la collecte.
 */
export function usePolled<T>(fn: () => Promise<T>, deps: unknown[], ms = 30_000): T | undefined {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    let alive = true;
    let running = false;
    // Autre catégorie, autre match : pas de valeur de l'ancien calcul le temps du nouveau
    setValue(undefined);
    const run = async () => {
      if (running) return;
      running = true;
      try {
        const v = await fn();
        if (alive) setValue(() => v);
      } catch {
        /* base en cours de fermeture */
      } finally {
        running = false;
      }
    };
    run();
    const id = setInterval(run, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** Force un nouveau rendu régulier (comptes à rebours, « il y a… »). */
export function useTick(ms = 1000) {
  const [, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
