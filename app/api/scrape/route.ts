import { NextResponse } from "next/server";
import { dedupeMatches, extractEmbeddedJson, extractMatchesFromJson } from "@/lib/extract/json";
import { parseMatchesFromText } from "@/lib/extract/text";
import { COMMON_PATHS, findApiUrls, scriptUrls } from "@/lib/extract/discover";
import { emptySnapshot } from "@/lib/snapshot";
import type { Match } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BASE = process.env.BET261_BASE_URL ?? "https://bet261.mg";
/** Endpoints JSON supplémentaires (repérés dans l'onglet Réseau du navigateur), séparés par des virgules. */
const EXTRA = (process.env.BET261_API_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
  Accept: "application/json, text/plain, text/html, */*",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
  Referer: BASE + "/",
  Origin: BASE,
};

async function get(url: string, timeout = 10_000) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout), cache: "no-store", redirect: "follow" });
  const body = await res.text();
  return { status: res.status, type: res.headers.get("content-type") ?? "", body };
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(div|li|tr|p|h\d|span|td|a|button)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function tryJson(body: string): unknown {
  const t = body.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

export async function GET(req: Request) {
  const debug = new URL(req.url).searchParams.has("debug");
  const snap = emptySnapshot("scrape", BASE);
  const diagnostics: string[] = [];
  const matches: Match[] = [];
  const started = Date.now();
  const budgetLeft = () => 50_000 - (Date.now() - started);

  const ingest = (url: string, body: string, type: string) => {
    const virtual = /virtu/i.test(url);
    const json = tryJson(body);
    const before = matches.length;
    if (json !== undefined) matches.push(...extractMatchesFromJson(json, { virtual }));
    else if (type.includes("html")) {
      for (const data of extractEmbeddedJson(body)) matches.push(...extractMatchesFromJson(data, { virtual }));
      matches.push(...parseMatchesFromText(htmlToText(body), { virtual }));
    }
    return { isJson: json !== undefined, found: matches.length - before };
  };

  // 1. Page d'accueil + scripts
  let html = "";
  try {
    const home = await get(BASE);
    html = home.body;
    const r = ingest(BASE, html, home.type);
    diagnostics.push(`${BASE} → HTTP ${home.status} (${Math.round(html.length / 1024)} Ko, ${r.found} match)`);
  } catch (e) {
    diagnostics.push(`${BASE} → échec : ${(e as Error).message}`);
  }

  const bases = new Set<string>();
  const endpoints = new Set<string>(EXTRA);
  const scripts = scriptUrls(html, BASE).slice(0, 15);
  const found = findApiUrls(html, BASE);
  found.bases.forEach((b) => bases.add(b));
  found.endpoints.forEach((e) => endpoints.add(e));

  await Promise.all(
    scripts.map(async (src) => {
      try {
        const { body } = await get(src, 12_000);
        const f = findApiUrls(body, BASE);
        f.bases.forEach((b) => bases.add(b));
        f.endpoints.forEach((e) => endpoints.add(e));
      } catch {}
    }),
  );
  diagnostics.push(`${scripts.length} script(s) analysé(s) · ${bases.size} base(s) d'API · ${endpoints.size} adresse(s) trouvée(s)`);

  // 2. On essaie les adresses trouvées (+ chemins courants sur chaque base)
  for (const b of bases) for (const p of COMMON_PATHS) endpoints.add(b + p);
  const candidates = [...endpoints].filter((u) => !/\.(js|css|png|svg|jpe?g|woff2?)(\?|$)/i.test(u)).slice(0, 60);
  const results: string[] = [];
  for (let i = 0; i < candidates.length && budgetLeft() > 5_000; i += 8) {
    await Promise.all(
      candidates.slice(i, i + 8).map(async (url) => {
        try {
          const { status, type, body } = await get(url, 8_000);
          const r = ingest(url, body, type);
          if (status < 400 && (r.isJson || r.found)) results.push(`${url} → ${status} JSON${r.found ? ` · ${r.found} match` : ""}`);
          else if (debug) results.push(`${url} → ${status}${r.isJson ? " JSON" : ""}`);
        } catch (e) {
          if (debug) results.push(`${url} → ${(e as Error).message}`);
        }
      }),
    );
  }
  diagnostics.push(...results.slice(0, debug ? 80 : 15));
  if (debug) diagnostics.push("Bases : " + ([...bases].join(" · ") || "aucune"), "Scripts : " + (scripts.join(" · ") || "aucun"));

  const all = dedupeMatches(matches);
  snap.matches = all.filter((m) => !m.virtual);
  const virtual = all.filter((m) => m.virtual);
  if (virtual.length) snap.virtual.push({ name: "Virtuels Bet261", standings: [], results: [], matches: virtual });

  const ok = all.length > 0;
  diagnostics.push(
    ok
      ? `${all.length} match(s) récupéré(s).`
      : "Aucun match trouvé automatiquement. Utilise l'appli Android (bulle flottante) ou le copier-coller, et envoie-moi une capture de ce rapport.",
  );
  snap.notes = diagnostics;
  return NextResponse.json({ ok, snapshot: snap, diagnostics });
}
