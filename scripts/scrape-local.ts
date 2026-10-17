/**
 * Scraping avec un vrai navigateur (Playwright), à lancer sur ton ordinateur :
 *   npm i -D playwright && npx playwright install chromium
 *   npm run scrape:local -- https://bet261.mg/ https://bet261.mg/virtuels
 * Le résultat (snapshot.json) s'importe dans l'app : Connecter Bet261 → Fichier JSON.
 */
import { writeFileSync } from "node:fs";
import { dedupeMatches, extractMatchesFromJson } from "../lib/extract/json";
import { parseMatchesFromText, parseResultsFromText, parseStandingsFromText } from "../lib/extract/text";
import type { Match, Snapshot } from "../lib/types";

const urls = process.argv.slice(2).filter((a) => a.startsWith("http"));
if (!urls.length) urls.push("https://bet261.mg/");

let chromium: typeof import("playwright").chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright n'est pas installé : npm i -D playwright && npx playwright install chromium");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ locale: "fr-FR" });
const snap: Snapshot = { source: "scrape", capturedAt: new Date().toISOString(), url: urls[0], matches: [], virtual: [] };

for (const url of urls) {
  const virtual = /virtu/i.test(url);
  const found: Match[] = [];
  const onResponse = async (res: import("playwright").Response) => {
    if (!(res.headers()["content-type"] ?? "").includes("json")) return;
    try {
      found.push(...extractMatchesFromJson(await res.json(), { virtual }));
    } catch {}
  };
  page.on("response", onResponse);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(4000);
  const text = await page.evaluate(() => document.body.innerText);
  page.off("response", onResponse);
  if (!found.length) found.push(...parseMatchesFromText(text, { virtual }));
  const matches = dedupeMatches(found);
  if (virtual) {
    snap.virtual.push({ name: "Virtuels Bet261", matches, standings: parseStandingsFromText(text), results: parseResultsFromText(text) });
  } else snap.matches.push(...matches);
  console.log(`${url} → ${matches.length} match(s)`);
}

await browser.close();
snap.matches = dedupeMatches(snap.matches);
writeFileSync("snapshot.json", JSON.stringify(snap, null, 2));
console.log("snapshot.json écrit.");
