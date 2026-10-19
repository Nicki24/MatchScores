/**
 * Site de test « football virtuel » : imite une page de paris (English League)
 * qui reçoit ses données de 4 façons différentes :
 *   ?mode=api    → API JSON (fetch + XMLHttpRequest)          → méthode C
 *   ?mode=ws     → WebSocket (trames façon SignalR)            → méthode C
 *   ?mode=dom    → HTML seulement, aucune donnée JSON exposée  → méthode D
 *   ?mode=iframe → jeu dans une iframe d'une autre origine     → méthode C (iframe)
 * GET /truth.json donne la vérité terrain pour les tests d'exactitude.
 *
 * Lancement : npm run mock  (PORT=4173 ROUND_SECONDS=120 SEED=261)
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { defaultConfig, VirtualLeague, type SimState } from "../../app/src/core/sim/engine";
import { apiResults, apiRound, apiStandings, truth, wsFrames } from "./payloads";

const PORT = Number(process.env.PORT ?? 4173);
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS ?? 120);
const LIVE_SECONDS = Number(process.env.LIVE_SECONDS ?? Math.max(3, Math.round(ROUND_SECONDS / 6)));
const SEED = Number(process.env.SEED ?? 261);
// On démarre en milieu de saison (5 journées déjà jouées) pour avoir résultats et classement
const started = Date.now() - (5 * ROUND_SECONDS + 1) * 1000;
const league = new VirtualLeague(defaultConfig({ seed: SEED, roundSeconds: ROUND_SECONDS, liveSeconds: LIVE_SECONDS, startedAt: started }));
const state = (): SimState => league.state(Date.now());

const API = "/api/v1/virtual/english-league";

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Fragment HTML (mode dom) : mêmes informations que le rendu JavaScript des autres modes. */
function fragment(s: SimState) {
  const rows = s.matches
    .map(
      (m) => `<div class="ev" data-id="${m.id}"><span class="time" data-ts="${m.kickoff}"></span><div class="teams"><span>${esc(m.home)}</span><span>${esc(m.away)}</span></div>
<div class="odds"><button><i>1</i><b>${m.odds["1X2"][0].toFixed(2)}</b></button><button><i>X</i><b>${m.odds["1X2"][1].toFixed(2)}</b></button><button><i>2</i><b>${m.odds["1X2"][2].toFixed(2)}</b></button></div>
${m.status === "live" ? `<span class="live">EN DIRECT ${m.homeGoals} - ${m.awayGoals}</span>` : ""}</div>`,
    )
    .join("\n");
  const last = s.results.filter((m) => m.round === s.round - 1);
  const results = last.map((m) => `<div class="res">${esc(m.home)} ${m.homeGoals} - ${m.awayGoals} ${esc(m.away)}</div>`).join("\n");
  const table = s.standings
    .map(
      (r) =>
        `<tr><td>${r.position}</td><td>${esc(r.team)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td><td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${r.goalsFor - r.goalsAgainst}</td><td>${r.points}</td><td>${r.form}</td></tr>`,
    )
    .join("\n");
  return `<h1>${esc(s.league)}</h1><div class="season">Saison ${s.season}</div><h2>Journée ${s.round}</h2>
<section class="events">${rows}</section>
<h3>Résultats — Journée ${s.round - 1}</h3><section class="results">${results}</section>
<h3>Classement</h3><table class="standings"><tbody>${table}</tbody></table>`;
}

const STYLE = `body{font-family:Arial,sans-serif;background:#0d3b24;color:#fff;margin:0;padding:12px}
.ev{display:flex;gap:10px;align-items:center;padding:8px;border-bottom:1px solid #2a6}
.teams{display:flex;flex-direction:column;min-width:150px}.odds{display:flex;gap:6px}
button{background:#155;color:#fff;border:0;padding:6px 8px;border-radius:4px}button i{opacity:.6;margin-right:6px}
.res{padding:4px 0}table{border-collapse:collapse}td{padding:2px 6px;border-bottom:1px solid #2a6}.live{color:#f66}`;

/** Script client commun : récupère les données selon le mode puis affiche la page. */
const CLIENT = `
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'api';
const API = '${API}';
const root = document.getElementById('root');
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function fillTimes() { document.querySelectorAll('.time[data-ts]').forEach((e) => (e.textContent = fmtTime(Number(e.dataset.ts)))); }
function xhrGet(url) { return new Promise((ok, ko) => { const x = new XMLHttpRequest(); x.open('GET', url); x.onload = () => ok(JSON.parse(x.responseText)); x.onerror = ko; x.send(); }); }
function render(d) {
  const ev = d.events.map((m) => '<div class="ev" data-id="' + m.id + '"><span class="time" data-ts="' + m.kickoff + '"></span><div class="teams"><span>' + esc(m.home) + '</span><span>' + esc(m.away) + '</span></div>' +
    '<div class="odds">' + ['1', 'X', '2'].map((l, i) => '<button><i>' + l + '</i><b>' + m.odds[i].toFixed(2) + '</b></button>').join('') + '</div>' +
    (m.live ? '<span class="live">EN DIRECT ' + m.live + '</span>' : '') + '</div>').join('');
  const res = d.results.map((m) => '<div class="res">' + esc(m.home) + ' ' + m.hg + ' - ' + m.ag + ' ' + esc(m.away) + '</div>').join('');
  const tab = d.table.map((r) => '<tr><td>' + r.position + '</td><td>' + esc(r.team) + '</td><td>' + r.played + '</td><td>' + r.won + '</td><td>' + r.drawn + '</td><td>' + r.lost + '</td><td>' + r.gf + '</td><td>' + r.ga + '</td><td>' + (r.gf - r.ga) + '</td><td>' + r.points + '</td><td>' + (r.form || '') + '</td></tr>').join('');
  root.innerHTML = '<h1>' + esc(d.league) + '</h1><div class="season">Saison ' + d.season + '</div><h2>Journée ' + d.round + '</h2><section class="events">' + ev + '</section>' +
    '<h3>Résultats — Journée ' + (d.round - 1) + '</h3><section class="results">' + res + '</section><h3>Classement</h3><table class="standings"><tbody>' + tab + '</tbody></table>';
  fillTimes();
}
async function fromApi() {
  const [round, standings, results] = await Promise.all([fetch(API + '/round').then((r) => r.json()), fetch(API + '/standings').then((r) => r.json()), xhrGet(API + '/results?last=1')]);
  const last = results.rounds[0] || { matches: [] };
  render({
    league: round.league.name, season: round.season.id, round: round.round.number,
    events: round.events.map((e) => ({ id: e.eventId, home: e.homeTeam.name, away: e.awayTeam.name, kickoff: Date.parse(e.startTime), odds: e.markets[0].selections.map((s) => Number(s.odds)), live: e.status === 'Live' && e.score ? e.score.home + ' - ' + e.score.away : '' })),
    results: last.matches.map((m) => ({ home: m.home, away: m.away, hg: m.result.split(':')[0], ag: m.result.split(':')[1] })),
    table: standings.table.map((r) => ({ position: r.position, team: r.team.name, played: r.played, won: r.won, drawn: r.drawn, lost: r.lost, gf: r.goalsFor, ga: r.goalsAgainst, points: r.points, form: r.form })),
  });
}
let wsData = {};
function fromWs() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onmessage = (e) => {
    for (const part of String(e.data).split('\\x1e')) {
      if (!part) continue;
      const f = JSON.parse(part); const a = f.arguments[0];
      if (f.target === 'RoundUpdate') wsData.round = a; else if (f.target === 'Results') wsData.results = a; else if (f.target === 'Standings') wsData.table = a;
    }
    if (wsData.round && wsData.results && wsData.table) render({
      league: wsData.round.LeagueName, season: wsData.round.SeasonNumber, round: wsData.round.RoundNumber,
      events: wsData.round.Events.map((e) => ({ id: e.Id, home: e.Participants[0].Name, away: e.Participants[1].Name, kickoff: Date.parse(e.StartDate), odds: e.Markets[0].Outcomes.map((o) => o.Price), live: e.Status === 'Live' ? e.Score : '' })),
      results: wsData.results.Events.map((e) => ({ home: e.Participants[0].Name, away: e.Participants[1].Name, hg: e.Score.split('-')[0], ag: e.Score.split('-')[1] })),
      table: wsData.table.Rows.map((r) => ({ position: r.Rank, team: r.TeamName, played: r.Played, won: r.Won, drawn: r.Draw, lost: r.Lost, gf: r.GoalsFor, ga: r.GoalsAgainst, points: r.Points, form: '' })),
    });
  };
  ws.onclose = () => setTimeout(fromWs, 2000);
}
async function fromDom() { root.innerHTML = await (await fetch('/fragment')).text(); fillTimes(); }
async function tick() { try { if (mode === 'api') await fromApi(); else if (mode === 'dom') await fromDom(); } catch (e) { console.error(e); } }
// Données personnelles simulées : le collecteur ne doit jamais les enregistrer
fetch('/account/balance').catch(() => {});
if (mode === 'ws') fromWs(); else { tick(); setInterval(tick, 3000); }
`;

function page(title: string, body: string, script = "") {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${STYLE}</style></head><body>${body}${script ? `<script>${script}</script>` : ""}</body></html>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const send = (status: number, type: string, body: string) => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "cache-control": "no-store" });
    res.end(body);
  };
  const json = (data: unknown) => send(200, "application/json; charset=utf-8", JSON.stringify(data));
  const s = state();
  switch (url.pathname) {
    case "/":
      return send(200, "text/html; charset=utf-8", page("Site de test", `<h1>Site de test MatchScores</h1><p><a href="/virtual?mode=api">Virtuels — Football</a></p>`));
    case "/virtual": {
      const mode = url.searchParams.get("mode") ?? "api";
      if (mode === "iframe") {
        // Le jeu est servi par une autre origine (localhost ↔ 127.0.0.1)
        const host = req.headers.host ?? `localhost:${PORT}`;
        const alt = host.startsWith("127.0.0.1") ? host.replace("127.0.0.1", "localhost") : host.replace(/^[^:]+/, "127.0.0.1");
        return send(200, "text/html; charset=utf-8", page("Virtuels", `<h1>Virtuels</h1><iframe id="game" src="http://${alt}/provider?mode=api" style="width:100%;height:1400px;border:0"></iframe>`));
      }
      return send(200, "text/html; charset=utf-8", page("Virtuels — English League", `<div id="root">Chargement…</div>`, CLIENT));
    }
    case "/provider":
      return send(200, "text/html; charset=utf-8", page("Fournisseur", `<div id="root">Chargement…</div>`, CLIENT));
    case "/fragment":
      return send(200, "text/html; charset=utf-8", fragment(s));
    case `${API}/round`:
      return json(apiRound(s));
    case `${API}/standings`:
      return json(apiStandings(s));
    case `${API}/results`:
      return json(apiResults(s, Number(url.searchParams.get("last") ?? 3)));
    case "/account/balance":
      return json({ balance: 125000, currency: "MGA", phone: "+261 34 00 000 00" });
    case "/truth.json":
      return json(truth(s));
    default:
      return send(404, "text/plain", "introuvable");
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  const push = () => ws.readyState === ws.OPEN && ws.send(wsFrames(state()).join(""));
  push();
  const t = setInterval(push, 2000);
  ws.on("close", () => clearInterval(t));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Site de test prêt : http://localhost:${PORT}/virtual?mode=api (journée de ${ROUND_SECONDS} s)`);
});
