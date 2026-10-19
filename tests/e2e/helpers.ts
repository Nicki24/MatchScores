import type { Page } from "@playwright/test";
import { normalize_generic } from "../../app/src/core/normalize/adapters";
import { hash } from "../../app/src/core/normalize/util";
import type { CaptureKind, NormalizedBatch, RawCapture } from "../../app/src/core/types";

export const MOCK = "http://localhost:4173";
export const APP = "http://localhost:5173";

export interface CollectorMessage {
  t: "capture" | "meta";
  kind?: CaptureKind;
  url: string;
  body?: string;
  frame?: string;
  what?: string;
}

/** Simule le pont Android : le script collecteur envoie ses messages au test. */
export async function attachCollector(page: Page, onMessage: (m: CollectorMessage) => void) {
  await page.exposeBinding("__msPost", (_src, s: string) => onMessage(JSON.parse(s)));
  await page.addInitScript(() => {
    (window as unknown as { MSBridge: { postMessage(s: string): void } }).MSBridge = {
      postMessage: (s: string) => (window as unknown as { __msPost(s: string): void }).__msPost(s),
    };
  });
  await page.addInitScript({ path: "dist/collector.js" });
}

export function toCapture(m: CollectorMessage): RawCapture {
  return { source_id: "bet261", kind: m.kind!, url: m.url, frame: m.frame, payload: m.body ?? "", captured_at: new Date().toISOString(), hash: hash(m.body ?? "") };
}

export function normalizeAll(msgs: CollectorMessage[]): NormalizedBatch {
  const out: NormalizedBatch = { matches: [], odds: [], standings: [] };
  for (const m of msgs.filter((x) => x.t === "capture")) {
    const b = normalize_generic(toCapture(m));
    out.matches.push(...b.matches);
    out.odds.push(...b.odds);
    out.standings.push(...b.standings);
  }
  return out;
}

export interface Truth {
  league: string;
  season: number;
  round: number;
  matches: { id: string; round: number; home: string; away: string; kickoff: number; status: string; odds: { "1X2": number[] } }[];
  results: { id: string; round: number; home: string; away: string; homeGoals: number; awayGoals: number }[];
  standings: { team: string; points: number; position: number }[];
}

export async function getTruth(page: Page): Promise<Truth> {
  return (await page.request.get(`${MOCK}/truth.json`)).json();
}
