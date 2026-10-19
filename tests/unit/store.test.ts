import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { applyBatch, ensureSources, ingestCapture, MatchScoresDB, renormalize } from "../../app/src/core/store";
import { computeTable, marketsOf, teamForm } from "../../app/src/core/analysis";
import { defaultConfig, VirtualLeague } from "../../app/src/core/sim/engine";
import { apiResults, apiRound, apiStandings, wsFrames } from "../../app/src/core/sim/payloads";

const T0 = Date.UTC(2026, 0, 1);
const league = new VirtualLeague(defaultConfig({ startedAt: T0, roundSeconds: 120, liveSeconds: 20 }));
const at = (ms: number) => new Date(ms).toISOString();
const time = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

function domText(now: number) {
  const s = league.state(now);
  return [
    "English League",
    `Journée ${s.round}`,
    ...s.matches.flatMap((m) => [time(m.kickoff), m.home, m.away, "1", m.odds["1X2"][0].toFixed(2), "X", m.odds["1X2"][1].toFixed(2), "2", m.odds["1X2"][2].toFixed(2)]),
    `Résultats — Journée ${s.round - 1}`,
    ...s.results.filter((m) => m.round === s.round - 1).map((m) => `${m.home} ${m.homeGoals} - ${m.awayGoals} ${m.away}`),
  ].join("\n");
}

let db: MatchScoresDB;
let n = 0;
beforeEach(async () => {
  db = new MatchScoresDB(`test-${n++}`);
  await ensureSources(db);
});

const capture = (kind: "xhr" | "ws" | "dom", payload: string, ms: number, url = "https://site/api") =>
  ingestCapture(db, { source_id: "bet261", kind, url, payload, captured_at: at(ms) });

describe("base locale", () => {
  it("fusionne un même match vu par l'API, le WebSocket et le texte (aucun doublon)", async () => {
    const now = T0 + (5 * 120 + 30) * 1000;
    const s = league.state(now);
    await capture("xhr", JSON.stringify(apiRound(s)), now);
    await capture("xhr", JSON.stringify(apiResults(s, 1)), now + 100);
    await capture("ws", wsFrames(s).join(""), now + 200, "wss://site/ws");
    await capture("dom", domText(now), now + 300, "https://site/virtual");
    const matches = await db.matches.toArray();
    // 10 matchs à venir + 10 résultats de la journée 5
    expect(matches).toHaveLength(20);
    const upcoming = matches.filter((m) => m.status === "scheduled");
    expect(upcoming).toHaveLength(10);
    expect(upcoming.every((m) => m.methods.includes("C") && m.methods.includes("D"))).toBe(true);
    const keys = new Set(matches.map((m) => `${m.round}|${m.home_team}|${m.away_team}`));
    expect(keys.size).toBe(20);
  });

  it("ignore une capture identique et garde l'historique des cotes uniquement quand elles changent", async () => {
    const now = T0 + (5 * 120 + 30) * 1000;
    const s = league.state(now);
    const payload = JSON.stringify(apiRound(s));
    expect((await capture("xhr", payload, now)).stored).toBe(true);
    expect((await capture("xhr", payload, now + 3000)).duplicate).toBe(true);
    const changed = apiRound(s);
    changed.events[0].markets[0].selections[0].odds = "9.99";
    await capture("xhr", JSON.stringify(changed), now + 6000);
    const key = `bet261|${s.matches[0].id}`;
    const history = (await db.odds.where("match_key").equals(key).toArray()).filter((o) => o.market === "1X2" && o.selection === "1");
    expect(history.map((h) => h.value)).toEqual([s.matches[0].odds["1X2"][0], 9.99]);
    expect(marketsOf(await db.odds.where("match_key").equals(key).toArray())[0].selections[0].value).toBe(9.99);
  });

  it("met à jour le statut et le score quand le match se termine (F3)", async () => {
    const before = T0 + (5 * 120 + 30) * 1000;
    await capture("xhr", JSON.stringify(apiRound(league.state(before))), before);
    const after = T0 + (6 * 120 + 30) * 1000; // journée 6 terminée
    const s2 = league.state(after);
    await capture("xhr", JSON.stringify(apiResults(s2, 1)), after);
    const m = await db.matches.get(`bet261|${league.state(before).matches[0].id}`);
    const truth = s2.results.find((r) => r.id === m!.external_id)!;
    expect(m).toMatchObject({ status: "finished", home_score: truth.homeGoals, away_score: truth.awayGoals, score_method: "C" });
  });

  it("enregistre le classement et recalcule le même à partir des résultats", async () => {
    const now = T0 + (5 * 120 + 30) * 1000;
    const s = league.state(now);
    await capture("xhr", JSON.stringify(apiStandings(s)), now);
    await capture("xhr", JSON.stringify(apiResults(s, 5)), now + 50);
    const st = await db.standings.toArray();
    expect(st).toHaveLength(20);
    expect(st.every((r) => r.round === 5)).toBe(true);
    const computed = computeTable(await db.matches.toArray());
    expect(computed.slice(0, 5).map((r) => [r.team, r.points])).toEqual(s.standings.slice(0, 5).map((r) => [r.team, r.points]));
    const form = teamForm(s.standings[0].team, await db.matches.toArray());
    expect(form.played).toBe(5);
  });

  it("re-normalise les captures brutes à l'identique (F7)", async () => {
    const now = T0 + (5 * 120 + 30) * 1000;
    const s = league.state(now);
    await capture("xhr", JSON.stringify(apiRound(s)), now);
    await capture("dom", domText(now), now + 10);
    await capture("xhr", JSON.stringify(apiResults(s, 2)), now + 20);
    const before = (await db.matches.toArray()).map((m) => m.key).sort();
    await renormalize(db);
    const after = (await db.matches.toArray()).map((m) => m.key).sort();
    expect(after).toEqual(before);
  });

  it("ne confond pas un même duel de deux saisons différentes", async () => {
    await applyBatch(db, "bet261", { matches: [{ external_id: "a", home_team: "Leeds", away_team: "Burnley", round: 3, status: "finished", home_score: 1, away_score: 0 }], odds: [], standings: [] }, "C", at(T0));
    await applyBatch(db, "bet261", { matches: [{ external_id: "b", home_team: "Leeds", away_team: "Burnley", round: 3, status: "scheduled" }], odds: [], standings: [] }, "D", at(T0 + 3 * 3600_000));
    expect(await db.matches.count()).toBe(2);
  });
});
