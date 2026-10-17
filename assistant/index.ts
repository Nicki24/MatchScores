/**
 * Assistant flottant MatchScores — s'exécute directement sur bet261.mg
 * (favori / bookmarklet ou userscript). Il lit la page affichée, analyse
 * les cotes et peut envoyer les données vers l'application.
 */
import { extractMatchesFromDom } from "../lib/extract/dom";
import { extractMatchesFromJson, dedupeMatches } from "../lib/extract/json";
import { parseMatchesFromText, parseResultsFromText, parseStandingsFromText } from "../lib/extract/text";
import { analyzeLeague } from "../lib/analysis/virtuals";
import { DEFAULT_SETTINGS, safestPicks } from "../lib/analysis/sports";
import { encodeSnapshot } from "../lib/snapshot";
import type { Match, Snapshot, VirtualLeague } from "../lib/types";
import { CSS } from "./styles";

declare const __APP_URL__: string;

interface MSWindow extends Window {
  __MS_APP__?: string;
  __MS_ASSISTANT__?: { toggle: () => void };
}
const w = window as MSWindow;

if (w.__MS_ASSISTANT__) {
  w.__MS_ASSISTANT__.toggle();
} else {
  start();
}

function appUrl() {
  const fromScript = (document.currentScript as HTMLScriptElement | null)?.src;
  return (w.__MS_APP__ || (fromScript ? new URL(fromScript).origin : "") || __APP_URL__ || "").replace(/\/$/, "");
}

function start() {
  const APP = appUrl();
  const captured: unknown[] = [];

  // --- Capture des réponses JSON (API internes du site) ---
  const keep = (data: unknown) => {
    captured.push(data);
    if (captured.length > 150) captured.shift();
    scheduleAuto();
  };
  const origFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const res = await origFetch.apply(this, args);
    try {
      if ((res.headers.get("content-type") ?? "").includes("json")) res.clone().json().then(keep, () => {});
    } catch {}
    return res;
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    this.addEventListener("load", () => {
      try {
        if ((this.getResponseHeader("content-type") ?? "").includes("json")) {
          keep(typeof this.response === "string" ? JSON.parse(this.response) : this.response);
        }
      } catch {}
    });
    return (origOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;

  // --- Interface (Shadow DOM pour ne pas être affecté par le CSS du site) ---
  const host = document.createElement("div");
  host.id = "ms-assistant-root";
  host.style.cssText = "position:fixed;z-index:2147483647;top:80px;right:16px;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${CSS}</style>
  <div class="panel" part="panel">
    <header class="head">
      <div class="brand"><span class="logo">MS</span><div><b>MatchScores</b><small>Assistant Bet261</small></div></div>
      <div class="actions"><button class="icon" data-act="min" title="Réduire">–</button><button class="icon" data-act="close" title="Fermer">×</button></div>
    </header>
    <div class="body">
      <div class="tabs"><button data-tab="sports" class="on">Sports</button><button data-tab="virtual">Virtuels</button></div>
      <div class="row">
        <button class="primary" data-act="scan">Analyser la page</button>
        <label class="auto"><input type="checkbox" data-act="auto"> Auto</label>
      </div>
      <div class="status">Ouvre une liste de matchs puis clique sur « Analyser ».</div>
      <div class="results"></div>
      <div class="row foot">
        <button data-act="send" ${APP ? "" : "disabled"}>Envoyer vers l'app ↗</button>
        <button data-act="copy">Copier les données</button>
      </div>
      <p class="warn">Aucun pari n'est sans risque. Mise uniquement ce que tu peux perdre.</p>
    </div>
  </div>`;
  document.documentElement.appendChild(host);

  const $ = <T extends Element>(sel: string) => shadow.querySelector(sel) as T;
  const panel = $<HTMLDivElement>(".panel");
  const status = $<HTMLDivElement>(".status");
  const results = $<HTMLDivElement>(".results");
  let mode: "sports" | "virtual" = /virtu/i.test(location.href) ? "virtual" : "sports";
  let last: Snapshot | null = null;

  const setTab = (t: typeof mode) => {
    mode = t;
    shadow.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", (b as HTMLElement).dataset.tab === t));
  };
  setTab(mode);

  // Déplacement du panneau
  const head = $<HTMLElement>(".head");
  head.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = host.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    const move = (ev: PointerEvent) => {
      host.style.left = `${Math.max(0, ev.clientX - dx)}px`;
      host.style.top = `${Math.max(0, ev.clientY - dy)}px`;
      host.style.right = "auto";
    };
    const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up));
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  });

  const scan = (): Snapshot => {
    const virtual = mode === "virtual";
    let matches: Match[] = extractMatchesFromDom(document, { virtual });
    for (const data of captured) matches.push(...extractMatchesFromJson(data, { virtual }));
    const text = document.body.innerText;
    if (matches.length === 0) matches = parseMatchesFromText(text, { virtual, sport: virtual ? "football" : undefined });
    matches = dedupeMatches(matches);
    const snap: Snapshot = {
      source: "assistant",
      capturedAt: new Date().toISOString(),
      url: location.href,
      matches: virtual ? [] : matches,
      virtual: [],
    };
    if (virtual) {
      const league: VirtualLeague = {
        name: document.querySelector("h1,h2")?.textContent?.trim().slice(0, 60) || "Virtuels Bet261",
        standings: parseStandingsFromText(text),
        results: parseResultsFromText(text),
        matches: matches.map((m) => ({ ...m, sport: "football", virtual: true })),
      };
      snap.virtual.push(league);
    }
    return snap;
  };

  const pct = (p: number) => `${Math.round(p * 100)} %`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const bar = (v: number) => `<div class="bar"><i style="width:${Math.max(4, Math.min(100, v))}%;background:${v >= 72 ? "#22c55e" : v >= 58 ? "#f59e0b" : "#ef4444"}"></i></div>`;

  const render = (snap: Snapshot) => {
    last = snap;
    if (mode === "virtual") {
      const league = snap.virtual[0];
      const analyses = league ? analyzeLeague(league).slice(0, 8) : [];
      status.textContent = league
        ? `${league.matches.length} match(s), ${league.standings.length} équipe(s) au classement, ${league.results.length} résultat(s)`
        : "Rien trouvé.";
      results.innerHTML = analyses.length
        ? analyses
            .map((a) => {
              const b = a.best!;
              return `<div class="card"><div class="m">${esc(a.match.home)} <span>vs</span> ${esc(a.match.away)}</div>
              <div class="p"><b>${esc(b.description)}</b><em>${b.odds ? "@ " + b.odds.toFixed(2) : "cote ?"}</em></div>
              ${bar(b.safety)}<div class="meta">Probabilité ${pct(b.probability)} · xG ${a.expectedGoals.join(" – ")}</div></div>`;
            })
            .join("")
        : `<div class="empty">Aucun match virtuel détecté. Ouvre la page d'une ligue virtuelle (matchs à venir + classement).</div>`;
      return;
    }
    const picks = safestPicks(snap.matches, DEFAULT_SETTINGS, 10);
    status.textContent = `${snap.matches.length} match(s) détecté(s) · ${picks.length} conseil(s)`;
    results.innerHTML = picks.length
      ? picks
          .map(
            (p) => `<div class="card"><div class="m">${esc(p.match.home)} <span>vs</span> ${esc(p.match.away)}</div>
            <div class="p"><b>${esc(p.description)}</b><em>@ ${p.odds.toFixed(2)}${p.estimated ? "*" : ""}</em></div>
            ${bar(p.safety)}<div class="meta">Risque ${p.risk} · probabilité ${pct(p.probability)}</div></div>`,
          )
          .join("")
      : `<div class="empty">Aucun match avec cotes détecté sur cette page. Ouvre une liste de matchs (Football, Basket…) puis relance.</div>`;
  };

  const run = () => {
    try {
      render(scan());
    } catch (e) {
      status.textContent = "Erreur pendant l'analyse : " + (e as Error).message;
    }
  };

  let autoOn = false;
  let timer: number | undefined;
  function scheduleAuto() {
    if (!autoOn) return;
    clearTimeout(timer);
    timer = window.setTimeout(run, 1500);
  }
  const observer = new MutationObserver((muts) => {
    if (muts.some((m) => !host.contains(m.target as Node))) scheduleAuto();
  });

  shadow.addEventListener("click", async (e) => {
    const t = (e.target as HTMLElement).closest("button,input") as HTMLElement | null;
    if (!t) return;
    const act = t.dataset.act;
    if (t.dataset.tab) {
      setTab(t.dataset.tab as typeof mode);
      run();
    } else if (act === "scan") run();
    else if (act === "min") panel.classList.toggle("mini");
    else if (act === "close") toggle();
    else if (act === "auto") {
      autoOn = (t as HTMLInputElement).checked;
      if (autoOn) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      else observer.disconnect();
      run();
    } else if (act === "copy") {
      const snap = last ?? scan();
      await navigator.clipboard.writeText(JSON.stringify(snap)).then(
        () => (status.textContent = "Données copiées : colle-les dans l'onglet « Importer » de l'app."),
        () => (status.textContent = "Copie refusée par le navigateur."),
      );
    } else if (act === "send") {
      const snap = last ?? scan();
      if (window.opener) {
        try {
          window.opener.postMessage({ type: "matchscores:snapshot", snapshot: snap }, APP || "*");
        } catch {}
      }
      const encoded = await encodeSnapshot(snap);
      window.open(`${APP}/connecter#import=${encoded}`, "matchscores");
      status.textContent = "Données envoyées vers MatchScores ✓";
    }
  });

  function toggle() {
    host.style.display = host.style.display === "none" ? "" : "none";
  }
  w.__MS_ASSISTANT__ = { toggle };
  run();
}
