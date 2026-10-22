/**
 * Liaison entre l'interface, la base locale et l'appli Android :
 * - reçoit les captures du collecteur (via window.__msFromNative) et les enregistre ;
 * - journalise un cycle par minute et alerte après 3 cycles vides (NF3, NF4) ;
 * - relance les adresses JSON repérées si la méthode B est activée ;
 * - fait tourner la source « Démo » (simulateur) à la demande.
 */
import { useSyncExternalStore } from "react";
import { db, dbReady } from "./db";
import type { CollectorMeta } from "./core/diagnostic";
import { NORMALIZER_VERSION } from "./core/normalize/adapters";
import { getSetting, ingestCapture, pruneStorage, refreshStoredData, setSetting, type IngestResult } from "./core/store";
import type { CaptureKind } from "./core/types";
import { defaultConfig, VirtualLeague } from "./core/sim/engine";
import { apiResults, apiRound, apiStandings } from "./core/sim/payloads";

export const APP_VERSION = "2.1.0";
export const COLLECTOR_SOURCE = "bet261";

interface NativeBridge {
  postMessage(message: string): void;
}

declare global {
  interface Window {
    MSNative?: NativeBridge;
    __msFromNative?: (json: string) => void;
  }
}

export interface RuntimeState {
  native: boolean;
  nativeVersion?: string;
  collector: { visible: boolean; url?: string; loading: boolean; title?: string; loadedOnce: boolean };
  lastCaptureAt?: string;
  lastDataAt?: string;
  captures: number;
  dataCaptures: number;
  emptyCycles: number;
  alert?: string;
  toast?: string;
  demoRunning: boolean;
  /** Relecture des données après une mise à jour de l'appli (« 120/800 »). */
  refreshing?: string;
}

let state: RuntimeState = {
  native: false,
  collector: { visible: false, loading: false, loadedOnce: false },
  captures: 0,
  dataCaptures: 0,
  emptyCycles: 0,
  demoRunning: false,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<RuntimeState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useRuntime(): RuntimeState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const metas: CollectorMeta[] = [];

export function sendNative(msg: Record<string, unknown>) {
  try {
    window.MSNative?.postMessage(JSON.stringify(msg));
  } catch {
    /* hors Android */
  }
}

export function toast(text: string) {
  set({ toast: text });
  setTimeout(() => state.toast === text && set({ toast: undefined }), 3500);
}

/* ---------- Enregistrement des captures (file d'attente : une transaction à la fois) ---------- */

let queue: Promise<unknown> = Promise.resolve();
let minuteData = 0;

export function enqueueCapture(c: { source: string; kind: CaptureKind; url: string; body: string; frame?: string; status?: number; method?: string; at?: number }) {
  const job = queue.then(async () => {
    await dbReady;
    // Source désactivée dans les réglages (F6) : capture ignorée
    if ((await db.sources.get(c.source))?.enabled === false) return undefined;
    const r: IngestResult = await ingestCapture(db, {
      source_id: c.source,
      kind: c.kind,
      url: c.url,
      frame: c.frame,
      status: c.status,
      method: c.method,
      payload: c.body,
      captured_at: new Date(c.at ?? Date.now()).toISOString(),
    });
    // Une lecture inchangée confirme aussi que les données affichées sont à jour
    const hasData = r.unchanged || r.matches + r.odds + r.standings > 0;
    if (hasData) minuteData++;
    const now = new Date().toISOString();
    set({ captures: state.captures + 1, lastCaptureAt: now, ...(hasData ? { dataCaptures: state.dataCaptures + 1, lastDataAt: now } : {}) });
    return r;
  });
  queue = job.catch(() => undefined);
  return job;
}

/**
 * Données enregistrées par une version précédente de la lecture : relues une fois, au premier
 * lancement de la nouvelle version, dans la file des captures (aucune capture ne s'intercale).
 */
function refreshAfterUpdate() {
  const job = queue.then(async () => {
    await dbReady;
    if ((await getSetting(db, "normalizerVersion", 1)) >= NORMALIZER_VERSION) return;
    // Deux tentatives au plus : si l'appli a été fermée (ou a planté) pendant la relecture, on n'insiste pas.
    // L'affichage ignore de toute façon les issues étrangères à un marché.
    const attempts = await getSetting(db, "refreshAttempts", 0);
    await setSetting(db, "refreshAttempts", attempts + 1);
    if (attempts < 2 && (await db.matches.count())) {
      set({ refreshing: "…" });
      await refreshStoredData(db, (done, total) => {
        if (done % 25 === 0 || done === total) set({ refreshing: `${done}/${total}` });
      });
    }
    await setSetting(db, "normalizerVersion", NORMALIZER_VERSION);
    await setSetting(db, "refreshAttempts", 0);
  });
  queue = job.catch(() => undefined).finally(() => set({ refreshing: undefined }));
}

/* ---------- Messages de l'appli Android ---------- */

interface NativeMessage {
  t: string;
  [k: string]: unknown;
}

const pendingShots: ((dataUrl?: string) => void)[] = [];

function onNative(m: NativeMessage) {
  switch (m.t) {
    case "capture":
      enqueueCapture({
        source: COLLECTOR_SOURCE,
        kind: m.kind as CaptureKind,
        url: String(m.url ?? ""),
        body: String(m.body ?? ""),
        frame: m.frame as string | undefined,
        status: m.status as number | undefined,
        method: m.method as string | undefined,
        at: m.at as number | undefined,
      });
      break;
    case "meta":
      metas.push({ ...(m as Record<string, unknown>), what: String(m.what), url: String(m.url ?? ""), at: new Date().toISOString() });
      if (metas.length > 500) metas.splice(0, metas.length - 500);
      break;
    case "collector":
      // Collecte reprise (écran recréé par Android, appli relancée) : l'écran doit rester allumé comme à l'ouverture
      if (!state.collector.loadedOnce && !m.loading && m.url) {
        dbReady.then(() => getSetting(db, "keepAwake", true)).then((on) => on && sendNative({ t: "keepAwake", on: true }), () => undefined);
      }
      set({
        collector: {
          visible: Boolean(m.visible),
          url: m.url as string | undefined,
          loading: Boolean(m.loading),
          title: m.title as string | undefined,
          loadedOnce: state.collector.loadedOnce || (!m.loading && !!m.url),
        },
      });
      break;
    case "app":
      set({ native: true, nativeVersion: m.version as string | undefined });
      break;
    case "shot":
      pendingShots.splice(0).forEach((r) => r(m.dataUrl as string | undefined));
      break;
    case "saved":
      toast(m.ok ? `Enregistré : ${m.name}` : `Échec de l'enregistrement : ${m.error ?? "inconnu"}`);
      break;
  }
}

export function requestCollectorShot(): Promise<string | undefined> {
  if (!state.native) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    pendingShots.push(resolve);
    sendNative({ t: "shot" });
    setTimeout(() => resolve(undefined), 4000);
  });
}

/** Enregistre un fichier (relevé) : Téléchargements + partage sur Android, téléchargement dans un navigateur. */
export function saveFile(name: string, mime: string, text: string) {
  if (state.native) {
    const id = Math.random().toString(36).slice(2);
    const size = 400_000;
    const total = Math.ceil(text.length / size) || 1;
    for (let i = 0; i < total; i++) sendNative({ t: "saveFile", id, name, mime, index: i, total, data: text.slice(i * size, (i + 1) * size) });
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/* ---------- Cycles d'une minute (NF3) et alerte (NF4) ---------- */

async function minuteTick() {
  const collecting = (state.native && state.collector.loadedOnce) || state.demoRunning;
  if (!collecting) return;
  await dbReady;
  const data = minuteData;
  minuteData = 0;
  await db.cycles.add({ source_id: state.demoRunning && !state.native ? "demo" : COLLECTOR_SOURCE, started_at: new Date().toISOString(), duration_ms: 0, kind: "timer", matches: data, odds: 0, standings: 0 });
  const empty = data === 0 ? state.emptyCycles + 1 : 0;
  if (empty >= 3 && !state.alert) {
    const alert = "Aucune donnée reçue depuis 3 minutes : le site a peut-être changé, ou la page ouverte n'est pas celle des matchs. Crée un relevé de diagnostic.";
    set({ emptyCycles: empty, alert });
    sendNative({ t: "notify", title: "MatchScores : collecte interrompue", text: "Aucune donnée depuis 3 cycles." });
  } else set({ emptyCycles: empty, ...(empty === 0 ? { alert: undefined } : {}) });
}

/* ---------- Méthode B : relecture des adresses JSON repérées ---------- */

async function replayTick() {
  if (!state.native || !(await getSetting(db, "replay", false))) return;
  const since = new Date(Date.now() - 30 * 60_000).toISOString();
  const cycles = await db.cycles.where("started_at").above(since).toArray();
  const urls = [...new Set(cycles.filter((c) => c.kind === "xhr" && c.matches > 0 && c.url).map((c) => c.url!))].slice(0, 5);
  if (urls.length) sendNative({ t: "replay", urls });
}

/* ---------- Source « Démo » ---------- */

const demoLeague = new VirtualLeague(defaultConfig({ roundSeconds: 90, liveSeconds: 15, startedAt: Date.UTC(2026, 0, 1) }));
let demoTimer: ReturnType<typeof setInterval> | undefined;

function demoText(now: number) {
  const s = demoLeague.state(now);
  const time = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return [
    s.league,
    `Journée ${s.round}`,
    ...s.matches.flatMap((m) => [time(m.kickoff), m.home, m.away, "1", m.odds["1X2"][0].toFixed(2), "X", m.odds["1X2"][1].toFixed(2), "2", m.odds["1X2"][2].toFixed(2)]),
  ].join("\n");
}

function demoTick() {
  const now = Date.now();
  const s = demoLeague.state(now);
  enqueueCapture({ source: "demo", kind: "xhr", url: "demo://virtual/api/round", body: JSON.stringify(apiRound(s)), at: now });
  enqueueCapture({ source: "demo", kind: "xhr", url: "demo://virtual/api/results", body: JSON.stringify(apiResults(s, 3)), at: now });
  enqueueCapture({ source: "demo", kind: "xhr", url: "demo://virtual/api/standings", body: JSON.stringify(apiStandings(s)), at: now });
  enqueueCapture({ source: "demo", kind: "dom", url: "demo://virtual/page", body: demoText(now), at: now });
}

export async function setDemo(on: boolean) {
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = undefined;
  set({ demoRunning: on });
  if (on) {
    demoTick();
    demoTimer = setInterval(demoTick, 5000);
  }
}

/* ---------- Démarrage ---------- */

let started = false;
export function startRuntime() {
  if (started) return;
  started = true;
  window.__msFromNative = (json: string) => {
    try {
      onNative(JSON.parse(json));
    } catch {
      /* message illisible */
    }
  };
  set({ native: !!window.MSNative });
  sendNative({ t: "ready" });
  refreshAfterUpdate();
  setInterval(minuteTick, 60_000);
  setInterval(replayTick, 30_000);
  setInterval(() => dbReady.then(() => pruneStorage(db)).catch(() => undefined), 10 * 60_000);
  dbReady.then(async () => {
    const demo = await db.sources.get("demo");
    if (demo?.enabled) setDemo(true);
  });
}
