import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { ingestCapture, MatchScoresDB } from "../../app/src/core/store";
import { retainedMethod, scoreMethods } from "../../app/src/core/quality";
import { defaultConfig, VirtualLeague } from "../../app/src/core/sim/engine";
import { apiResults, apiRound } from "../../app/src/core/sim/payloads";

const T0 = Date.UTC(2026, 0, 1);
const league = new VirtualLeague(defaultConfig({ startedAt: T0, roundSeconds: 120, liveSeconds: 20 }));
const time = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Simule 5 journées de collecte : API (C) toutes les 30 s et texte (D) toutes les 60 s. */
async function collect(db: MatchScoresDB, opts: { domWrongOdds?: boolean } = {}) {
  for (let t = T0 + (2 * 120 + 5) * 1000; t < T0 + 7 * 120 * 1000; t += 30_000) {
    const s = league.state(t);
    const at = new Date(t).toISOString();
    await ingestCapture(db, { source_id: "bet261", kind: "xhr", url: "https://x/round", payload: JSON.stringify(apiRound(s)), captured_at: at });
    await ingestCapture(db, { source_id: "bet261", kind: "xhr", url: "https://x/results", payload: JSON.stringify(apiResults(s, 1)), captured_at: at });
    if ((t / 30_000) % 2 < 1) {
      const text = [
        `Journée ${s.round}`,
        ...s.matches.flatMap((m) => [time(m.kickoff), m.home, m.away, "1", (opts.domWrongOdds ? m.odds["1X2"][0] + 0.1 : m.odds["1X2"][0]).toFixed(2), "X", m.odds["1X2"][1].toFixed(2), "2", m.odds["1X2"][2].toFixed(2)]),
        `Résultats — Journée ${s.round - 1}`,
        ...s.results.filter((m) => m.round === s.round - 1).map((m) => `${m.home} ${m.homeGoals} - ${m.awayGoals} ${m.away}`),
      ].join("\n");
      await ingestCapture(db, { source_id: "bet261", kind: "dom", url: "https://x/virtual", payload: text, captured_at: new Date(t + 1000).toISOString() });
    }
    await db.cycles.add({ source_id: "bet261", started_at: at, duration_ms: 0, kind: "timer", matches: 0, odds: 0, standings: 0 });
  }
}

describe("grille de vérification (section 4)", () => {
  it("note la méthode C ≥ 14/20 avec l'exactitude croisée sur l'écran", async () => {
    const db = new MatchScoresDB("q1");
    await collect(db);
    const scores = scoreMethods({ matches: await db.matches.toArray(), odds: await db.odds.toArray(), cycles: await db.cycles.toArray(), checks: [], conformity: true });
    const c = scores.find((s) => s.method === "C")!;
    expect(c.access).toBe(true);
    expect(c.exactness.mode).toBe("croisé");
    expect(c.exactness.errors).toBe(0);
    expect(c.exactness.checked).toBeGreaterThanOrEqual(20);
    expect(c.completeness.value).toBe(1);
    expect(c.stability.value).toBe(1);
    expect(c.total).toBeGreaterThanOrEqual(14);
    expect(retainedMethod(scores)?.method).toBe("C");
    expect(scores.find((s) => s.method === "B")!.retained).toBe(false);
  });

  it("élimine une méthode dont les cotes diffèrent de l'écran, et tout si la conformité n'est pas validée", async () => {
    const db = new MatchScoresDB("q2");
    await collect(db, { domWrongOdds: true });
    const input = { matches: await db.matches.toArray(), odds: await db.odds.toArray(), cycles: await db.cycles.toArray(), checks: [], conformity: true };
    const c = scoreMethods(input).find((s) => s.method === "C")!;
    expect(c.exactness.errors).toBeGreaterThan(0);
    expect(c.retained).toBe(false);
    expect(scoreMethods({ ...input, conformity: false }).every((s) => !s.retained)).toBe(true);
  });
});
