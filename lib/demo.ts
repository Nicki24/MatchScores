import type { Match, Market, Snapshot, Sport, Standing, VirtualLeague } from "./types";
import { standingsFromResults } from "./analysis/virtuals";

/** Données d'exemple pour découvrir l'interface avant de connecter Bet261. */

const m1x2 = (o: [number, number, number]): Market => ({
  key: "1X2",
  name: "Résultat (1X2)",
  selections: [
    { label: "1", odds: o[0] },
    { label: "X", odds: o[1] },
    { label: "2", odds: o[2] },
  ],
});
const m12 = (o: [number, number]): Market => ({
  key: "12",
  name: "Vainqueur",
  selections: [
    { label: "1", odds: o[0] },
    { label: "2", odds: o[1] },
  ],
});
const ou = (line: number, o: [number, number]): Market => ({
  key: "OU",
  name: `Total ${line}`,
  line,
  selections: [
    { label: "Over", odds: o[0] },
    { label: "Under", odds: o[1] },
  ],
});

let i = 0;
const at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const match = (sport: Sport, league: string, home: string, away: string, h: number, markets: Market[]): Match => ({
  id: `demo-${i++}`,
  sport,
  league,
  home,
  away,
  startTime: at(h),
  markets,
});

const sports: Match[] = [
  match("football", "Angleterre · Premier League", "Manchester City", "Sheffield United", 3, [m1x2([1.18, 7.5, 15]), ou(1.5, [1.14, 5.2]), ou(2.5, [1.42, 2.8])]),
  match("football", "Espagne · LaLiga", "Real Madrid", "Getafe", 5, [m1x2([1.32, 5.4, 9.5]), ou(2.5, [1.65, 2.2])]),
  match("football", "France · Ligue 1", "Lens", "Nantes", 6, [m1x2([1.95, 3.4, 4.1]), ou(2.5, [2.1, 1.72])]),
  match("football", "Italie · Serie A", "Inter", "Lecce", 7, [m1x2([1.25, 6.0, 12]), ou(1.5, [1.18, 4.6])]),
  match("football", "Madagascar · Orange Pro League", "CFFA", "Fosa Juniors", 26, [m1x2([2.45, 3.0, 2.9])]),
  match("football", "Allemagne · Bundesliga", "Bayern Munich", "Bochum", 30, [m1x2([1.12, 9.5, 19]), ou(2.5, [1.25, 3.8])]),
  match("basketball", "NBA", "Boston Celtics", "Washington Wizards", 10, [m12([1.11, 6.6]), ou(224.5, [1.87, 1.87])]),
  match("basketball", "Euroleague", "Real Madrid", "Alba Berlin", 8, [m12([1.16, 5.3])]),
  match("basketball", "NBA", "Lakers", "Nuggets", 11, [m12([2.1, 1.74])]),
  match("tennis", "ATP · Vienne", "J. Sinner", "Qualifié", 4, [m12([1.07, 8.8])]),
  match("tennis", "WTA · Tokyo", "I. Swiatek", "M. Bouzkova", 2, [m12([1.2, 4.4])]),
  match("volleyball", "Italie · SuperLega", "Perugia", "Taranto", 9, [m12([1.09, 7.0])]),
  match("handball", "Ligue des champions", "PSG Handball", "Kielce", 12, [m1x2([1.55, 8.0, 2.6])]),
];

const teams = ["Londres Rouge", "Manchester Bleu", "Liverpool", "Madrid Blanc", "Barcelone", "Munich", "Milan", "Turin", "Paris", "Lisbonne"];

function seededRandom(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function demoLeague(): VirtualLeague {
  const rand = seededRandom(261);
  const strength = teams.map((_, k) => 1.8 - k * 0.11);
  const results: VirtualLeague["results"] = [];
  const poissonDraw = (l: number) => {
    let k = 0;
    let p = Math.exp(-l);
    let s = p;
    const u = rand();
    while (u > s && k < 8) {
      k++;
      p *= l / k;
      s += p;
    }
    return k;
  };
  for (let round = 1; round <= 9; round++) {
    const order = [...teams].sort(() => rand() - 0.5);
    for (let k = 0; k < order.length; k += 2) {
      const h = teams.indexOf(order[k]);
      const a = teams.indexOf(order[k + 1]);
      results.push({
        round: `J${round}`,
        home: order[k],
        away: order[k + 1],
        homeGoals: poissonDraw(strength[h] * 0.85),
        awayGoals: poissonDraw(strength[a] * 0.7),
      });
    }
  }
  const standings: Standing[] = standingsFromResults(results);
  // Prochaine journée : 1er contre 10e, 2e contre 9e… avec des cotes cohérentes avec le classement (marge 8 %).
  const odds = (p: number) => Math.round((1 / (p * 1.08)) * 100) / 100;
  const matches: Match[] = [];
  for (let k = 0; k < 5; k++) {
    const home = standings[k * 2 + (k % 2)];
    const away = standings[standings.length - 1 - k * 2 + (k % 2 ? -1 : 0)] ?? standings[k * 2 + 1];
    const gap = ((away.position ?? 5) - (home.position ?? 5)) / standings.length; // > 0 : domicile mieux classé
    const pH = Math.min(0.75, Math.max(0.15, 0.45 + gap * 0.45));
    const pD = 0.26 - Math.abs(gap) * 0.08;
    const pA = 1 - pH - pD;
    matches.push({
      id: `demo-v-${k}`,
      sport: "football",
      league: "Ligue virtuelle (démo)",
      home: home.team,
      away: away.team,
      startTime: new Date(Date.now() + (k + 1) * 4 * 60_000).toISOString(),
      virtual: true,
      markets: [
        m1x2([odds(pH), odds(pD), odds(pA)]),
        {
          key: "DC",
          name: "Double chance",
          selections: [
            { label: "1X", odds: odds(pH + pD) },
            { label: "12", odds: odds(pH + pA) },
            { label: "X2", odds: odds(pD + pA) },
          ],
        },
        ou(1.5, [1.28, 3.4]),
        ou(2.5, [1.85, 1.9]),
      ],
    });
  }
  return { name: "Ligue virtuelle (démo)", standings, results, matches };
}

export function demoSnapshot(): Snapshot {
  return {
    source: "demo",
    capturedAt: new Date().toISOString(),
    matches: sports,
    virtual: [demoLeague()],
    notes: ["Données de démonstration : connecte Bet261 pour analyser les vrais matchs."],
  };
}
