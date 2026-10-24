import { describe, expect, it } from "vitest";
import { normalizeJson, normalizeJsonText } from "../../app/src/core/normalize/json";
import { normalizeText } from "../../app/src/core/normalize/text";
import { defaultConfig, VirtualLeague } from "../../app/src/core/sim/engine";
import { apiResults, apiRound, apiStandings, wsFrames } from "../../app/src/core/sim/payloads";

const league = new VirtualLeague(defaultConfig({ startedAt: Date.UTC(2026, 0, 1), roundSeconds: 120, liveSeconds: 20 }));
// 5 journées jouées, journée 6 ouverte aux paris
const now = Date.UTC(2026, 0, 1) + (5 * 120 + 30) * 1000;
const s = league.state(now);
const at = new Date(now).toISOString();

describe("adaptateur JSON générique", () => {
  it("lit le format API (camelCase) : équipes, heure, journée, statut et 3 marchés", () => {
    const b = normalizeJson(apiRound(s), at);
    expect(b.matches).toHaveLength(10);
    const m = b.matches[0];
    const t = s.matches[0];
    expect([m.home_team, m.away_team]).toEqual([t.home, t.away]);
    expect(m.external_id).toBe(t.id);
    expect(m.round).toBe(6);
    expect(m.league).toBe("English League");
    expect(m.season).toBe("1");
    expect(m.status).toBe("scheduled");
    expect(m.kickoff_at).toBe(new Date(t.kickoff).toISOString());
    const odds = b.odds.filter((o) => o.external_id === t.id);
    expect(odds.filter((o) => o.market === "1X2").map((o) => [o.selection, o.value])).toEqual([
      ["1", t.odds["1X2"][0]],
      ["X", t.odds["1X2"][1]],
      ["2", t.odds["1X2"][2]],
    ]);
    expect(odds.filter((o) => o.market === "OU2.5").map((o) => o.selection)).toEqual(["Over", "Under"]);
    expect(odds.filter((o) => o.market === "BTTS").map((o) => o.selection)).toEqual(["Oui", "Non"]);
  });

  it("lit le classement et les résultats de l'API", () => {
    const st = normalizeJson(apiStandings(s), at).standings;
    expect(st).toHaveLength(20);
    expect(st[0]).toMatchObject({ team: s.standings[0].team, position: 1, points: s.standings[0].points, goals_for: s.standings[0].goalsFor });
    const res = normalizeJson(apiResults(s, 2), at).matches;
    expect(res).toHaveLength(20);
    const r = s.results.find((x) => x.id === res[0].external_id)!;
    expect(res[0]).toMatchObject({ status: "finished", home_score: r.homeGoals, away_score: r.awayGoals, round: r.round });
  });

  it("lit les trames WebSocket façon SignalR (PascalCase, séparateur \\x1e)", () => {
    const b = normalizeJsonText(wsFrames(s).join(""), at);
    const upcoming = b.matches.filter((m) => m.status === "scheduled");
    expect(upcoming).toHaveLength(10);
    expect(upcoming[0]).toMatchObject({ home_team: s.matches[0].home, away_team: s.matches[0].away, round: 6, league: "English League" });
    const finished = b.matches.filter((m) => m.status === "finished");
    expect(finished).toHaveLength(10);
    expect(b.standings).toHaveLength(20);
    const one = b.odds.filter((o) => o.external_id === s.matches[0].id && o.market === "1X2");
    expect(one.map((o) => o.value)).toEqual(s.matches[0].odds["1X2"]);
    expect(b.odds.some((o) => o.market === "OU2.5" && o.selection === "Over")).toBe(true);
  });

  it("lit une trame Socket.IO et ignore les listes de statistiques", () => {
    const frame = '42["update",{"events":[{"id":9,"home":"Leeds","away":"Burnley","time":1767225600,"odds":{"1":2.1,"X":3.3,"2":3.4},"stats":[{"name":"possession","value":55},{"name":"tirs","value":12}]}]}]';
    const b = normalizeJsonText(frame, at);
    expect(b.matches).toHaveLength(1);
    expect(b.odds.map((o) => `${o.market}:${o.selection}:${o.value}`)).toEqual(["1X2:1:2.1", "1X2:X:3.3", "1X2:2:3.4"]);
  });
});

describe("adaptateur texte (méthode D)", () => {
  const time = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const text = [
    "English League",
    "Saison 1",
    "Journée 6",
    ...s.matches.flatMap((m) => [time(m.kickoff), m.home, m.away, "1", m.odds["1X2"][0].toFixed(2), "X", m.odds["1X2"][1].toFixed(2), "2", m.odds["1X2"][2].toFixed(2)]),
    "Résultats — Journée 5",
    ...s.results.filter((m) => m.round === 5).map((m) => `${m.home} ${m.homeGoals} - ${m.awayGoals} ${m.away}`),
    "Classement",
    ...s.standings.map((r) => [r.position, r.team, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.goalsFor - r.goalsAgainst, r.points, r.form].join("\t")),
  ].join("\n");

  it("retrouve les 10 matchs, leurs cotes 1X2, la journée et l'heure", () => {
    const b = normalizeText(text, at);
    const upcoming = b.matches.filter((m) => m.status === "scheduled");
    expect(upcoming).toHaveLength(10);
    upcoming.forEach((m, i) => {
      expect([m.home_team, m.away_team, m.round]).toEqual([s.matches[i].home, s.matches[i].away, 6]);
      expect(m.kickoff_at && time(Date.parse(m.kickoff_at))).toBe(time(s.matches[i].kickoff));
      const odds = b.odds.filter((o) => o.external_id === m.external_id).map((o) => o.value);
      expect(odds).toEqual(s.matches[i].odds["1X2"]);
    });
  });

  it("retrouve les résultats de la journée précédente et le classement", () => {
    const b = normalizeText(text, at);
    const finished = b.matches.filter((m) => m.status === "finished");
    expect(finished).toHaveLength(10);
    expect(finished.every((m) => m.round === 5)).toBe(true);
    expect(b.standings).toHaveLength(20);
    expect(b.standings[3]).toMatchObject({ team: s.standings[3].team, points: s.standings[3].points, played: 5 });
  });

  it("gère la mise en page OCR « équipe 1 / cotes / équipe 2 »", () => {
    const ocr = ["Journée 6", "Arsenal", "1.85", "3.40", "4.20", "Chelsea", "Liverpool", "1.30 5.50 9.00", "Everton"].join("\n");
    const b = normalizeText(ocr, at);
    expect(b.matches.map((m) => `${m.home_team}-${m.away_team}`)).toEqual(["Arsenal-Chelsea", "Liverpool-Everton"]);
  });
});

describe("résultats lus dans le texte", () => {
  const at = new Date(Date.UTC(2026, 9, 22, 7, 50)).toISOString();
  it("une heure de coup d'envoi n'est jamais lue comme un score, ni « EN DIRECT » comme une équipe", () => {
    const page = ["Journée 7", "07:56", "Sheffield", "Leeds", "1", "1.66", "X", "3.50", "2", "4.20", "EN DIRECT 2 - 0", "07:56", "Burnley", "Wolves", "Leeds 20:30 Burnley"].join("\n");
    const finished = normalizeText(page, at).matches.filter((m) => m.status === "finished");
    expect(finished).toEqual([]);
  });

  it("lit toujours les vrais résultats, sur une ou trois lignes", () => {
    const page = ["Résultats — Journée 6", "Leeds 2 - 1 Burnley", "Wolves", "0:0", "Crystal", "Brighton 3:1 Leicester"].join("\n");
    const r = normalizeText(page, at).matches.filter((m) => m.status === "finished");
    expect(r.map((m) => `${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team}`)).toEqual(["Leeds 2-1 Burnley", "Wolves 0-0 Crystal", "Brighton 3-1 Leicester"]);
  });
});

describe("page bet261 : pays et compétition sous les équipes", () => {
  const at = new Date(Date.UTC(2026, 9, 24, 4, 41)).toISOString();
  const read = (lines: string[]) =>
    normalizeText(lines.join("\n"), at).matches.filter((m) => m.status === "scheduled").map((m) => `${m.home_team} | ${m.away_team} | ${m.league ?? ""}`);
  const oddsOf = (lines: string[]) => normalizeText(lines.join("\n"), at).odds.map((o) => `${o.selection}:${o.value}`).join(" ");
  // Cartes « Top paris » : équipes, heure, « Pays - Compétition », LIVE, jour, cotes, nombre de paris
  const card = (teams: string, time: string, competition: string, odds: [string, string, string], live = true) => [
    teams,
    time,
    competition,
    ...(live ? ["LIVE"] : []),
    "Aujourd'hui",
    "1",
    odds[0],
    "X",
    odds[1],
    "2",
    odds[2],
    "+162",
  ];
  const TOP = [
    ...card("IK Sirius FK - AIK Solna", "16:00", "Suède - D1 Suède", ["1,50", "4,44", "4,83"]),
    ...card("Cagliari Calcio - Bologne FC", "16:00", "Italie - Serie A", ["2,76", "2,94", "2,51"]),
    ...card("Côme 1907 - Sassuolo", "16:00", "Italie - Serie A", ["1,41", "4,86", "5,47"]),
    ...card("Modena FC - Cesena FC", "16:00", "Italie - Serie B", ["1,47", "4,17", "5,61"], false),
    ...card("RB Leipzig - SV 07 Elversberg", "16:30", "Allemagne - Bundesliga", ["1,35", "5,34", "5,74"]),
    ...card("SC Paderborn - Hambourg SV", "16:30", "Allemagne - Bundesliga", ["2,18", "3,50", "2,82"]),
  ];
  const EXPECTED = [
    "IK Sirius FK | AIK Solna | D1 Suède",
    "Cagliari Calcio | Bologne FC | Serie A",
    "Côme 1907 | Sassuolo | Serie A",
    "Modena FC | Cesena FC | Serie B",
    "RB Leipzig | SV 07 Elversberg | Bundesliga",
    "SC Paderborn | Hambourg SV | Bundesliga",
  ];

  it("lit les vrais noms des équipes, pas le pays et la compétition", () => {
    expect(read(TOP)).toEqual(EXPECTED);
    expect(oddsOf(TOP.slice(0, 12))).toBe("1:1.5 X:4.44 2:4.83");
  });

  it("quel que soit l'ordre de l'heure et de la compétition dans la carte", () => {
    const swapped = TOP.map((l, i) => (/^\d\d:\d\d$/.test(l) ? TOP[i + 1] : /^\d\d:\d\d$/.test(TOP[i - 1] ?? "") ? TOP[i - 1] : l));
    expect(read(swapped)).toEqual(EXPECTED);
  });

  it("compétition en en-tête de liste, matchs de sélections nationales et noms avec des chiffres", () => {
    const page = [
      "Suède - Allsvenskan",
      "16:00",
      "Malmö FF - Hammarby IF",
      "1.50 4.44 4.83",
      "International - Matchs amicaux",
      "18:00",
      "Suède - Norvège",
      "2.10 3.20 3.60",
      "Allemagne - Bundesliga",
      "15:30",
      "FC Schalke 04 - 1. FC Köln",
      "2.40 3.40 2.90",
      "Hannover 96 - Mainz 05",
      "2.20 3.30 3.10",
    ];
    expect(read(page)).toEqual([
      "Malmö FF | Hammarby IF | Allsvenskan",
      "Suède | Norvège | Matchs amicaux",
      "FC Schalke 04 | 1. FC Köln | Bundesliga",
      "Hannover 96 | Mainz 05 | Bundesliga",
    ]);
  });

  it("une ligne « Pays - Club » seule devant les cotes reste un match (amical d'une sélection)", () => {
    expect(read(["18:00", "Madagascar - CNaPS Sport", "1.80 3.30 4.10"])).toEqual(["Madagascar | CNaPS Sport | "]);
  });

  it("un score n'est toujours pas un nom d'équipe", () => {
    const page = ["Résultats — Journée 6", "Leeds 2 - 1 Burnley", "Journée 7", "07:56", "Sheffield - Leeds", "1.66 3.50 4.20"];
    const b = normalizeText(page.join("\n"), at);
    expect(b.matches.map((m) => `${m.home_team}|${m.away_team}|${m.status}`)).toEqual(["Sheffield|Leeds|scheduled", "Leeds|Burnley|finished"]);
  });

  it("données du site : une compétition « Pays - Compétition » n'est pas un match", () => {
    const tournament = {
      id: "sr:tournament:1",
      name: "Suède - D1 Suède",
      events: [
        {
          eventId: "sr:match:9",
          homeTeamName: "IK Sirius FK",
          awayTeamName: "AIK Solna",
          estimateStartTime: Date.parse(at) + 3600_000,
          markets: [{ id: "1", desc: "1X2", outcomes: [{ id: "1", odds: "1.50" }, { id: "2", odds: "4.44" }, { id: "3", odds: "4.83" }] }],
        },
      ],
    };
    const b = normalizeJson({ tournaments: [tournament] }, at);
    expect(b.matches.map((m) => `${m.home_team} | ${m.away_team}`)).toEqual(["IK Sirius FK | AIK Solna"]);
    expect(b.odds.map((o) => `${o.selection}:${o.value}`)).toEqual(["1:1.5", "X:4.44", "2:4.83"]);
    // Un vrai match nommé « A - B » reste lu
    expect(normalizeJson({ id: 7, name: "Suède - Norvège", startTime: Date.parse(at) + 3600_000 }, at).matches.map((m) => m.away_team)).toEqual(["Norvège"]);
  });
});
