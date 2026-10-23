import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { applyBatch, clearCollectedData, ensureSources, ingestCapture, MatchScoresDB, pruneStorage, renormalize, setSetting } from "../../app/src/core/store";
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

  // Le texte de la page donne la journée et les équipes, pas la saison : à la saison suivante, la même affiche
  // revient avec le même identifiant. Elle ne doit pas être fusionnée avec le match terminé de la saison d'avant.
  it.each([
    ["avec l'heure des matchs", (ms: number) => domText(ms)],
    ["sans l'heure des matchs", (ms: number) => domText(ms).replace(/^\d\d:\d\d\n/gm, "")],
  ])("affiche les matchs de la saison suivante, lus dans le texte %s", async (_, text) => {
    for (let slot = 0; slot < 40; slot++) {
      const ms = T0 + (slot * 120 + 30) * 1000;
      await capture("dom", text(ms), ms, "https://site/virtual");
    }
    const now = T0 + (39 * 120 + 30) * 1000;
    const s = league.state(now);
    expect([s.season, s.round]).toEqual([2, 2]);
    const all = await db.matches.toArray();
    const duel = (m: { home_team: string; away_team: string } | { home: string; away: string }) => ("home" in m ? `${m.home}|${m.away}` : `${m.home_team}|${m.away_team}`);
    // Journée 2 de la saison 2 : à venir, comme sur le site
    const upcoming = all.filter((m) => m.status !== "finished" && Date.parse(m.updated_at) > now - 20 * 60_000 && m.round === 2);
    expect(upcoming.map(duel).sort()).toEqual(s.matches.map(duel).sort());
    // Journée 1 : un match par saison, chacun avec son propre score
    const round1 = all.filter((m) => m.round === 1);
    expect(round1).toHaveLength(20);
    const truth1 = [...league.state(T0 + 30_000 + 120_000).results, ...s.results].filter((m) => m.round === 1);
    for (const t of truth1) {
      expect(round1.some((m) => duel(m) === duel(t) && m.status === "finished" && m.home_score === t.homeGoals && m.away_score === t.awayGoals)).toBe(true);
    }
    // La re-normalisation retrouve les mêmes matchs (F7)
    const keys = all.map((m) => m.key).sort();
    await renormalize(db);
    expect((await db.matches.toArray()).map((m) => m.key).sort()).toEqual(keys);
  });

  it("ne crée pas de doublon quand un match terminé reste affiché quelques instants avec ses cotes", async () => {
    const t = T0 + 3600_000;
    await applyBatch(db, "bet261", { matches: [{ external_id: "x", home_team: "Leeds", away_team: "Burnley", round: 3, status: "finished", home_score: 2, away_score: 0 }], odds: [], standings: [] }, "D", at(t));
    await applyBatch(db, "bet261", { matches: [{ external_id: "x", home_team: "Leeds", away_team: "Burnley", round: 3, status: "scheduled" }], odds: [], standings: [] }, "D", at(t + 2 * 60_000));
    // Résultat relu bien plus tard (page des résultats) : toujours le même match
    await applyBatch(db, "bet261", { matches: [{ external_id: "x", home_team: "Leeds", away_team: "Burnley", round: 3, status: "finished", home_score: 2, away_score: 0 }], odds: [], standings: [] }, "D", at(t + 3 * 3600_000));
    expect(await db.matches.toArray()).toMatchObject([{ key: "bet261|x", status: "finished", home_score: 2, away_score: 0 }]);
  });

  it("efface les données collectées en gardant les sources et les réglages", async () => {
    const now = T0 + (5 * 120 + 30) * 1000;
    await capture("xhr", JSON.stringify(apiRound(league.state(now))), now);
    await capture("dom", domText(now), now + 10, "https://site/virtual");
    await setSetting(db, "keepAwake", false);
    await clearCollectedData(db);
    for (const t of [db.raw_captures, db.matches, db.aliases, db.odds, db.standings, db.cycles, db.checks]) expect(await t.count()).toBe(0);
    expect(await db.sources.count()).toBe(2);
    expect((await db.settings.get("keepAwake"))?.value).toBe(false);
    // La collecte reprend normalement : la même page est de nouveau lue et enregistrée
    expect((await capture("dom", domText(now), now + 20, "https://site/virtual")).stored).toBe(true);
    expect(await db.matches.count()).toBeGreaterThan(0);
  });
});
