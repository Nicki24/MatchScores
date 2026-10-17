import { ASSISTANT_CODE } from "@/lib/generated/assistant-code";

/** Userscript (Tampermonkey / Violentmonkey) qui affiche l'assistant automatiquement sur bet261.mg. */
export function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const script = `// ==UserScript==
// @name         MatchScores — Assistant Bet261
// @namespace    matchscores
// @version      1.0.0
// @description  Panneau flottant d'analyse des cotes sur Bet261 (sports & virtuels)
// @match        https://bet261.mg/*
// @match        https://*.bet261.mg/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
window.__MS_APP__ = ${JSON.stringify(origin)};
${ASSISTANT_CODE}`;
  return new Response(script, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
}
