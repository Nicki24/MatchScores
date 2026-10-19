/**
 * Modèle de données commun à toutes les sources (cahier des charges, section 5).
 * Les tables reprennent celles du schéma PostgreSQL/Supabase : sources,
 * raw_captures, matches, odds, standings — ici stockées sur le téléphone.
 */

/** Méthodes d'acquisition (section 3) : B = endpoint rejoué, C = écoute réseau, D = texte de la page. */
export type Method = "A" | "B" | "C" | "D" | "E";

export interface Source {
  id: string;
  name: string;
  /** Méthode retenue après le protocole de vérification (section 4). */
  method: Method;
  enabled: boolean;
  /** Page ouverte par le collecteur. */
  startUrl?: string;
}

/** Origine technique d'une capture brute. */
export type CaptureKind = "xhr" | "ws" | "sse" | "dom" | "replay";

export const KIND_METHOD: Record<CaptureKind, Method> = {
  xhr: "C",
  ws: "C",
  sse: "C",
  dom: "D",
  replay: "B",
};

/** Table raw_captures : la réponse telle quelle, pour pouvoir re-normaliser (F7). */
export interface RawCapture {
  id?: number;
  source_id: string;
  kind: CaptureKind;
  url: string;
  /** Page (ou iframe) d'où vient la capture. */
  frame?: string;
  status?: number;
  method?: string;
  payload: string;
  captured_at: string;
  /** Empreinte du contenu, pour ignorer les doublons exacts. */
  hash: string;
}

export type MatchStatus = "scheduled" | "live" | "finished";

/** Table matches — unique (source_id, external_id). */
export interface MatchRow {
  key: string;
  source_id: string;
  external_id: string;
  league?: string;
  season?: string;
  round?: number;
  home_team: string;
  away_team: string;
  /** Clé de la paire d'équipes (domicile|extérieur), pour retrouver un même match vu par plusieurs méthodes. */
  pair: string;
  kickoff_at?: string;
  status: MatchStatus;
  home_score?: number;
  away_score?: number;
  first_seen_at: string;
  updated_at: string;
  /** Méthodes ayant vu ce match (pour le score de complétude par méthode). */
  methods: Method[];
  /** Méthode qui a fourni le score final. */
  score_method?: Method;
}

/** Table odds — une ligne par changement de cote (historique horodaté, F2). */
export interface OddsRow {
  id?: number;
  match_key: string;
  market: string;
  selection: string;
  value: number;
  captured_at: string;
  method: Method;
}

/** Table standings — clé primaire (source_id, league, season, round, team). */
export interface StandingRow {
  key: string;
  source_id: string;
  league: string;
  season: string;
  round: number;
  team: string;
  position: number;
  points: number;
  played: number;
  won?: number;
  drawn?: number;
  lost?: number;
  goals_for: number;
  goals_against: number;
  form?: string;
  captured_at: string;
}

/** Journal de chaque cycle de collecte (NF3). */
export interface CycleLog {
  id?: number;
  source_id: string;
  started_at: string;
  duration_ms: number;
  kind: CaptureKind | "timer";
  url?: string;
  matches: number;
  odds: number;
  standings: number;
  error?: string;
}

/* ---------- Contrat d'un adaptateur (section 5) ---------- */

export interface MatchInput {
  external_id: string;
  league?: string;
  season?: string;
  round?: number;
  home_team: string;
  away_team: string;
  kickoff_at?: string;
  status?: MatchStatus;
  home_score?: number;
  away_score?: number;
  /** Clé approximative quand le site ne fournit ni identifiant, ni journée, ni heure. */
  fuzzy?: boolean;
}

export interface OddsInput {
  external_id: string;
  market: string;
  selection: string;
  value: number;
}

export interface StandingInput {
  league?: string;
  season?: string;
  round?: number;
  team: string;
  position: number;
  points: number;
  played: number;
  won?: number;
  drawn?: number;
  lost?: number;
  goals_for: number;
  goals_against: number;
  form?: string;
}

export interface NormalizedBatch {
  matches: MatchInput[];
  odds: OddsInput[];
  standings: StandingInput[];
}

export type Adapter = (capture: RawCapture) => NormalizedBatch;

export const emptyBatch = (): NormalizedBatch => ({ matches: [], odds: [], standings: [] });
