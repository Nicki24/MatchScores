/**
 * Virtuel ou réel. En naviguant sur bet261, la collecte relève aussi les matchs réels
 * (page d'accueil, Sport, Live). Chaque match est classé d'après la page où il a été vu,
 * l'adresse des données, le nom de sa ligue et sa journée ; Réglages → Ligues corrige une ligue.
 */
import type { Category, MatchRow } from "./types";

/**
 * Page ou adresse de football virtuel (bet261 et fournisseurs de jeux virtuels courants).
 * « vfl » seulement comme élément entier d'adresse : « vfl-bochum » est une équipe réelle.
 */
const VIRTUAL_CONTEXT = /virtu|instant|vfoot|v-?football|vsoccer|vleague|(?:^|[/.])vfl(?:[/.?#]|$)|kiron|golden-?race|leap-?gaming|globalbet|inbet|edge-?gaming|nsoft/i;
/** Ligue virtuelle : « English League », « Virtual Football », « Instant League »… */
const VIRTUAL_LEAGUE =
  /virtu|instant|simul|\bv-?(?:football|league|soccer)\b|^(?:english|spanish|italian|german|french|dutch|portuguese|turkish)\s+(?:league|cup)$/i;
/** Page de paris sportifs réels (chemin de l'adresse). */
const REAL_PAGE = /\/(?:sports?|prematch|pre-match|live|in-?play|football|soccer|events?|matche?s?|tournaments?|competitions?)(?:[/?#.]|$)/i;

export interface Categorized {
  category: Category;
  /** Indice net (page, adresse ou ligue) ; sinon simple estimation. */
  strong: boolean;
}

const pathOf = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.hash;
  } catch {
    return u;
  }
};

/** Classe un match d'après la capture qui l'a relevé (page `frame`, adresse `url`). */
export function categorize(m: { league?: string; round?: number }, where: { url?: string; frame?: string }): Categorized {
  const context = `${where.frame ?? ""} ${where.url ?? ""}`.trim();
  if (VIRTUAL_CONTEXT.test(context)) return { category: "virtual", strong: true };
  if (m.league && VIRTUAL_LEAGUE.test(m.league)) return { category: "virtual", strong: true };
  // La page ouverte dit ce que regarde l'utilisateur ; l'adresse d'une API, beaucoup moins
  const page = where.frame ?? where.url;
  if (page && REAL_PAGE.test(pathOf(page))) return { category: "real", strong: true };
  // Le football virtuel s'affiche par journées ; les listes de matchs réels rarement
  return { category: m.round != null ? "virtual" : "real", strong: false };
}

/** Estimation pour un match enregistré avant le classement automatique. */
export const guessCategory = (m: Pick<MatchRow, "league" | "round">): Category => categorize(m, {}).category;

export type LeagueOverrides = Record<string, Category>;

/**
 * Catégorie affichée de chaque match : correction de l'utilisateur pour sa ligue, sinon le
 * classement majoritaire de la ligue (tous ses matchs ensemble), sinon celui du match.
 */
export function categoryResolver(matches: Pick<MatchRow, "league" | "category" | "round">[], overrides: LeagueOverrides = {}) {
  const votes = new Map<string, { virtual: number; real: number }>();
  for (const m of matches) {
    if (!m.league) continue;
    const v = votes.get(m.league) ?? { virtual: 0, real: 0 };
    v[m.category ?? guessCategory(m)]++;
    votes.set(m.league, v);
  }
  return (m: Pick<MatchRow, "league" | "category" | "round">): Category => {
    if (m.league) {
      const o = overrides[m.league];
      if (o) return o;
      const v = votes.get(m.league);
      if (v) return v.virtual >= v.real ? "virtual" : "real";
    }
    return m.category ?? guessCategory(m);
  };
}

export const CATEGORY_LABEL: Record<Category, string> = { virtual: "Virtuel", real: "Réel" };
