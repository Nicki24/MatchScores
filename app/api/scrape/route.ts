import { NextResponse } from "next/server";
import { dedupeMatches, extractEmbeddedJson, extractMatchesFromJson } from "@/lib/extract/json";
import { parseMatchesFromText } from "@/lib/extract/text";
import { emptySnapshot } from "@/lib/snapshot";
import type { Match } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BASE = process.env.BET261_BASE_URL ?? "https://bet261.mg";
/** Endpoints JSON supplémentaires (repérés dans l'onglet Réseau du navigateur), séparés par des virgules. */
const EXTRA = (process.env.BET261_API_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
};

async function get(url: string) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
}

function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(div|li|tr|p|h\d|span|td|a|button)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export async function GET() {
  const snap = emptySnapshot("scrape", BASE);
  const diagnostics: string[] = [];
  const matches: Match[] = [];

  const targets = [BASE, ...EXTRA];
  for (const url of targets) {
    try {
      const { status, type, body } = await get(url);
      diagnostics.push(`${url} → HTTP ${status} (${type.split(";")[0] || "?"}, ${Math.round(body.length / 1024)} Ko)`);
      if (status >= 400) continue;
      const virtual = /virtu/i.test(url);
      if (type.includes("json")) {
        matches.push(...extractMatchesFromJson(JSON.parse(body), { virtual }));
      } else {
        for (const data of extractEmbeddedJson(body)) matches.push(...extractMatchesFromJson(data, { virtual }));
        matches.push(...parseMatchesFromText(htmlToText(body), { virtual }));
      }
    } catch (e) {
      diagnostics.push(`${url} → échec : ${(e as Error).message}`);
    }
  }

  const all = dedupeMatches(matches);
  snap.matches = all.filter((m) => !m.virtual);
  const virtual = all.filter((m) => m.virtual);
  if (virtual.length) snap.virtual.push({ name: "Virtuels Bet261", standings: [], results: [], matches: virtual });
  snap.notes = diagnostics;

  const found = all.length > 0;
  if (!found)
    diagnostics.push(
      "Aucun match lisible côté serveur : le site charge probablement ses cotes en JavaScript. Utilise l'assistant flottant.",
    );
  return NextResponse.json({ ok: found, snapshot: snap, diagnostics });
}
