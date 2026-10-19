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
