import type { Match, Result, Sport, Standing, VirtualLeague } from "../types";
import { buildMainMarket, cleanName, detectSport, ODDS_RE, parseForm, parseOdds, uid } from "./normalize";
import { dedupeMatches } from "./json";

/**
 * Analyse le texte copié depuis Bet261 (Ctrl+A puis Ctrl+C sur la page).
 * Reconnaît : matchs + cotes, classements, résultats et forme.
 */

const NOISE = /^(\+?\d{1,3}|1|x|2|1x|x2|12|plus|moins|live|en direct|paris|pari|cotes?|\d{1,2}[:h]\d{2}|\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?|aujourd'hui|demain|today|tomorrow|statistiques?|stats|more|voir|\+ ?\d+|[-–])$/i;
const HEADINGS = /^(football|basket-?ball|tennis|volley-?ball|handball|rugby|hockey|baseball|tennis de table|e-?sports?|virtuels?)$/i;

function isNameLine(line: string) {
  return line.length >= 2 && line.length <= 60 && /[a-zà-ÿ]{2,}/i.test(line) && !NOISE.test(line) && !ODDS_RE.test(line);
}

function splitTeams(line: string): [string, string] | undefined {
  const m = line.match(/^(.{2,50}?)\s+(?:-|–|vs\.?|v)\s+(.{2,50})$/i);
  return m ? [cleanName(m[1]), cleanName(m[2])] : undefined;
}

const OUTCOME = /^(1|x|n|2|1x|x2|12)$/i;
const TIME_RE = /\b(\d{1,2})[:h](\d{2})\b/;

export function parseMatchesFromText(text: string, opts: { sport?: Sport; virtual?: boolean } = {}): Match[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\t+/g, "  ").trim())
    .filter(Boolean);

  // On découpe chaque ligne en tokens pour gérer à la fois "A - B 1.50 3.20 5.00" et un token par ligne.
  type Tok = { text: string; odds?: number; line: number };
  const toks: Tok[] = [];
  lines.forEach((line, i) => {
    const parts = line.split(/\s{2,}|\s(?=\d{1,3}[.,]\d{2}(?:\s|$))/);
    for (const p of parts) {
      const t = p.trim();
      if (!t) continue;
      const odds = ODDS_RE.test(t) ? parseOdds(t) : undefined;
      toks.push({ text: t, odds, line: i });
    }
  });

  const matches: Match[] = [];
  let sport: Sport | undefined = opts.sport;
  let league: string | undefined;
  let time: string | undefined;
  let names: string[] = [];

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.odds) {
      if (HEADINGS.test(t.text)) {
        sport = detectSport(t.text) ?? sport;
        names = [];
        continue;
      }
      const tm = t.text.match(TIME_RE);
      if (tm && t.text.length <= 20) time = `${tm[1].padStart(2, "0")}:${tm[2]}`;
      if (isNameLine(t.text)) {
        names.push(cleanName(t.text));
        if (names.length > 4) names.shift();
      }
      continue;
    }
    // Suite de cotes consécutives
    const run: number[] = [];
    let j = i;
    while (j < toks.length && run.length < 12) {
      if (toks[j].odds) run.push(toks[j++].odds!);
      // Libellés d'issue intercalés (« 1 1.85 X 3.40 2 4.20 ») : on les saute.
      else if (OUTCOME.test(toks[j].text) && toks[j + 1]?.odds) j++;
      else break;
    }
    i = j - 1;

    let teams: [string, string] | undefined;
    const last = names[names.length - 1];
    if (last && splitTeams(last)) teams = splitTeams(last);
    else if (names.length >= 2) teams = [names[names.length - 2], names[names.length - 1]];
    if (names.length >= 3 && !teams?.[0].includes(" - ")) league = names[names.length - 3];
    if (!teams || run.length < 2) continue;

    const s = sport ?? detectSport(league) ?? "football";
    const main = buildMainMarket(run.length >= 3 && s !== "tennis" && s !== "basketball" && s !== "volleyball" ? run.slice(0, 3) : run.slice(0, 2), s);
    if (!main) continue;
    const markets = [main];
    // Si la ligne contient 1X2 + double chance (6 cotes) on les récupère aussi.
    if (main.key === "1X2" && run.length >= 6) {
      markets.push({ key: "DC", name: "Double chance", selections: ["1X", "12", "X2"].map((label, k) => ({ label, odds: run[3 + k] })) });
    }
    matches.push({ id: uid("t"), sport: s, league, home: teams[0], away: teams[1], startTime: time, virtual: opts.virtual, markets });
    names = [];
  }
  return dedupeMatches(matches);
}

/** Lignes de classement : "1 Arsenal 10 7 2 1 20 8 12 23 VVNDV" */
export function parseStandingsFromText(text: string): Standing[] {
  const out: Standing[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    const m = line.match(/^(\d{1,2})[.)]?\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'&-]{1,40}?)\s+((?:[+-]?\d{1,3}(?::\d{1,3})?\s*){2,9})\s*([WDLVNP\s]{2,15})?$/i);
    if (!m) continue;
    const nums = m[3]
      .trim()
      .split(/\s+/)
      .flatMap((n) => (n.includes(":") ? n.split(":") : [n]))
      .map(Number);
    const s: Standing = { position: Number(m[1]), team: cleanName(m[2]) };
    if (nums.length >= 8) {
      // J G N P BP BC Diff Pts
      [s.played, s.won, s.drawn, s.lost, s.goalsFor, s.goalsAgainst] = nums;
      s.points = nums[nums.length - 1];
    } else if (nums.length === 7) {
      [s.played, s.won, s.drawn, s.lost, s.goalsFor, s.goalsAgainst, s.points] = nums;
    } else if (nums.length >= 4) {
      [s.played, s.won, s.drawn, s.lost] = nums;
      s.points = nums[nums.length - 1];
    } else {
      s.played = nums[0];
      s.points = nums[nums.length - 1];
    }
    if (m[4]) s.form = parseForm(m[4]);
    out.push(s);
  }
  // On ne garde que des séquences plausibles (positions croissantes)
  return out.length >= 3 ? out : [];
}

/** Résultats : "Arsenal 2 - 1 Chelsea" ou "Arsenal 2:1 Chelsea" */
export function parseResultsFromText(text: string): Result[] {
  const out: Result[] = [];
  const re = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'&-]{1,40}?)\s+(\d{1,2})\s*[-:–]\s*(\d{1,2})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'&-]{1,40})$/;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.replace(/\s+/g, " ").trim().match(re);
    if (m) out.push({ home: cleanName(m[1]), homeGoals: Number(m[2]), awayGoals: Number(m[3]), away: cleanName(m[4]) });
  }
  return out;
}

export function parseVirtualFromText(text: string, name = "Ligue virtuelle"): VirtualLeague {
  return {
    name,
    standings: parseStandingsFromText(text),
    results: parseResultsFromText(text),
    matches: parseMatchesFromText(text, { sport: "football", virtual: true }),
  };
}
