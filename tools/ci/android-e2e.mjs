// Vérifie l'APK réel sur l'émulateur Android :
//  1. l'appli ouvre le site de test dans son collecteur (comme bet261) ;
//  2. l'interface affiche exactement les matchs et cotes 1X2 de la journée en cours ;
//  3. résultats et classement sont affichés ; captures d'écran à chaque étape.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const PKG = "mg.matchscores.app";
const OUT = "android-e2e";
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [], ok: false };
const step = (name, data = {}) => {
  report.steps.push({ name, at: new Date().toISOString(), ...data });
  console.log("•", name, JSON.stringify(data));
};
const screencap = (name) => {
  writeFileSync(`${OUT}/${name}.png`, execFileSync("adb", ["exec-out", "screencap", "-p"]));
  step(`capture ${name}`);
};
const truth = async () => (await fetch("http://localhost:4173/truth.json")).json();

/** Client minimal du protocole de débogage (CDP) d'une WebView Android. */
function cdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const waiting = new Map();
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)(m);
        waiting.delete(m.id);
      }
    });
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        async evaluate(expression) {
          const m = await new Promise((r) => {
            const n = ++id;
            waiting.set(n, r);
            ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
          });
          if (m.error || m.result?.exceptionDetails) throw new Error(JSON.stringify(m.error ?? m.result.exceptionDetails));
          return m.result.result.value;
        },
        click(selector) {
          return this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error("introuvable : ${selector.replace(/"/g, "'")}"); e.click(); return true; })()`);
        },
        count(selector) {
          return this.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
        },
        close: () => ws.close(),
      }),
    );
  });
}

async function waitFor(fn, timeout, label) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last === true || (last && last.ok)) return last;
    } catch (e) {
      last = String(e);
    }
    await sleep(1500);
  }
  throw new Error(`${label} : délai dépassé (${JSON.stringify(last)})`);
}

try {
  adb("shell", "am", "force-stop", PKG);
  adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`, "--es", "collectorUrl", "'http://10.0.2.2:4173/virtual?mode=api'");
  step("appli lancée");

  const pid = await waitFor(async () => {
    const p = adb("shell", "pidof", PKG);
    return p ? { ok: true, pid: p.split(" ")[0] } : false;
  }, 60_000, "processus");
  const socket = await waitFor(async () => {
    const unix = adb("shell", "cat", "/proc/net/unix");
    const m = unix.match(new RegExp(`@(webview_devtools_remote_${pid.pid})`));
    return m ? { ok: true, name: m[1] } : false;
  }, 60_000, "débogage WebView");
  adb("forward", "tcp:9333", `localabstract:${socket.name}`);
  const targets = async () => (await fetch("http://127.0.0.1:9333/json/list")).json();
  const uiTarget = await waitFor(async () => {
    const t = (await targets()).find((x) => x.type === "page" && x.url.startsWith("https://appassets.androidplatform.net"));
    return t ? { ok: true, t } : false;
  }, 60_000, "interface");
  await waitFor(async () => ({ ok: (await targets()).some((x) => x.type === "page" && x.url.includes("10.0.2.2:4173")) }), 60_000, "collecteur");
  const ui = await cdp(uiTarget.t.webSocketDebuggerUrl);
  step("interface et collecteur chargés", { pages: (await targets()).map((x) => x.url) });

  // Les matchs de la journée en cours apparaissent avec les bonnes cotes
  const check = await waitFor(async () => {
    const t = await truth();
    const cards = await ui.evaluate(`[...document.querySelectorAll('[data-testid="match-card"]')].map((e) => ({
        home: e.querySelector('[data-testid="home"]')?.textContent,
        away: e.querySelector('[data-testid="away"]')?.textContent,
        odds: ["1", "X", "2"].map((s) => e.querySelector('[data-testid="odd-' + s + '"]')?.textContent).join(" "),
      }))`);
    const missing = t.matches.filter((m) => !cards.some((c) => c.home === m.home && c.away === m.away && c.odds === m.odds["1X2"].map((o) => o.toFixed(2)).join(" ")));
    return { ok: missing.length === 0, shown: cards.length, expected: t.matches.length, missing: missing.map((m) => `${m.home}-${m.away}`), round: t.round };
  }, 120_000, "matchs affichés");
  step("matchs de la journée affichés et identiques au site", check);
  screencap("1-matchs");

  await ui.click('[data-testid="match-card"]');
  await sleep(1500);
  screencap("2-detail");
  await ui.click('[aria-label="Retour"]');

  await ui.click('[data-testid="tab-results"]');
  const results = await waitFor(async () => {
    const n = await ui.count('[data-testid="result-row"]');
    return { ok: n >= 10, rows: n };
  }, 60_000, "résultats");
  step("résultats affichés", results);
  screencap("3-resultats");

  await ui.click('[data-testid="tab-standings"]');
  const standings = await waitFor(async () => {
    const n = await ui.count('[data-testid="standings"] tbody tr');
    return { ok: n === 20, rows: n };
  }, 60_000, "classement");
  step("classement affiché", standings);
  screencap("4-classement");

  await ui.click('[data-testid="tab-collect"]');
  await sleep(1000);
  screencap("5-collecte");
  await ui.click('[data-testid="open-collector"]');
  await sleep(2500);
  screencap("6-page-collectee");
  adb("shell", "input", "keyevent", "4");
  await sleep(1500);

  await ui.click('[data-testid="tab-more"]');
  await sleep(1000);
  screencap("7-qualite");

  const counts = await ui.evaluate(`(async () => {
    const open = indexedDB.open("matchscores");
    const db = await new Promise((r, j) => { open.onsuccess = () => r(open.result); open.onerror = () => j(open.error); });
    const count = (store) => new Promise((r) => { const q = db.transaction(store).objectStore(store).count(); q.onsuccess = () => r(q.result); });
    return { raw: await count("raw_captures"), matches: await count("matches"), odds: await count("odds"), standings: await count("standings") };
  })()`);
  step("base locale", counts);
  report.ok = true;
  ui.close();
} catch (e) {
  step("ÉCHEC", { error: String(e?.stack ?? e) });
  try {
    screencap("echec");
  } catch {}
} finally {
  writeFileSync(`${OUT}/rapport.json`, JSON.stringify(report, null, 2));
  try {
    writeFileSync(`${OUT}/logcat.txt`, execFileSync("adb", ["logcat", "-d", "-t", "400"], { encoding: "utf8" }));
  } catch {}
}
process.exit(report.ok ? 0 : 1);
