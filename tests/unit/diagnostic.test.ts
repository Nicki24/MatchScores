import { describe, expect, it } from "vitest";
import { buildDiagnostic, diagnosticFileName } from "../../app/src/core/diagnostic";
import type { RawCapture } from "../../app/src/core/types";

const raw = (kind: RawCapture["kind"], url: string, payload: string, i: number): RawCapture => ({
  source_id: "bet261",
  kind,
  url,
  payload,
  captured_at: new Date(Date.UTC(2026, 9, 19, 10, 0, i)).toISOString(),
  hash: String(i),
  frame: "https://bet261.mg/virtual",
});

describe("relevé de diagnostic", () => {
  it("regroupe les adresses (sans paramètres), limite la taille et garde le rendement de la lecture", () => {
    const big = JSON.stringify({ events: "x".repeat(200_000) });
    const d = buildDiagnostic({
      appVersion: "2.0.0",
      userAgent: "test",
      raw: [
        raw("xhr", "https://api.example/virtual/events?round=1", big, 1),
        raw("xhr", "https://api.example/virtual/events?round=2", '{"events":[]}', 2),
        raw("ws", "wss://push.example/hub", '{"type":1}', 3),
        raw("dom", "https://bet261.mg/virtual", "English League\nJournée 3", 4),
      ],
      cycles: [{ source_id: "bet261", started_at: "2026-10-19T10:00:01Z", duration_ms: 3, kind: "xhr", url: "https://api.example/virtual/events?round=1", matches: 10, odds: 30, standings: 0 }],
      metas: [{ what: "ws-binary", url: "wss://push.example/bin", at: "2026-10-19T10:00:05Z", count: 51 }],
      counts: { matches: 10, odds: 30, standings: 0 },
    });
    expect(d.endpoints).toHaveLength(1);
    expect(d.endpoints[0]).toMatchObject({ url: "https://api.example/virtual/events", count: 2, normalized: { matches: 10, odds: 30 } });
    expect(d.endpoints[0].sample.length).toBeLessThanOrEqual(60_000);
    expect(d.websockets[0].frames).toBe(1);
    expect(d.pages[0].text).toContain("Journée 3");
    expect(d.collector.events[0].what).toBe("ws-binary");
    expect(JSON.stringify(d).length).toBeLessThan(200_000);
    expect(diagnosticFileName(new Date(2026, 9, 19, 8, 5))).toBe("releve-matchscores-20261019-0805.json");
  });
});
