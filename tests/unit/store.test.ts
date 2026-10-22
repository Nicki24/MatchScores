import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { applyBatch, ensureSources, ingestCapture, MatchScoresDB, pruneStorage, renormalize } from "../../app/src/core/store";
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
    expect((await capture("xhr", payload, now + 3000)).unchanged).toBe(true);
    const changed = apiRound(s);
    changed.events[0].markets[0].selections[0].odds = "9.99";
    await capture("xhr", JSON.stringify(changed), now + 6000);
    const key = `bet261|${s.matches[0].id}`;
    const history = (await db.odds.where("match_key").equals(key).toArray()).filter((o) => o.market === "1X2" && o.selection === "1");
    expect(history.map((h) => h.value)).toEqual([s.matches[0].odds["1X2"][0], 9.99]);
    expect(marketsOf(await db.odds.where("match_key").equals(key).toArray())[0].selections[0].value).toBe(9.99);
  });

  it("reprend une cote revenue à sa valeur précédente", async () => {
    const now = T0 + (5 * 120 + 30) * 1000;
    const s = league.state(now);
    const payload = JSON.stringify(apiRound(s));
    const changed = apiRound(s);
    changed.events[0].markets[0].selections[0].odds = "9.99";
    await capture("xhr", payload, now);
    await capture("xhr", JSON.stringify(changed), now + 3000);
    expect((await capture("xhr", payload, now + 6000)).stored).toBe(true);
    const odds = await db.odds.where("match_key").equals(`bet261|${s.matches[0].id}`).toArray();
    expect(marketsOf(odds)[0].selections[0].value).toBe(s.matches[0].odds["1X2"][0]);
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

  it("n'enregistre pas une page dont seul le compte à rebours change", async () => {
    const now = T0 + (5 * 120 + 30) * 1000;
    const page = (ms: number) => `Prochaine journée dans ${60 - Math.round((ms - now) / 1000)} s\n${domText(now)}`;
    const first = await capture("dom", page(now), now, "https://site/virtual");
    expect(first).toMatchObject({ stored: true, unchanged: false });
    expect(first.matches).toBeGreaterThan(0);
    const later = [];
    for (let i = 1; i <= 24; i++) later.push(await capture("dom", page(now + i * 2500), now + i * 2500, "https://site/virtual"));
    expect(later.every((r) => !r.stored && r.unchanged)).toBe(true);
    expect(await db.raw_captures.count()).toBe(1);
    // Journal : une ligne « inchangé » par minute, pas une par capture
    const quiet = (await db.cycles.toArray()).filter((c) => c.unchanged);
    expect(quiet.length).toBeLessThanOrEqual(2);
    // Une cote change : la lecture est de nouveau enregistrée
    const s = league.state(now);
    const changed = page(now + 70_000).replace(s.matches[0].odds["1X2"][0].toFixed(2), "9.99");
    expect((await capture("dom", changed, now + 70_000, "https://site/virtual")).stored).toBe(true);
    expect(await db.raw_captures.count()).toBe(2);
  });

  it("garde des échantillons des réponses illisibles, sans les compter comme des données", async () => {
    const t = T0 + 3600_000;
    const results = [];
    // Une réponse sans match, qui change à chaque fois (heure du serveur), toutes les 3 s pendant 5 min
    for (let i = 0; i < 100; i++) results.push(await capture("xhr", JSON.stringify({ serverTime: t + i * 3000, menu: ["Sports", "Virtuels"] }), t + i * 3000, "https://site/api/config?ts=" + i));
    expect(results.every((r) => !r.unchanged && r.matches === 0)).toBe(true);
    const kept = await db.raw_captures.count();
    expect(kept).toBeGreaterThanOrEqual(2);
    expect(kept).toBeLessThanOrEqual(3);
    // Un autre type de message sur la même adresse est gardé lui aussi
    expect((await capture("xhr", JSON.stringify({ banner: "Promo" }), t + 300_500, "https://site/api/config")).stored).toBe(true);
    // Un doublon exact d'une réponse illisible n'est pas une donnée
    expect((await capture("xhr", JSON.stringify({ banner: "Promo" }), t + 301_000, "https://site/api/config")).unchanged).toBe(false);
  });

  it("re-normalise sans effacer ce qui précède les captures conservées", async () => {
    await applyBatch(db, "bet261", { matches: [{ external_id: "old", home_team: "Leeds", away_team: "Burnley", round: 3, status: "finished", home_score: 1, away_score: 0 }], odds: [], standings: [] }, "C", at(T0 - 86400_000));
    const now = T0 + (5 * 120 + 30) * 1000;
    await capture("xhr", JSON.stringify(apiRound(league.state(now))), now);
    await renormalize(db);
    expect(await db.matches.get("bet261|old")).toBeTruthy();
    expect(await db.matches.count()).toBe(11);
  });

  it("limite la place prise par les captures brutes", async () => {
    const t = Date.now();
    for (let i = 0; i < 30; i++) await db.raw_captures.add({ source_id: "bet261", kind: "xhr", url: "https://site/api", payload: "{}", captured_at: new Date(t - i * 3600_000).toISOString(), hash: String(i) });
    await pruneStorage(db, { rawDays: 1, maxRaw: 10 });
    const left = await db.raw_captures.toArray();
    expect(left).toHaveLength(10);
    expect(left.every((r) => Date.parse(r.captured_at) > t - 86400_000)).toBe(true);
  });

  it("ne confond pas un même duel de deux saisons différentes", async () => {
    await applyBatch(db, "bet261", { matches: [{ external_id: "a", home_team: "Leeds", away_team: "Burnley", round: 3, status: "finished", home_score: 1, away_score: 0 }], odds: [], standings: [] }, "C", at(T0));
    await applyBatch(db, "bet261", { matches: [{ external_id: "b", home_team: "Leeds", away_team: "Burnley", round: 3, status: "scheduled" }], odds: [], standings: [] }, "D", at(T0 + 3 * 3600_000));
    expect(await db.matches.count()).toBe(2);
  });
});

describe("matchs d'un autre jour ou d'une autre saison", () => {
  const page = (round: number, line: string) => ["English League", `Journée ${round}`, line].join("\n");
  const upcoming = (time: string) => `${time}\nLeeds\nBurnley\n1\n1.80\nX\n3.50\n2\n4.20`;
  const dom = (payload: string, ms: number) => ingestCapture(db, { source_id: "bet261", kind: "dom", url: "https://bet261.mg/virtual", payload, captured_at: at(ms) });

  it("la même journée revenue le lendemain est un nouveau match, sans le score de la veille", async () => {
    const day1 = Date.UTC(2026, 9, 21, 10, 0);
    await dom(page(12, upcoming("10:05")), day1);
    await dom(page(12, "Leeds 2 - 1 Burnley"), day1 + 10 * 60_000);
    const day2 = day1 + 86400_000;
    await dom(page(12, upcoming("10:05")), day2);
    const rows = (await db.matches.toArray()).sort((a, b) => a.first_seen_at.localeCompare(b.first_seen_at));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "finished", home_score: 2, away_score: 1 });
    expect(rows[1]).toMatchObject({ status: "scheduled", home_score: undefined, kickoff_at: at(day2 + 5 * 60_000) });
    // Le résultat du lendemain va au match du lendemain
    await dom(page(12, "Leeds 0 - 0 Burnley"), day2 + 10 * 60_000);
    const after = await db.matches.get(rows[1].key);
    expect(after).toMatchObject({ status: "finished", home_score: 0, away_score: 0 });
    expect((await db.matches.get(rows[0].key))!.home_score).toBe(2);
  });

  it("la même affiche à la saison suivante (même journée, sans heure) est un nouveau match", async () => {
    const t = Date.UTC(2026, 9, 21, 10, 0);
    await dom(page(12, "Leeds 2 - 1 Burnley"), t);
    await dom(page(12, "Leeds 1 - 3 Burnley"), t + 2 * 3600_000);
    expect(await db.matches.count()).toBe(2);
  });

  it("un résultat relu plusieurs minutes reste le même match", async () => {
    const t = Date.UTC(2026, 9, 21, 10, 0);
    await dom(page(12, upcoming("10:05")), t);
    for (let i = 1; i <= 6; i++) await dom(page(12, `Leeds 2 - 1 Burnley\nPub ${i}`), t + i * 5 * 60_000);
    expect(await db.matches.count()).toBe(1);
  });

  it("une heure relevée juste avant minuit désigne le lendemain", async () => {
    const t = new Date(2026, 9, 21, 23, 58).getTime();
    await dom(page(3, upcoming("00:04")), t);
    const m = (await db.matches.toArray())[0];
    expect(Date.parse(m.kickoff_at!) - t).toBe(6 * 60_000);
  });
});

describe("virtuel ou réel", () => {
  it("classe les matchs d'après la page, l'adresse et la ligue", async () => {
    const now = T0 + (5 * 120 + 30) * 1000;
    const s = league.state(now);
    await capture("xhr", JSON.stringify(apiRound(s)), now, "https://bet261.mg/api/virtual/round");
    const real = { events: [{ eventId: "r1", homeTeam: "Arsenal", awayTeam: "Chelsea", startTime: at(now + 86400_000), tournament: "Premier League", odds: { "1": 2.1, X: 3.4, "2": 3.3 } }] };
    await ingestCapture(db, { source_id: "bet261", kind: "xhr", url: "https://api.bet261.mg/api/events", frame: "https://bet261.mg/sport/football", payload: JSON.stringify(real), captured_at: at(now + 50) });
    const rows = await db.matches.toArray();
    expect(rows.filter((m) => m.category === "virtual")).toHaveLength(10);
    expect(rows.filter((m) => m.category === "real").map((m) => m.home_team)).toEqual(["Arsenal"]);
  });

  it("purge les matchs et cotes de plus de 5 jours", async () => {
    const old = new Date(Date.now() - 6 * 86400_000).toISOString();
    await applyBatch(db, "bet261", { matches: [{ external_id: "x", home_team: "Leeds", away_team: "Burnley", round: 3 }], odds: [{ external_id: "x", market: "1X2", selection: "1", value: 2 }], standings: [] }, "C", old);
    await applyBatch(db, "bet261", { matches: [{ external_id: "y", home_team: "Leeds", away_team: "Wolves", round: 4 }], odds: [], standings: [] }, "C", new Date().toISOString());
    await pruneStorage(db);
    expect((await db.matches.toArray()).map((m) => m.external_id)).toEqual(["y"]);
    expect(await db.odds.count()).toBe(0);
    expect(await db.aliases.get("bet261|x")).toBeUndefined();
  });
});
