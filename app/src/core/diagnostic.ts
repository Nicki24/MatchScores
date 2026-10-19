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

const LIMITS = { endpoints: 40, sample: 60_000, wsFrames: 15, wsFrame: 8_000, domFrames: 4, dom: 120_000 };

const stripQuery = (u: string) => {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch {
    return u.split("?")[0];
  }
};

interface EndpointSummary {
  kind: RawCapture["kind"];
  url: string;
  exampleUrl: string;
  method?: string;
  count: number;
  statuses: Set<number>;
  firstAt: string;
  lastAt: string;
  sampleSize: number;
  sample: string;
}

/**
 * Résumé des captures brutes, construit capture par capture : seuls les comptes et les
 * derniers échantillons (tronqués) sont gardés, pas les captures elles-mêmes.
 */
export class RawSummary {
  total = 0;
  readonly endpoints = new Map<string, EndpointSummary>();
  readonly sockets = new Map<string, { frames: number; samples: string[] }>();
  readonly pages = new Map<string, { at: string; text: string }>();

  add(r: RawCapture) {
    this.total++;
    const url = stripQuery(r.url);
    if (r.kind === "ws") {
      const s = this.sockets.get(url) ?? { frames: 0, samples: [] };
      s.frames++;
      s.samples.push(r.payload.slice(0, LIMITS.wsFrame));
      if (s.samples.length > LIMITS.wsFrames) s.samples.shift();
      this.sockets.set(url, s);
    } else if (r.kind === "dom") {
      const frame = r.frame ?? r.url;
      this.pages.delete(frame);
      this.pages.set(frame, { at: r.captured_at, text: r.payload.slice(0, LIMITS.dom) });
    } else {
      const k = `${r.kind} ${url}`;
      const e = this.endpoints.get(k) ?? { kind: r.kind, url, exampleUrl: r.url, count: 0, statuses: new Set<number>(), firstAt: r.captured_at, lastAt: r.captured_at, sampleSize: 0, sample: "" };
      e.count++;
      if (r.status != null) e.statuses.add(r.status);
      Object.assign(e, { exampleUrl: r.url, method: r.method, lastAt: r.captured_at, sampleSize: r.payload.length, sample: r.payload.slice(0, LIMITS.sample) });
      this.endpoints.set(k, e);
    }
    return this;
  }
}

export interface DiagnosticInput {
  appVersion: string;
  userAgent: string;
  collectorUrl?: string;
  generatedAt?: string;
  /** Captures brutes (dans l'ordre d'arrivée), ou leur résumé. */
  raw: RawCapture[] | RawSummary;
  cycles: CycleLog[];
  metas: CollectorMeta[];
  counts: { matches: number; odds: number; standings: number };
  screenshot?: string;
}

export function buildDiagnostic(input: DiagnosticInput) {
  const summary = input.raw instanceof RawSummary ? input.raw : input.raw.reduce((acc, r) => acc.add(r), new RawSummary());

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

  const endpoints = [...summary.endpoints.entries()]
    .map(([key, e]) => ({ ...e, statuses: [...e.statuses], normalized: yieldByUrl.get(e.url) ?? null, key }))
    .sort((a, b) => (b.normalized?.matches ?? 0) - (a.normalized?.matches ?? 0) || b.count - a.count)
    .slice(0, LIMITS.endpoints);

  const websockets = [...summary.sockets.entries()].map(([url, s]) => ({ url, frames: s.frames, normalized: yieldByUrl.get(url) ?? null, samples: s.samples }));

  const pages = [...summary.pages.entries()].slice(-LIMITS.domFrames).map(([frame, p]) => ({ frame, at: p.at, text: p.text }));

  const metas = new Map<string, CollectorMeta>();
  for (const m of input.metas) metas.set(`${m.what} ${m.url}`, m);

  return {
    format: "matchscores-releve/1",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    app: { version: input.appVersion, userAgent: input.userAgent },
    collector: { url: input.collectorUrl, events: [...metas.values()].slice(-200) },
    totals: { ...input.counts, rawCaptures: summary.total, cycles: input.cycles.length, errors: input.cycles.filter((c) => c.error).length },
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
