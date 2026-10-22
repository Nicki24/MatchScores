import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, it } from "vitest";
import { MatchScoresDB } from "../../app/src/core/store";

it("la base existante (v1) est mise à jour : chaque match reçoit sa catégorie", async () => {
  const old = new Dexie("upgrade-v1");
  old.version(1).stores({
    sources: "id",
    raw_captures: "++id, source_id, captured_at, [source_id+hash], kind",
    matches: "key, source_id, [source_id+pair], status, kickoff_at, round, updated_at, first_seen_at",
    aliases: "alias",
    odds: "++id, match_key, [match_key+market+selection], captured_at",
    standings: "key, [source_id+league+season], captured_at",
    cycles: "++id, started_at, source_id",
    checks: "match_key",
    settings: "key",
  });
  const t = new Date().toISOString();
  await old.table("matches").bulkPut([
    { key: "v", source_id: "bet261", external_id: "v", league: "English League", round: 4, home_team: "Leeds", away_team: "Burnley", pair: "leeds|burnley", status: "scheduled", first_seen_at: t, updated_at: t, methods: ["C"] },
    { key: "r", source_id: "bet261", external_id: "r", league: "Premier League", home_team: "Arsenal", away_team: "Chelsea", pair: "arsenal|chelsea", status: "scheduled", first_seen_at: t, updated_at: t, methods: ["C"] },
  ]);
  old.close();
  const db = new MatchScoresDB("upgrade-v1");
  expect((await db.matches.get("v"))!.category).toBe("virtual");
  expect((await db.matches.get("r"))!.category).toBe("real");
  expect(await db.matches.where("updated_at").above("2000").count()).toBe(2);
});
