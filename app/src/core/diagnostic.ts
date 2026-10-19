/**
 * Relevé de diagnostic : ce que le collecteur a vu sur bet261 (adresses JSON,
 * WebSockets, texte affiché, résultat de la lecture), à envoyer pour écrire
 * l'adaptateur dédié. Taille limitée, aucune donnée de compte (filtrée à la source).
 */
import type { CycleLog, RawCapture } from "./types";

export interface CollectorMeta {
  what: string;
  url: string;
  at: string;
  [k: string]: unknown;
}

export interface DiagnosticInput {
  appVersion: string;
  userAgent: string;
  collectorUrl?: string;
  generatedAt?: string;
  raw: RawCapture[];
  cycles: CycleLog[];
  metas: CollectorMeta[];
  counts: { matches: number; odds: number; standings: number };
  screenshot?: string;
}

const LIMITS = { endpoints: 40, sample: 60_000, wsFrames: 15, wsFrame: 8_000, domFrames: 4, dom: 120_000 };

const stripQuery = (u: string) => {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch {
    return u.split("?")[0];
  }
};

export function buildDiagnostic(input: DiagnosticInput) {
  const nonDom = input.raw.filter((r) => r.kind !== "dom" && r.kind !== "ws");
  const ws = input.raw.filter((r) => r.kind === "ws");
  const dom = input.raw.filter((r) => r.kind === "dom");

  const yieldByUrl = new Map<string, { matches: number; odds: number; standings: number; errors: number }>();
  for (const c of input.cycles) {
    if (!c.url) continue;
    const k = stripQuery(c.url);
    const y = yieldByUrl.get(k) ?? { matches: 0, odds: 0, standings: 0, errors: 0 };
    y.matches += c.matches;
    y.odds += c.odds;
    y.standings += c.standings;
    if (c.error) y.errors++;
    yieldByUrl.set(k, y);
  }

  const groups = new Map<string, RawCapture[]>();
  for (const r of nonDom) {
    const k = `${r.kind} ${stripQuery(r.url)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const endpoints = [...groups.entries()]
    .map(([k, rs]) => {
      const last = rs[rs.length - 1];
      return {
        kind: last.kind,
        url: stripQuery(last.url),
        exampleUrl: last.url,
        method: last.method,
        count: rs.length,
        statuses: [...new Set(rs.map((r) => r.status).filter((s) => s != null))],
        firstAt: rs[0].captured_at,
        lastAt: last.captured_at,
        normalized: yieldByUrl.get(stripQuery(last.url)) ?? null,
        sampleSize: last.payload.length,
        sample: last.payload.slice(0, LIMITS.sample),
        key: k,
      };
    })
    .sort((a, b) => (b.normalized?.matches ?? 0) - (a.normalized?.matches ?? 0) || b.count - a.count)
    .slice(0, LIMITS.endpoints);

  const sockets = new Map<string, RawCapture[]>();
  for (const r of ws) sockets.set(stripQuery(r.url), [...(sockets.get(stripQuery(r.url)) ?? []), r]);
  const websockets = [...sockets.entries()].map(([url, rs]) => ({
    url,
    frames: rs.length,
    normalized: yieldByUrl.get(url) ?? null,
    samples: rs.slice(-LIMITS.wsFrames).map((r) => r.payload.slice(0, LIMITS.wsFrame)),
  }));

  const frames = new Map<string, RawCapture>();
  for (const r of dom) frames.set(r.frame ?? r.url, r);
  const pages = [...frames.entries()].slice(-LIMITS.domFrames).map(([frame, r]) => ({ frame, at: r.captured_at, text: r.payload.slice(0, LIMITS.dom) }));

  const metas = new Map<string, CollectorMeta>();
  for (const m of input.metas) metas.set(`${m.what} ${m.url}`, m);

  return {
    format: "matchscores-releve/1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    app: { version: input.appVersion, userAgent: input.userAgent },
    collector: { url: input.collectorUrl, events: [...metas.values()].slice(-200) },
    totals: { ...input.counts, rawCaptures: input.raw.length, cycles: input.cycles.length, errors: input.cycles.filter((c) => c.error).length },
    endpoints,
    websockets,
    pages,
    recentCycles: input.cycles.slice(-150),
    screenshot: input.screenshot,
  };
}

export function diagnosticFileName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `releve-matchscores-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}
