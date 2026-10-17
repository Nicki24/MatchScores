/**
 * Découverte des API internes d'un site « coquille » (SPA) : on lit son HTML,
 * on télécharge ses scripts JavaScript et on y repère les URL d'API.
 */

export interface Discovery {
  scripts: string[];
  apiBases: string[];
  endpoints: string[];
}

const ABS_URL_RE = /https?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[\w\-./{}$]*)?/gi;
const REL_API_RE = /["'`](\/(?:api|rest|v\d|sport|sports|feed|odds|events?|prematch|pre-match|live|virtual|virtuals|offer|line)[\w\-./?=&%]*)["'`]/gi;
const INTERESTING = /(api|sport|odds|event|match|feed|prematch|virtual|offer|line|bet|game|market)/i;
const IGNORED_HOSTS =
  /(google|gstatic|facebook|fbcdn|twitter|doubleclick|googletagmanager|hotjar|sentry|cloudflareinsights|w3\.org|schema\.org|jsdelivr|unpkg|cdnjs|reactjs|mozilla|github|apple\.com|microsoft|youtube|tiktok|instagram|whatsapp|onesignal|intercom|zendesk|livechat|tawk)/i;

export function scriptUrls(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    try {
      out.add(new URL(m[1], base).toString());
    } catch {}
  }
  for (const m of html.matchAll(/<link[^>]+href=["']([^"']+\.js(?:\?[^"']*)?)["']/gi)) {
    try {
      out.add(new URL(m[1], base).toString());
    } catch {}
  }
  return [...out];
}

/** URL d'API trouvées dans du code JS (absolues + chemins relatifs commençant par /api…). */
export function findApiUrls(code: string, base: string): { bases: string[]; endpoints: string[] } {
  const bases = new Set<string>();
  const endpoints = new Set<string>();
  for (const m of code.matchAll(ABS_URL_RE)) {
    const url = m[0].replace(/[.,;)]+$/, "");
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    if (IGNORED_HOSTS.test(u.hostname) || /\.(png|jpe?g|svg|gif|webp|css|woff2?|ttf|mp3|mp4|ico)$/i.test(u.pathname)) continue;
    if (!INTERESTING.test(u.hostname + u.pathname)) continue;
    if (u.pathname.length <= 1 || /\/$/.test(u.pathname)) bases.add(u.origin + u.pathname.replace(/\/$/, ""));
    else endpoints.add(u.toString());
  }
  for (const m of code.matchAll(REL_API_RE)) {
    if (m[1].includes("${") || m[1].includes("{")) continue;
    try {
      endpoints.add(new URL(m[1], base).toString());
    } catch {}
  }
  return { bases: [...bases], endpoints: [...endpoints] };
}

/** Chemins courants des plateformes de paris, essayés sur chaque base d'API découverte. */
export const COMMON_PATHS = [
  "",
  "/api/sports",
  "/api/events",
  "/api/prematch",
  "/api/v1/sports",
  "/api/v1/events",
  "/sports",
  "/events",
  "/prematch",
  "/virtual",
  "/virtuals",
];
