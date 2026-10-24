/**
 * Adaptateur « texte de la page » (méthode D) : lit le texte affiché
 * (document.body.innerText) — matchs et cotes, journée, résultats, classement.
 */
import { emptyBatch, type MatchInput, type NormalizedBatch, type StandingInput } from "../types";
import { competitionOf, isRegion } from "./competition";
import { classifyMarket, outcome, words } from "./markets";
import { cleanName, hash, ODDS_RE, parseOdds, parseTime } from "./util";

const NOISE =
  /^(\+?\d{1,3}|1|x|2|1x|x2|12|n|plus|moins|over|under|oui|non|gg|ng|live|en direct|paris|pari|cotes?|parier|\d{1,2}[:h]\d{2}(:\d{2})?|\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?|aujourd'hui|demain|today|tomorrow|statistiques?|stats|voir|plus de paris|\+ ?\d+|[-–:]|vs?\.?|résultats?|resultats?|classement|journ[ée]e.*|round.*|week.*|semaine.*|saison.*|season.*|d[ée]but.*|starts? in.*)$/i;
const SPORT_HEADING = /^(football|foot|soccer|virtuels?|virtual|sports? virtuels?)$/i;
/** Libellés de l'interface du site (menus, boutons, marchés) : jamais des noms d'équipes. */
const UI_WORDS =
  /^(connexion|se connecter|inscription|s'inscrire|cr[ée]er un compte|d[ée]connexion|mon compte|profil|solde|d[ée]p[oô]ts?|retraits?|mes paris|historique|paris en direct|paris sportifs|sports?|accueil|menu|aide|contact|promotions?|promos?|bonus|jackpots?|casino|jeux|top|populaires?|favoris|rechercher|recherche|filtres?|tous|toutes|tout voir|voir tout|afficher plus|march[ée]s?|plus de march[ée]s|calendrier|programme|ticket|coupon|panier|mise|gains?|gains? potentiels?|valider|placer le pari|langue|fran[çc]ais|english|malagasy|maintenant|bient[oô]t|termin[ée]e?s?|annul[ée]e?s?|suspendue?s?|ferm[ée]e?s?|ouverte?s?|total|handicap|double chance|mi-temps|score exact|les deux [ée]quipes marquent|buts?|minutes?|r[èe]gles?|conditions|jeu responsable)$/i;
/** Score en cours (pas un résultat final) : « EN DIRECT 2 - 0 », « Live », « MT ». */
const LIVE_MARK = /^(en direct|direct|live|mt|mi-temps|ht|\d{1,3}')(\s|$)/i;
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
/**
 * Libellé d'une cote : 1 / X / 2, Nul, Home / Draw / Away, Domicile / Extérieur, double chance (1X),
 * mi-temps/fin de match (1/1), GG / NG, Oui / Non, Plus 2.5 / Moins 2.5…
 */
const OUTCOME =
  /^(1|x|n|2|1x|x2|12|nul|match nul|draw|home|away|domicile|ext[ée]rieur|tie|[1x2n]\s*\/\s*[1x2n]|gg|ng|oui|non|yes|no|(?:plus|moins|over|under|\+|-)\s*(?:de\s*)?\d+(?:[.,]\d)?|plus|moins|over|under)$/i;
/** Ligne qui nomme un marché ou une option de pari : jamais une équipe (« Résultat final », « 1ère mi-temps », « Plus 2.5 »…). */
const MARKET_LINE =
  / (?:1x2|1n2|mi temps|half|1ere|2eme|1st|2nd|result|resultat|over|under|plus|moins|total|handicap|hcp|score|exact|but|buts|goals?|double chance|gg|ng|btts|les deux|cote|cotes|boostee?s?|principaux|populaires?|domicile|exterieur|nul|draw|home|away|ht|ft|mt|corners?|cartons?|vainqueur|winner|ht ft) |\d[.,]5\b|^\s*[1x2n]\s*\/\s*[1x2n]\s*$/i;
const isMarketLine = (line: string) => MARKET_LINE.test(` ${words(line).join(" ")} `) || MARKET_LINE.test(line);
/** En-tête de marché : ce qui suit appartient-il au résultat du match (1X2) ou à un marché annexe ? */
function headerKind(line: string): "1x2" | "side" {
  const market = classifyMarket({ name: line, labels: ["1", "X", "2"] });
  return market === "1X2" ? "1x2" : "side";
}
const TIME_RE = /^(\d{1,2})[:h](\d{2})$/;
/** Séparateur affiché seul entre deux morceaux d'une ligne (« Finlande » / « - » / « D1 Finlande »). */
const SEPARATOR = /^[-–·/|›>]$/;
/** Score dans une ligne (« Leeds 2 - 1 Burnley », « EN DIRECT 2 - 0 », « 20:30 ») ; pas « Côme 1907 - Sassuolo » ni « Schalke 04 - 1. FC Köln ». */
const SCORE_IN_LINE = /(?:^|\s)\d{1,2}\s*[-:–]\s*\d{1,2}(?![\d.])/;
const RESULT_RE = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'&-]{1,40}?)\s+(\d{1,2})\s*[-:–]\s*(\d{1,2})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'&-]{1,40})$/;
const STANDING_RE =
  /^(\d{1,2})[.)]?\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9 .'&-]{1,40}?)\s+((?:[+-]?\d{1,3}(?::\d{1,3})?\s+){2,9}[+-]?\d{1,3}(?::\d{1,3})?)(?:\s+([VNDPWL]{1,10}))?$/i;

function isName(line: string) {
  return (
    line.length >= 2 &&
    // « Wolverhampton Wanderers FC - Brighton & Hove Albion FC » : une ligne « A - B » peut être plus longue
    (line.length <= 50 || (line.length <= 90 && !!splitTeams(line))) &&
    /[a-zà-ÿ]{2,}/i.test(line) &&
    !NOISE.test(line) &&
    !ODDS_RE.test(line) &&
    !SPORT_HEADING.test(line) &&
    !UI_WORDS.test(line) &&
    !OUTCOME.test(line) &&
    !isMarketLine(line) &&
    !LIVE_MARK.test(line) &&
    !SCORE_IN_LINE.test(line) &&
    !RESULT_RE.test(line) &&
    !/^[VNDPWL]{3,10}$/.test(line)
  );
}

function splitTeams(line: string): [string, string] | undefined {
  const m = line.match(/^(.{2,40}?)\s+(?:-|–|vs\.?|v)\s+(.{2,40})$/i);
  if (!m || SCORE_IN_LINE.test(line)) return undefined;
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
    // « A - B 1.85 3.40 4.20 », « 1 2.58 X 2.04 2 4.96 » : on sépare les cotes des noms et des libellés
    for (const part of line.split(/\t|\s{2,}|\s(?=\d{1,3}[.,]\d{2}(?:\s|$))|(?<=(?:^|\s)\d{1,3}[.,]\d{2})\s/)) {
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

interface Item {
  label?: string;
  odds: number;
}

/**
 * Cotes du résultat du match dans une suite de cotes : le triplet libellé 1 / X / 2 (ou Domicile /
 * Nul / Extérieur, ou les noms des équipes) ; sans libellés, les trois premières. Une suite dont les
 * libellés sont ceux d'un autre marché (1X, 1/1, GG, Plus 2.5…) n'en contient pas.
 */
function mainOdds(
  items: Item[],
  teams: [string, string],
  { block, skipFirst = false }: { block?: { headers: ("1x2" | "side")[] }; skipFirst?: boolean } = {},
): { market: "1X2" | "12"; values: number[] } | undefined {
  const labeled = items.some((it) => it.label);
  if (labeled) {
    const o = items.map((it) => (it.label ? outcome(it.label, teams) : undefined));
    // Un en-tête de marché annexe juste avant : son groupe de cotes (jusqu'au prochain « 1 ») est écarté
    let from = 0;
    if (skipFirst) {
      from = o.findIndex((x, k) => k > 0 && x === "1");
      if (from < 0) return undefined;
    }
    for (let k = from; k + 2 < items.length; k++) {
      const three = [o[k], o[k + 1], o[k + 2]];
      // Une seule cote sans libellé à côté de deux issues connues : c'est la troisième (« Arsenal 2.58 Nul 2.04 Chelsea 4.96 »)
      const missing = three.filter((x) => !x).length;
      const known = new Set(three.filter(Boolean));
      if (missing === 1 && known.size === 2 && !items.slice(k, k + 3).some((it) => it.label && !outcome(it.label, teams))) {
        three[three.indexOf(undefined)] = (["1", "X", "2"] as const).find((x) => !known.has(x));
      }
      if (three.includes("1") && three.includes("X") && three.includes("2")) {
        const v = (x: string) => items[k + three.indexOf(x as "1")].odds;
        return { market: "1X2", values: [v("1"), v("X"), v("2")] };
      }
    }
    // Les libellés 1 et 2 seuls (pas de nul) : vainqueur, si la suite n'a que deux cotes
    if (items.length === 2 && o[0] === "1" && o[1] === "2") return { market: "12", values: items.map((it) => it.odds) };
    return undefined;
  }
  if (skipFirst) return undefined;
  // Colonnes de plusieurs marchés (« Mi-temps | 1X2 ») : le bloc de la colonne du résultat du match
  if (block && block.headers.length > 1 && items.length === 3 * block.headers.length) {
    const col = block.headers.indexOf("1x2");
    return col < 0 ? undefined : { market: "1X2", values: items.slice(3 * col, 3 * col + 3).map((it) => it.odds) };
  }
  if (items.length >= 3) return { market: "1X2", values: items.slice(0, 3).map((it) => it.odds) };
  if (items.length === 2) return { market: "12", values: items.map((it) => it.odds) };
  return undefined;
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
  /** En-têtes de marchés : un en-tête seul vaut pour la liste qui suit (onglet choisi) ; une barre d'onglets, non. */
  let headers: { kind: "1x2" | "side"; at: number }[] = [];
  let listHeader: "1x2" | "side" | undefined;
  /** Matchs lus depuis le début de la liste (journée, ligue) : un en-tête placé après eux est celui d'une section. */
  let emitted = 0;
  /** Position du dernier nom retenu. */
  let lastNameAt = -1;

  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.odds) {
      if (isRoundLine(t.text)) {
        round = roundOfLine(t.text);
        names = [];
        listHeader = undefined;
        emitted = 0;
        continue;
      }
      // Pays et compétition affichés en morceaux (« Finlande » / « - » / « D1 Finlande », « Allemagne » / « Bundesliga 2 ») :
      // recollés en une ligne « Pays - Compétition », sinon ils passeraient pour les deux équipes du match
      const prevName = names[names.length - 1];
      const gap = i - lastNameAt;
      const piece = cleanName(t.text);
      if (
        prevName &&
        isRegion(prevName) &&
        (gap === 1 || (gap === 2 && SEPARATOR.test(toks[i - 1].text))) &&
        !splitTeams(t.text) &&
        isName(t.text) &&
        competitionOf(`${prevName} - ${piece}`)
      ) {
        names[names.length - 1] = `${prevName} - ${piece}`;
        lastNameAt = i;
        continue;
      }
      if (LEAGUE_HINT.test(t.text) && t.text.length <= 40 && !splitTeams(t.text) && !isMarketLine(t.text)) {
        league = cleanName(t.text);
        names = [];
        listHeader = undefined;
        emitted = 0;
        continue;
      }
      const tm = t.text.match(TIME_RE);
      if (tm && t.text.length <= 16) time = `${tm[1].padStart(2, "0")}:${tm[2]}`;
      // Libellé d'une cote (« 1 », « Nul », ou le nom d'une équipe juste avant sa cote) : pas un nom de plus
      const label = toks[i + 1]?.odds && (OUTCOME.test(t.text) || names.includes(cleanName(t.text)));
      if (!label && isMarketLine(t.text) && !OUTCOME.test(t.text) && !isRoundLine(t.text)) {
        const prev = headers[headers.length - 1];
        // Onglet de la liste : seulement avant son premier match, et seul (une barre d'onglets ne dit pas lequel est choisi).
        // Après les équipes d'un match ou après un match lu, c'est l'en-tête d'une section : il vaut pour les cotes qui le suivent.
        const section = emitted > 0 || names.length >= 2 || (names.length === 1 && !!splitTeams(names[0]));
        if (prev && prev.at === i - 1) listHeader = undefined;
        else if (!section) listHeader = headerKind(t.text);
        if (!prev || prev.at !== i - 1) headers = [];
        headers.push({ kind: headerKind(t.text), at: i });
        continue;
      }
      if (!label && isName(t.text)) {
        names.push(cleanName(t.text));
        lastNameAt = i;
        if (names.length > 4) names.shift();
      }
      continue;
    }
    // Suite de cotes, chacune avec son libellé s'il est juste avant elle. Un nom d'équipe ne sert de
    // libellé que dans une suite déjà libellée : « Leeds / Burnley / 1.80 3.50 4.20 » n'en a pas.
    const runStart = i;
    const before = toks[i - 1];
    const items: Item[] = [{ label: before && !before.odds && OUTCOME.test(before.text) ? before.text : undefined, odds: t.odds }];
    let j = i + 1;
    while (j < toks.length && items.length < 16) {
      if (toks[j].odds) items.push({ odds: toks[j++].odds! });
      else if (toks[j + 1]?.odds && (OUTCOME.test(toks[j].text) || (items.some((it) => it.label) && isName(toks[j].text)))) {
        items.push({ label: toks[j].text, odds: toks[j + 1].odds! });
        j += 2;
      } else break;
    }
    // Libellés placés après leur cote (« 2.58 », « 1 », « 2.04 », « X »…) : décalés d'un cran
    const trailing = toks[j];
    if (!items[0].label && items.length >= 2 && items.slice(1).every((it) => it.label) && trailing && !trailing.odds && OUTCOME.test(trailing.text)) {
      for (let k = 0; k < items.length - 1; k++) items[k].label = items[k + 1].label;
      items[items.length - 1].label = trailing.text;
      j++;
    }
    i = j - 1;
    // En-tête juste avant la suite (ou avant son premier libellé), sinon celui de la liste
    const firstAt = runStart - (items[0].label ? 1 : 0);
    const adjacent = headers.length && headers[headers.length - 1].at === firstAt - 1 ? headers[headers.length - 1].kind : undefined;

    let teams: [string, string] | undefined;
    // « Pays - Compétition » (sous les équipes sur bet261, ou en en-tête de liste) : la compétition du match, pas
    // ses équipes — sauf si aucun autre nom ne les donne
    const competition = names.filter((n) => competitionOf(n)).pop();
    const own = competition && names.some((n) => !competitionOf(n)) ? names.filter((n) => !competitionOf(n)) : names;
    const last = own[own.length - 1];
    if (last && splitTeams(last)) teams = splitTeams(last);
    else if (layout === "split") {
      const next = toks[j];
      if (last && next && !next.odds && isName(next.text)) {
        teams = [last, cleanName(next.text)];
        i = j;
      }
    } else if (own.length >= 2) teams = [own[own.length - 2], own[own.length - 1]];
    if (!teams || items.length < 2) continue;

    // Onglet annexe choisi pour la liste (Mi-temps, Double chance…) : le match est lu, pas ses cotes
    const group = headers.length > 1 && !adjacent ? { headers: headers.map((h) => h.kind) } : undefined;
    const listSide = !adjacent && listHeader === "side" && !group;
    const main = listSide ? undefined : mainOdds(items, teams, { block: group, skipFirst: adjacent === "side" });
    // Section annexe d'un match (« Mi-temps » 1 X 2) sans le résultat : on attend la suite de cotes suivante
    if (!main && !listSide && layout === "before") continue;
    if (competition && own !== names) league = competitionOf(competition)!.league;
    const kickoff = time ? parseTime(time, reference) : undefined;
    const fuzzy = round == null && !kickoff;
    const externalId = domId(round, kickoff, teams[0], teams[1]);
    matches.push({ external_id: externalId, league, round, home_team: teams[0], away_team: teams[1], kickoff_at: kickoff, status: "scheduled", fuzzy });
    emitted++;
    if (main) {
      const labels = main.market === "1X2" ? ["1", "X", "2"] : ["1", "2"];
      main.values.forEach((v, k) => odds.push({ external_id: externalId, market: main.market, selection: labels[k], value: v }));
    }
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
const isTeamLine = (l: string) =>
  l.length >= 2 &&
  l.length <= 40 &&
  /[a-zà-ÿ]{2,}/i.test(l) &&
  !/\d\s*[-:–]\s*\d/.test(l) &&
  !LIVE_MARK.test(l) &&
  !NOISE.test(l) &&
  !UI_WORDS.test(l) &&
  !isRoundLine(l) &&
  !LEAGUE_HINT.test(l);

/**
 * Score final plausible. « 20:30 » ou « 07:56 » est une heure de coup d'envoi, pas un score :
 * lue comme un score, elle transformait un match à venir en résultat « 7 - 56 ».
 */
function finalScore(raw: string): [number, number] | undefined {
  const m = raw.trim().match(SCORE_TOKEN);
  if (!m || /^\d{1,2}:\d{2}$/.test(raw.trim())) return undefined;
  const [h, a] = [Number(m[1]), Number(m[2])];
  return h <= 15 && a <= 15 ? [h, a] : undefined;
}

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
      const sc = finalScore(line.slice(m[1].length).match(/^\s*(\d{1,2}\s*[-:–]\s*\d{1,2})/)?.[1] ?? "");
      if (sc && !LIVE_MARK.test(m[1])) push(m[1], sc[0], sc[1], m[4]);
      continue;
    }
    // « London Reds » / « 2 - 1 » / « Leeds »
    const sc = finalScore(lines[i + 1] ?? "");
    if (sc && isTeamLine(line) && lines[i + 2] && isTeamLine(lines[i + 2])) {
      push(line, sc[0], sc[1], lines[i + 2]);
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
