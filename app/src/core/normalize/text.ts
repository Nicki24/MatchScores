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
  return (
    line.length >= 2 &&
    line.length <= 50 &&
    /[a-zà-ÿ]{2,}/i.test(line) &&
    !NOISE.test(line) &&
    !ODDS_RE.test(line) &&
    !SPORT_HEADING.test(line) &&
    !RESULT_RE.test(line) &&
    !/^[VNDPWL]{3,10}$/.test(line)
  );
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
    for (const part of line.split(/\t|\s{2,}|\s(?=\d{1,3}[.,]\d{2}(?:\s|$))/)) {
      const t = part.trim();
      if (!t) continue;
      const glued = t.match(/^(x|n)\s?(\d{1,3}[.,]\d{2})$/i);
      if (glued) {
        toks.push({ text: glued[1] });
        toks.push({ text: glued[2], odds: parseOdds(glued[2]) });
        continue;
      }
      toks.push({ text: t, odds: ODDS_RE.test(t) ? parseOdds(t) : undefined });
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

function standingFromNumbers(position: number, team: string, nums: number[], form?: string): StandingInput {
  const s: StandingInput = { position, team: cleanName(team), points: nums[nums.length - 1], played: nums[0], goals_for: 0, goals_against: 0 };
  if (nums.length >= 7) {
    // J G N P BP BC (Diff) Pts
    [s.played, s.won, s.drawn, s.lost, s.goals_for, s.goals_against] = nums;
  } else if (nums.length >= 4) {
    [s.played, s.won, s.drawn, s.lost] = nums;
  }
  if (form) s.form = form.toUpperCase();
  return s;
}

const INT = /^[+-]?\d{1,3}$/;
const FORM = /^[VNDPWL]{1,10}$/i;

export function parseStandingsText(text: string): StandingInput[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\t/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: StandingInput[] = [];
  // 1. Une ligne par équipe : « 1 London Reds 5 4 1 0 12 4 8 13 WWDWW »
  for (const line of lines) {
    const m = line.match(STANDING_RE);
    if (!m) continue;
    const nums = m[3].trim().split(/\s+/).flatMap((n) => (n.includes(":") ? n.split(":") : [n])).map(Number);
    out.push(standingFromNumbers(Number(m[1]), m[2], nums, m[4]));
  }
  if (out.length >= 4) return out;
  // 2. Une cellule par ligne (tableaux en <div>) : position, équipe, nombres…, forme
  const rows: StandingInput[] = [];
  for (let i = 0; i < lines.length - 3; i++) {
    if (!/^\d{1,2}\.?$/.test(lines[i]) || !/[a-zà-ÿ]{2,}/i.test(lines[i + 1]) || INT.test(lines[i + 1])) continue;
    const nums: number[] = [];
    let j = i + 2;
    while (j < lines.length && INT.test(lines[j]) && nums.length < 10) nums.push(Number(lines[j++]));
    if (nums.length < 2) continue;
    const form = j < lines.length && FORM.test(lines[j]) ? lines[j] : undefined;
    const pos = Number(lines[i].replace(".", ""));
    if (rows.length && pos !== rows[rows.length - 1].position + 1) {
      if (rows.length >= 4) break;
      rows.length = 0;
    }
    if (!rows.length && pos !== 1) continue;
    rows.push(standingFromNumbers(pos, lines[i + 1], nums, form));
    i = j - 1;
  }
  return rows.length >= 4 ? rows : [];
}

const SCORE_TOKEN = /^(\d{1,2})\s*[-:–]\s*(\d{1,2})$/;
const isTeamLine = (l: string) => l.length >= 2 && l.length <= 40 && /[a-zà-ÿ]{2,}/i.test(l) && !NOISE.test(l) && !isRoundLine(l) && !LEAGUE_HINT.test(l);

export function parseResultsText(text: string, reference: Date): MatchInput[] {
  const out: MatchInput[] = [];
  let league: string | undefined;
  let round: number | undefined;
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const push = (home: string, hs: number, as: number, away: string) =>
    out.push({ external_id: domId(round, undefined, cleanName(home), cleanName(away)), league, round, home_team: cleanName(home), away_team: cleanName(away), status: "finished", home_score: hs, away_score: as, fuzzy: round == null });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isRoundLine(line)) {
      round = roundOfLine(line);
      continue;
    }
    if (LEAGUE_HINT.test(line) && line.length <= 40) {
      league = cleanName(line);
      continue;
    }
    // « London Reds 2 - 1 Leeds »
    const m = line.match(RESULT_RE);
    if (m) {
      push(m[1], Number(m[2]), Number(m[3]), m[4]);
      continue;
    }
    // « London Reds » / « 2 - 1 » / « Leeds »
    const sc = lines[i + 1]?.match(SCORE_TOKEN);
    if (sc && isTeamLine(line) && lines[i + 2] && isTeamLine(lines[i + 2])) {
      push(line, Number(sc[1]), Number(sc[2]), lines[i + 2]);
      i += 2;
      continue;
    }
    // « London Reds » / « 2 » / « - » / « 1 » / « Leeds »
    if (isTeamLine(line) && /^\d{1,2}$/.test(lines[i + 1] ?? "") && /^[-:–]$/.test(lines[i + 2] ?? "") && /^\d{1,2}$/.test(lines[i + 3] ?? "") && lines[i + 4] && isTeamLine(lines[i + 4])) {
      push(line, Number(lines[i + 1]), Number(lines[i + 3]), lines[i + 4]);
      i += 4;
    }
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
