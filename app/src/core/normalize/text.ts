/**
 * Adaptateur « texte de la page » (méthode D) : lit le texte affiché
 * (document.body.innerText) — matchs et cotes, journée, résultats, classement.
 */
import { emptyBatch, type MatchInput, type NormalizedBatch, type StandingInput } from "../types";
import { cleanName, hash, ODDS_RE, parseOdds, parseTime } from "./util";

const NOISE =
  /^(\+?\d{1,3}|1|x|2|1x|x2|12|n|plus|moins|over|under|oui|non|gg|ng|live|en direct|paris|pari|cotes?|parier|\d{1,2}[:h]\d{2}(:\d{2})?|\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?|aujourd'hui|demain|today|tomorrow|statistiques?|stats|voir|plus de paris|\+ ?\d+|[-–:]|vs?\.?|résultats?|resultats?|classement|journ[ée]e.*|round.*|week.*|semaine.*|saison.*|season.*|d[ée]but.*|starts? in.*)$/i;
const SPORT_HEADING = /^(football|foot|soccer|virtuels?|virtual|sports? virtuels?)$/i;
const LEAGUE_HINT = /(league|ligue|premier|championship|liga|serie|bundesliga|cup|coupe|division)/i;
const ROUND_WORD = /(journ[ée]e|round|week|semaine|matchday)\s*[:#°n.]*\s*(\d{1,4})/i;
/** Ligne courte qui annonce une journée : « Journée 12 », « Résultats — Round 11 », « J12 ». */
const isRoundLine = (line: string) => line.length <= 40 && (ROUND_WORD.test(line) || /^j\s*\d{1,3}$/i.test(line));
const roundOfLine = (line: string): number | undefined => {
  const m = line.match(ROUND_WORD);
  if (m) return Number(m[2]);
  const j = line.match(/^j\s*(\d{1,3})$/i);
  return j ? Number(j[1]) : undefined;
};
const OUTCOME = /^(1|x|n|2|1x|x2|12)$/i;
const TIME_RE = /^(\d{1,2})[:h](\d{2})$/;
const RESULT_RE = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'&-]{1,40}?)\s+(\d{1,2})\s*[-:–]\s*(\d{1,2})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'&-]{1,40})$/;
const STANDING_RE =
  /^(\d{1,2})[.)]?\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'&-]{1,40}?)\s+((?:[+-]?\d{1,3}(?::\d{1,3})?\s+){2,9}[+-]?\d{1,3}(?::\d{1,3})?)(?:\s+([VNDPWL]{1,10}))?$/i;

function isName(line: string) {
  return line.length >= 2 && line.length <= 50 && /[a-zà-ÿ]{2,}/i.test(line) && !NOISE.test(line) && !ODDS_RE.test(line) && !SPORT_HEADING.test(line);
}

function splitTeams(line: string): [string, string] | undefined {
  const m = line.match(/^(.{2,40}?)\s+(?:-|–|vs\.?|v)\s+(.{2,40})$/i);
  if (!m || /\d\s*$/.test(m[1]) || /^\s*\d/.test(m[2])) return undefined;
  return [cleanName(m[1]), cleanName(m[2])];
}

interface Tok {
  text: string;
  odds?: number;
}

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t+/g, "  ").trim();
    if (!line) continue;
    // « A - B 1.85 3.40 4.20 » : on sépare les cotes des noms
    for (const part of line.split(/\s{2,}|\s(?=\d{1,3}[.,]\d{2}(?:\s|$))/)) {
      const t = part.trim();
      if (t) toks.push({ text: t, odds: ODDS_RE.test(t) ? parseOdds(t) : undefined });
    }
  }
  return toks;
}

type Layout = "before" | "split";

/** Identifiant stable d'un match lu dans le texte : journée (ou heure) + équipes. */
function domId(round: number | undefined, kickoff: string | undefined, home: string, away: string): string {
  return `t${hash([round ?? "", round == null ? kickoff ?? "" : "", home, away].join("|"))}`;
}

function parseMatches(text: string, reference: Date, layout: Layout) {
  const toks = tokenize(text);
  const matches: MatchInput[] = [];
  const odds: NormalizedBatch["odds"] = [];
  let league: string | undefined;
  let round: number | undefined;
  let time: string | undefined;
  let names: string[] = [];
  let dangling = false;

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.odds) {
      if (isRoundLine(t.text)) {
        round = roundOfLine(t.text);
        names = [];
        continue;
      }
      if (LEAGUE_HINT.test(t.text) && t.text.length <= 40 && !splitTeams(t.text)) {
        league = cleanName(t.text);
        names = [];
        continue;
      }
      const tm = t.text.match(TIME_RE);
      if (tm && t.text.length <= 16) time = `${tm[1].padStart(2, "0")}:${tm[2]}`;
      if (isName(t.text)) {
        names.push(cleanName(t.text));
        if (names.length > 4) names.shift();
      }
      continue;
    }
    const run: number[] = [];
    let j = i;
    while (j < toks.length && run.length < 12) {
      if (toks[j].odds) run.push(toks[j++].odds!);
      else if (OUTCOME.test(toks[j].text) && toks[j + 1]?.odds) j++;
      else break;
    }
    i = j - 1;

    let teams: [string, string] | undefined;
    const last = names[names.length - 1];
    if (last && splitTeams(last)) teams = splitTeams(last);
    else if (layout === "split") {
      const next = toks[j];
      if (last && next && !next.odds && isName(next.text)) {
        teams = [last, cleanName(next.text)];
        i = j;
      }
    } else if (names.length >= 2) teams = [names[names.length - 2], names[names.length - 1]];
    if (!teams || run.length < 2) continue;

    const kickoff = time ? parseTime(time, reference) : undefined;
    const fuzzy = round == null && !kickoff;
    const externalId = domId(round, kickoff, teams[0], teams[1]);
    matches.push({ external_id: externalId, league, round, home_team: teams[0], away_team: teams[1], kickoff_at: kickoff, status: "scheduled", fuzzy });
    const main = run.length >= 3 ? run.slice(0, 3) : run.slice(0, 2);
    const labels = main.length === 3 ? ["1", "X", "2"] : ["1", "2"];
    main.forEach((v, k) => odds.push({ external_id: externalId, market: main.length === 3 ? "1X2" : "12", selection: labels[k], value: v }));
    names = [];
  }
  dangling = matches.length > 0 && names.length > 0;
  return { matches, odds, dangling };
}

export function parseStandingsText(text: string): StandingInput[] {
  const out: StandingInput[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, " ").replace(/\s+/g, " ").trim();
    const m = line.match(STANDING_RE);
    if (!m) continue;
    const nums = m[3]
      .trim()
      .split(/\s+/)
      .flatMap((n) => (n.includes(":") ? n.split(":") : [n]))
      .map(Number);
    const s: StandingInput = { position: Number(m[1]), team: cleanName(m[2]), points: nums[nums.length - 1], played: nums[0], goals_for: 0, goals_against: 0 };
    if (nums.length >= 8) {
      // J G N P BP BC Diff Pts
      [s.played, s.won, s.drawn, s.lost, s.goals_for, s.goals_against] = nums;
    } else if (nums.length === 7) {
      [s.played, s.won, s.drawn, s.lost, s.goals_for, s.goals_against] = nums;
    } else if (nums.length >= 4) {
      [s.played, s.won, s.drawn, s.lost] = nums;
    }
    if (m[4]) s.form = m[4].toUpperCase();
    out.push(s);
  }
  // Un vrai classement a plusieurs lignes aux positions croissantes
  return out.length >= 4 ? out : [];
}

export function parseResultsText(text: string, reference: Date): MatchInput[] {
  const out: MatchInput[] = [];
  let league: string | undefined;
  let round: number | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (isRoundLine(line)) round = roundOfLine(line);
    else if (LEAGUE_HINT.test(line) && line.length <= 40) league = cleanName(line);
    const m = line.match(RESULT_RE);
    if (!m) continue;
    const home = cleanName(m[1]);
    const away = cleanName(m[4]);
    out.push({
      external_id: domId(round, undefined, home, away),
      league,
      round,
      home_team: home,
      away_team: away,
      status: "finished",
      home_score: Number(m[2]),
      away_score: Number(m[3]),
      fuzzy: round == null,
    });
  }
  void reference;
  return out;
}

export function normalizeText(text: string, capturedAt = new Date().toISOString()): NormalizedBatch {
  const reference = new Date(capturedAt);
  const before = parseMatches(text, reference, "before");
  const split = parseMatches(text, reference, "split");
  const best =
    split.matches.length > before.matches.length || (split.matches.length === before.matches.length && before.dangling && !split.dangling) ? split : before;
  const out = emptyBatch();
  out.matches.push(...best.matches, ...parseResultsText(text, reference));
  out.odds.push(...best.odds);
  out.standings.push(...parseStandingsText(text));
  return out;
}
