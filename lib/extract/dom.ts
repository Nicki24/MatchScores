import type { Match, Sport } from "../types";
import { buildMainMarket, cleanName, detectSport, oddsInLabel, uid } from "./normalize";
import { dedupeMatches } from "./json";

/**
 * Extraction depuis le DOM d'une page de paris, sans connaître ses classes CSS :
 * 1. on repère les éléments « feuilles » dont le texte est une cote (1.85, 3,20…) ;
 * 2. on remonte jusqu'au plus petit ancêtre qui contient plusieurs cotes ET deux noms : c'est une ligne de match.
 */

const LABEL_NOISE = /^(\+?\d+|1|x|2|1x|x2|12|n|live|en direct|\d{1,2}[:h]\d{2}|\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?|plus|moins|over|under|oui|non|stats?|[-–:])$/i;

function visible(el: Element) {
  const r = (el as HTMLElement).getBoundingClientRect?.();
  return !r || r.width > 0 || r.height > 0;
}

function leafTexts(root: Element): { el: Element; text: string }[] {
  const out: { el: Element; text: string }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text && node.parentElement && !node.parentElement.closest("script,style,noscript,#ms-assistant-root")) {
      out.push({ el: node.parentElement, text });
    }
  }
  return out;
}

function sportFromContext(row: Element, fallback?: Sport): Sport | undefined {
  let el: Element | null = row;
  for (let i = 0; el && i < 8; i++, el = el.parentElement) {
    const heading = el.querySelector?.(":scope > h1, :scope > h2, :scope > h3, :scope > header, [class*='sport' i] > span");
    const s = detectSport(heading?.textContent) ?? detectSport(el.getAttribute?.("class"));
    if (s) return s;
  }
  return fallback;
}

function leagueFromContext(row: Element): string | undefined {
  let el: Element | null = row.parentElement;
  for (let i = 0; el && i < 5; i++, el = el.parentElement) {
    const h = el.querySelector(":scope > [class*='league' i], :scope > [class*='tournament' i], :scope > [class*='competition' i], :scope > [class*='category' i], :scope > h3, :scope > h4");
    const t = h?.textContent?.replace(/\s+/g, " ").trim();
    if (t && t.length < 80) return t;
  }
  return undefined;
}

export function extractMatchesFromDom(root: ParentNode = document, opts: { sport?: Sport; virtual?: boolean } = {}): Match[] {
  const container = root instanceof Document ? root.body : (root as Element);
  if (!container) return [];
  const leaves = leafTexts(container);
  const oddsEls = leaves.filter((l) => oddsInLabel(l.text) && visible(l.el));
  const rows = new Set<Element>();
  const visited = new Set<Element>();

  for (const { el } of oddsEls) {
    let cur: Element | null = el;
    for (let depth = 0; cur && depth < 10; depth++, cur = cur.parentElement) {
      if (visited.has(cur)) break; // ancêtre déjà évalué depuis une autre cote
      visited.add(cur);
      const texts = leafTexts(cur);
      const odds = texts.filter((t) => oddsInLabel(t.text));
      const names = texts.filter((t) => /[a-zà-ÿ]{2,}/i.test(t.text) && !LABEL_NOISE.test(t.text) && !oddsInLabel(t.text) && t.text.length <= 60);
      if (odds.length > 40) break; // on a dépassé la ligne : c'est une liste entière
      if (odds.length >= 2 && (names.length >= 2 || names.some((n) => /\s(-|–|vs)\s/i.test(n.text)))) {
        rows.add(cur);
        break;
      }
    }
  }

  // Ne garder que les lignes les plus internes
  const inner = [...rows].filter((r) => ![...rows].some((o) => o !== r && r.contains(o)));
  const fallbackSport = opts.sport ?? detectSport(location?.pathname) ?? detectSport(document.title);

  const matches: Match[] = [];
  for (const row of inner) {
    const texts = leafTexts(row);
    const odds = texts.map((t) => oddsInLabel(t.text)).filter((n): n is number => !!n);
    const names = texts
      .map((t) => t.text)
      .filter((t) => /[a-zà-ÿ]{2,}/i.test(t) && !LABEL_NOISE.test(t) && !oddsInLabel(t) && t.length <= 60)
      .map(cleanName);
    let home: string | undefined;
    let away: string | undefined;
    const joined = names.find((n) => /\s(-|–|vs)\s/i.test(n));
    if (joined) [home, away] = joined.split(/\s(?:-|–|vs)\s/i).map(cleanName);
    else [home, away] = names;
    if (!home || !away) continue;

    const sport = sportFromContext(row, fallbackSport) ?? "football";
    const twoWay = ["tennis", "basketball", "volleyball", "table-tennis", "baseball", "esport"].includes(sport);
    const main = buildMainMarket(odds.slice(0, twoWay ? 2 : Math.min(3, odds.length)), sport);
    if (!main) continue;
    const markets = [main];
    if (main.key === "1X2" && odds.length >= 6) {
      markets.push({ key: "DC", name: "Double chance", selections: ["1X", "12", "X2"].map((label, k) => ({ label, odds: odds[3 + k] })) });
    }
    const timeText = texts.find((t) => /^\d{1,2}[:h]\d{2}$/.test(t.text))?.text;
    matches.push({
      id: uid("d"),
      sport,
      league: leagueFromContext(row),
      home,
      away,
      startTime: timeText,
      live: /live|direct/i.test(row.className?.toString() ?? ""),
      virtual: opts.virtual,
      markets,
    });
  }
  return dedupeMatches(matches);
}
