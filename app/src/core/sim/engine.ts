/**
 * Simulateur de ligue de football virtuel (« English League ») :
 * 20 équipes, 38 journées par saison, une journée toutes les `roundSeconds`.
 * Sert au site de test (vérifications automatiques) et à la source « Démo ».
 * Les résultats sont tirés au hasard, comme sur les vrais jeux virtuels.
 */

export const ENGLISH_TEAMS = [
  "London Reds",
  "London Blues",
  "Manchester Red",
  "Manchester Blue",
  "Liverpool",
  "Merseyside",
  "Newcastle",
  "Leeds",
  "Birmingham",
  "Nottingham",
  "Leicester",
  "Southampton",
  "Brighton",
  "Wolverhampton",
  "Sheffield",
  "Bournemouth",
  "Burnley",
  "West London",
  "North London",
  "Crystal",
];

export interface SimConfig {
  seed: number;
  /** Durée d'une journée (paris + match). */
  roundSeconds: number;
  /** Durée du match en direct à la fin de chaque journée. */
  liveSeconds: number;
  /** Début de la saison 1, journée 1 (ms). */
  startedAt: number;
  league: string;
  teams: string[];
  margin: number;
}

export type SimStatus = "scheduled" | "live" | "finished";

export interface SimMatch {
  id: string;
  season: number;
  round: number;
  home: string;
  away: string;
  kickoff: number;
  status: SimStatus;
  homeGoals?: number;
  awayGoals?: number;
  odds: {
    "1X2": [number, number, number];
    "OU2.5": [number, number];
    BTTS: [number, number];
    /** Résultat à la mi-temps (1 / X / 2). */
    HT: [number, number, number];
    /** Mi-temps / fin de match, dans l'ordre 1/1, 1/X, 1/2, X/1, X/X, X/2, 2/1, 2/X, 2/2. */
    HTFT: number[];
  };
}

export interface SimStanding {
  position: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: string;
}

export interface SimState {
  league: string;
  season: number;
  round: number;
  now: number;
  /** Journée en cours (à venir ou en direct). */
  matches: SimMatch[];
  /** Résultats de la saison en cours, de la plus ancienne à la plus récente journée. */
  results: SimMatch[];
  standings: SimStanding[];
}

export const ROUNDS_PER_SEASON = 38;

export function defaultConfig(partial: Partial<SimConfig> = {}): SimConfig {
  return {
    seed: 261,
    roundSeconds: 120,
    liveSeconds: 20,
    startedAt: Date.UTC(2026, 0, 1),
    league: "English League",
    teams: ENGLISH_TEAMS,
    margin: 0.07,
    ...partial,
  };
}

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poissonSample(lambda: number, rand: () => number) {
  let k = 0;
  let p = Math.exp(-lambda);
  let s = p;
  const u = rand();
  while (u > s && k < 9) {
    k++;
    p *= lambda / k;
    s += p;
  }
  return k;
}

function poisson(k: number, l: number) {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-l) * l ** k) / f;
}

/** Calendrier aller-retour par la méthode du cercle. */
function fixtures(n: number): [number, number][][] {
  const idx = [...Array(n).keys()];
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = idx[i];
      const b = idx[n - 1 - i];
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    idx.splice(1, 0, idx.pop()!);
  }
  return [...rounds, ...rounds.map((p) => p.map(([a, b]) => [b, a] as [number, number]))];
}

export class VirtualLeague {
  readonly cfg: SimConfig;
  private readonly schedule: [number, number][][];
  private readonly strength: number[];

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.schedule = fixtures(cfg.teams.length);
    const rand = mulberry32(cfg.seed);
    this.strength = cfg.teams.map((_, i) => 1.5 - (i / (cfg.teams.length - 1)) * 0.9 + (rand() - 0.5) * 0.2);
  }

  /** Index absolu de la journée en cours (0 = saison 1 journée 1). */
  slotAt(now: number) {
    return Math.max(0, Math.floor((now - this.cfg.startedAt) / (this.cfg.roundSeconds * 1000)));
  }

  private lambdas(h: number, a: number): [number, number] {
    const sh = this.strength[h];
    const sa = this.strength[a];
    return [Math.min(3.5, 1.35 * (sh / sa) ** 0.8 * 1.1), Math.min(3.5, 1.15 * (sa / sh) ** 0.8)];
  }

  private odds(h: number, a: number): SimMatch["odds"] {
    const [lh, la] = this.lambdas(h, a);
    let ph = 0;
    let pd = 0;
    let pa = 0;
    let over = 0;
    let btts = 0;
    for (let i = 0; i <= 10; i++)
      for (let j = 0; j <= 10; j++) {
        const p = poisson(i, lh) * poisson(j, la);
        if (i > j) ph += p;
        else if (i === j) pd += p;
        else pa += p;
        if (i + j > 2.5) over += p;
        if (i > 0 && j > 0) btts += p;
      }
    // Mi-temps : moitié des buts attendus dans chaque période, périodes indépendantes
    const half = (l: number) => [...Array(7).keys()].map((k) => poisson(k, l / 2));
    const [hh, ha] = [half(lh), half(la)];
    const side = (a: number, b: number) => (a > b ? 0 : a === b ? 1 : 2);
    const ht = [0, 0, 0];
    const htft = Array(9).fill(0);
    for (let i = 0; i < 7; i++)
      for (let j = 0; j < 7; j++) {
        const p1 = hh[i] * ha[j];
        ht[side(i, j)] += p1;
        for (let k = 0; k < 7; k++)
          for (let l = 0; l < 7; l++) htft[side(i, j) * 3 + side(i + k, j + l)] += p1 * hh[k] * ha[l];
      }
    const m = 1 + this.cfg.margin;
    const o = (p: number) => Math.min(500, Math.max(1.01, Math.round((1 / (p * m)) * 100) / 100));
    return {
      "1X2": [o(ph), o(pd), o(pa)],
      "OU2.5": [o(over), o(1 - over)],
      BTTS: [o(btts), o(1 - btts)],
      HT: [o(ht[0]), o(ht[1]), o(ht[2])],
      HTFT: htft.map(o),
    };
  }

  match(slot: number, index: number, now: number): SimMatch {
    const season = Math.floor(slot / ROUNDS_PER_SEASON) + 1;
    const round = (slot % ROUNDS_PER_SEASON) + 1;
    const [h, a] = this.schedule[round - 1][index];
    const slotStart = this.cfg.startedAt + slot * this.cfg.roundSeconds * 1000;
    const slotEnd = slotStart + this.cfg.roundSeconds * 1000;
    const kickoff = slotEnd - this.cfg.liveSeconds * 1000;
    const status: SimStatus = now >= slotEnd ? "finished" : now >= kickoff ? "live" : "scheduled";
    const m: SimMatch = {
      id: `EL-${season}-${round}-${index + 1}`,
      season,
      round,
      home: this.cfg.teams[h],
      away: this.cfg.teams[a],
      kickoff,
      status,
      odds: this.odds(h, a),
    };
    if (status !== "scheduled") {
      const rand = mulberry32(this.cfg.seed * 7919 + slot * 31 + index);
      const [lh, la] = this.lambdas(h, a);
      const hg = poissonSample(lh, rand);
      const ag = poissonSample(la, rand);
      if (status === "finished") {
        m.homeGoals = hg;
        m.awayGoals = ag;
      } else {
        // En direct : score partiel proportionnel au temps écoulé
        const share = (now - kickoff) / (this.cfg.liveSeconds * 1000);
        m.homeGoals = Math.floor(hg * share);
        m.awayGoals = Math.floor(ag * share);
      }
    }
    return m;
  }

  state(now = Date.now()): SimState {
    const slot = this.slotAt(now);
    const season = Math.floor(slot / ROUNDS_PER_SEASON) + 1;
    const round = (slot % ROUNDS_PER_SEASON) + 1;
    const n = this.cfg.teams.length / 2;
    const matches = [...Array(n).keys()].map((i) => this.match(slot, i, now));
    const results: SimMatch[] = [];
    const seasonStart = slot - (round - 1);
    for (let s = seasonStart; s < slot; s++) for (let i = 0; i < n; i++) results.push(this.match(s, i, now));
    return { league: this.cfg.league, season, round, now, matches, results, standings: table(results, this.cfg.teams) };
  }
}

export function table(results: SimMatch[], teams: string[]): SimStanding[] {
  const rows = new Map(teams.map((t) => [t, { team: t, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0, form: "" }]));
  for (const m of results) {
    if (m.status !== "finished") continue;
    const h = rows.get(m.home)!;
    const a = rows.get(m.away)!;
    const hg = m.homeGoals!;
    const ag = m.awayGoals!;
    h.played++;
    a.played++;
    h.goalsFor += hg;
    h.goalsAgainst += ag;
    a.goalsFor += ag;
    a.goalsAgainst += hg;
    if (hg > ag) {
      h.won++;
      a.lost++;
      h.points += 3;
      h.form += "W";
      a.form += "L";
    } else if (hg < ag) {
      a.won++;
      h.lost++;
      a.points += 3;
      a.form += "W";
      h.form += "L";
    } else {
      h.drawn++;
      a.drawn++;
      h.points++;
      a.points++;
      h.form += "D";
      a.form += "D";
    }
  }
  return [...rows.values()]
    .sort((x, y) => y.points - x.points || y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) || y.goalsFor - x.goalsFor || x.team.localeCompare(y.team))
    .map((r, i) => ({ ...r, position: i + 1, form: r.form.slice(-5) }));
}
