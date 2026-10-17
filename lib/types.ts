export type Sport =
  | "football"
  | "basketball"
  | "tennis"
  | "volleyball"
  | "handball"
  | "rugby"
  | "hockey"
  | "baseball"
  | "table-tennis"
  | "esport"
  | "other";

/** Clés de marché normalisées. */
export type MarketKey = "1X2" | "12" | "DC" | "OU" | "BTTS" | "OTHER";

export interface Selection {
  /** Libellé normalisé : "1", "X", "2", "1X", "12", "X2", "Over", "Under", "Oui", "Non"… */
  label: string;
  odds: number;
}

export interface Market {
  key: MarketKey;
  name: string;
  /** Ligne pour les Over/Under (ex : 2.5). */
  line?: number;
  selections: Selection[];
}

export interface Match {
  id: string;
  sport: Sport;
  league?: string;
  home: string;
  away: string;
  startTime?: string;
  live?: boolean;
  virtual?: boolean;
  markets: Market[];
}

export type FormResult = "W" | "D" | "L";

export interface Standing {
  team: string;
  position?: number;
  played?: number;
  won?: number;
  drawn?: number;
  lost?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  points?: number;
  /** Du plus ancien au plus récent. */
  form?: FormResult[];
}

export interface Result {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  round?: string;
}

export interface VirtualLeague {
  name: string;
  standings: Standing[];
  results: Result[];
  matches: Match[];
}

export type SnapshotSource = "scrape" | "assistant" | "paste" | "file" | "demo";

export interface Snapshot {
  source: SnapshotSource;
  capturedAt: string;
  url?: string;
  matches: Match[];
  virtual: VirtualLeague[];
  notes?: string[];
}

export const SPORT_LABELS: Record<Sport, string> = {
  football: "Football",
  basketball: "Basketball",
  tennis: "Tennis",
  volleyball: "Volley-ball",
  handball: "Handball",
  rugby: "Rugby",
  hockey: "Hockey",
  baseball: "Baseball",
  "table-tennis": "Tennis de table",
  esport: "eSport",
  other: "Autres",
};

/** Sports où le match nul est un résultat courant du marché principal. */
export const DRAW_SPORTS: Sport[] = ["football", "handball", "hockey", "rugby"];
