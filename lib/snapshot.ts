import type { Match, Snapshot, SnapshotSource, VirtualLeague } from "./types";
import { dedupeMatches } from "./extract/json";
import { parseMatchesFromText, parseVirtualFromText } from "./extract/text";

export function emptySnapshot(source: SnapshotSource, url?: string): Snapshot {
  return { source, capturedAt: new Date().toISOString(), url, matches: [], virtual: [] };
}

export function splitVirtual(matches: Match[]) {
  return {
    real: matches.filter((m) => !m.virtual),
    virtual: matches.filter((m) => m.virtual),
  };
}

export function snapshotFromText(text: string, mode: "sports" | "virtual"): Snapshot {
  const snap = emptySnapshot("paste");
  if (mode === "virtual") {
    const league = parseVirtualFromText(text);
    if (league.matches.length || league.standings.length || league.results.length) snap.virtual.push(league);
  } else {
    snap.matches = parseMatchesFromText(text);
  }
  return snap;
}

/** Combine deux captures (ex : sports puis virtuels) sans perdre de données. */
export function mergeSnapshots(a: Snapshot | null, b: Snapshot): Snapshot {
  if (!a || a.source === "demo") return b;
  const leagues = new Map<string, VirtualLeague>();
  for (const l of [...a.virtual, ...b.virtual]) {
    const prev = leagues.get(l.name);
    leagues.set(
      l.name,
      prev
        ? {
            name: l.name,
            standings: l.standings.length ? l.standings : prev.standings,
            results: l.results.length ? l.results : prev.results,
            matches: l.matches.length ? l.matches : prev.matches,
          }
        : l,
    );
  }
  return {
    source: b.source,
    capturedAt: b.capturedAt,
    url: b.url ?? a.url,
    matches: dedupeMatches([...b.matches, ...a.matches]),
    virtual: [...leagues.values()],
    notes: b.notes,
  };
}

export function isSnapshot(v: unknown): v is Snapshot {
  const s = v as Snapshot;
  return !!s && typeof s === "object" && Array.isArray(s.matches) && Array.isArray(s.virtual);
}

// --- Transport via l'URL (#import=…) : JSON compressé en base64url ---

function toBase64Url(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

export async function encodeSnapshot(s: Snapshot): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(s));
  if (typeof CompressionStream === "undefined") return "j" + toBase64Url(json);
  return "z" + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeSnapshot(encoded: string): Promise<Snapshot | null> {
  try {
    const bytes = fromBase64Url(encoded.slice(1));
    const json = encoded[0] === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
    const data = JSON.parse(new TextDecoder().decode(json));
    return isSnapshot(data) ? data : null;
  } catch {
    return null;
  }
}
