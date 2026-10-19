// Vérifie l'APK réel sur l'émulateur Android :
//  1. l'appli ouvre le site de test dans son collecteur (comme bet261) ;
//  2. l'interface affiche exactement les matchs et cotes 1X2 de la journée en cours ;
//  3. résultats et classement sont affichés ; captures d'écran à chaque étape ;
//  4. même vérification quand les matchs viennent d'une iframe d'une autre origine, puis du texte affiché seul ;
//  5. le relevé de diagnostic est enregistré dans Téléchargements/MatchScores.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const PKG = "mg.matchscores.app";
const OUT = "android-e2e";
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { steps: [], ok: false };
const step = (name, data = {}) => {
  report.steps.push({ name, at: new Date().toISOString(), ...data });
  console.log("•", name, JSON.stringify(data));
};
const screencap = async (name) => {
  // Laisse la WebView finir son rendu avant la capture
  await sleep(2500);
  writeFileSync(`${OUT}/${name}.png`, execFileSync("adb", ["exec-out", "screencap", "-p"]));
  step(`capture ${name}`);
};
const truth = async () => (await fetch("http://localhost:4173/truth.json")).json();

/** Client minimal du protocole de débogage (CDP) d'une WebView Android. */
function cdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    let closed = false;
    const waiting = new Map();
    ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)(m);
        waiting.delete(m.id);
      }
    });
    ws.on("error", reject);
    ws.on("close", () => {
      // Page détruite (écran recréé par Android…) : les appels en cours échouent au lieu d'attendre indéfiniment
      closed = true;
      for (const done of waiting.values()) done({ error: { message: "connexion fermée" } });
      waiting.clear();
    });
    ws.on("open", () =>
      resolve({
        get closed() {
          return closed;
        },
        async evaluate(expression) {
          if (closed) throw new Error("connexion fermée");
          const m = await new Promise((r) => {
            const n = ++id;
            const timer = setTimeout(() => {
              waiting.delete(n);
              r({ error: { message: "pas de réponse en 30 s" } });
            }, 30_000);
            waiting.set(n, (x) => {
              clearTimeout(timer);
              r(x);
            });
            ws.send(JSON.stringify({ id: n, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
          });
          if (m.error || m.result?.exceptionDetails) throw new Error(JSON.stringify(m.error ?? m.result.exceptionDetails));
          return m.result.result.value;
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

const openInCollector = (mode) => adb("shell", "am", "start", "-n", `${PKG}/.MainActivity`, "--es", "collectorUrl", `'http://10.0.2.2:4173/virtual?mode=${mode}'`);

try {
  adb("shell", "am", "force-stop", PKG);
  // Le jeu en iframe vient d'une autre origine (127.0.0.1:4173), relayée vers le site de test de la machine hôte
  adb("reverse", "tcp:4173", "tcp:4173");
  openInCollector("api");
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
  /**
   * Interface de l'appli. Android peut recréer l'écran (au démarrage de l'émulateur notamment) :
   * on attend qu'une seule interface soit ouverte et on s'y reconnecte si elle disparaît.
   */
  let uiConn;
  const connectUi = async () => {
    const found = await waitFor(async () => {
      const pages = (await targets()).filter((x) => x.type === "page" && x.url.startsWith("https://appassets.androidplatform.net"));
      return pages.length === 1 ? { ok: true, t: pages[0] } : { ok: false, pages: pages.length };
    }, 60_000, "interface");
    uiConn = await cdp(found.t.webSocketDebuggerUrl);
    return uiConn;
  };
  const ui = {
    async evaluate(expression) {
      for (let attempt = 0; ; attempt++) {
        const conn = uiConn && !uiConn.closed ? uiConn : await connectUi();
        try {
          return await conn.evaluate(expression);
        } catch (e) {
          if (!conn.closed || attempt >= 2) throw e;
          step("interface recréée : reconnexion");
        }
      }
    },
    click(selector) {
      return this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw new Error("introuvable : ${selector.replace(/"/g, "'")}"); e.click(); return true; })()`);
    },
    count(selector) {
      return this.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    },
    close: () => uiConn?.close(),
  };
  await waitFor(async () => ({ ok: (await targets()).some((x) => x.type === "page" && x.url.includes("10.0.2.2:4173")) }), 60_000, "collecteur");
  await ui.evaluate("document.readyState");
  step("interface et collecteur chargés", { pages: (await targets()).map((x) => x.url) });

  /** Base locale de l'appli, lue depuis l'interface. */
  const idb = (body) =>
    ui.evaluate(`(async () => {
      const open = indexedDB.open("matchscores");
      const db = await new Promise((r, j) => { open.onsuccess = () => r(open.result); open.onerror = () => j(open.error); });
      const all = (store) => new Promise((r) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => r(q.result); });
      const count = (store) => new Promise((r) => { const q = db.transaction(store).objectStore(store).count(); q.onsuccess = () => r(q.result); });
      try { ${body} } finally { db.close(); }
    })()`);

  /** Les matchs de la journée en cours sont-ils tous affichés, avec les bonnes cotes 1X2 ? */
  const shownVsTruth = async () => {
    const t = await truth();
    const cards = await ui.evaluate(`[...document.querySelectorAll('[data-testid="match-card"]')].map((e) => ({
        home: e.querySelector('[data-testid="home"]')?.textContent,
        away: e.querySelector('[data-testid="away"]')?.textContent,
        odds: ["1", "X", "2"].map((s) => e.querySelector('[data-testid="odd-' + s + '"]')?.textContent).join(" "),
      }))`);
    const missing = t.matches.filter((m) => !cards.some((c) => c.home === m.home && c.away === m.away && c.odds === m.odds["1X2"].map((o) => o.toFixed(2)).join(" ")));
    return { ok: missing.length === 0, shown: cards.length, expected: t.matches.length, missing: missing.map((m) => `${m.home}-${m.away}`), round: t.round };
  };

  // Les matchs de la journée en cours apparaissent avec les bonnes cotes
  const check = await waitFor(shownVsTruth, 120_000, "matchs affichés");
  step("matchs de la journée affichés et identiques au site", check);
  await screencap("1-matchs");

  await ui.click('[data-testid="match-card"]');
  await screencap("2-detail");
  await ui.click('[aria-label="Retour"]');

  await ui.click('[data-testid="tab-results"]');
  const results = await waitFor(async () => {
    const n = await ui.count('[data-testid="result-row"]');
    return { ok: n >= 10, rows: n };
  }, 60_000, "résultats");
  step("résultats affichés", results);
  await screencap("3-resultats");

  await ui.click('[data-testid="tab-standings"]');
  const standings = await waitFor(async () => {
    const n = await ui.count('[data-testid="standings"] tbody tr');
    return { ok: n === 20, rows: n };
  }, 60_000, "classement");
  step("classement affiché", standings);
  await screencap("4-classement");

  await ui.click('[data-testid="tab-collect"]');
  await screencap("5-collecte");
  await ui.click('[data-testid="open-collector"]');
  await screencap("6-page-collectee");
  adb("shell", "input", "keyevent", "4");
  await sleep(1500);

  await ui.click('[data-testid="tab-more"]');
  await screencap("7-qualite");

  /**
   * Ouvre une autre présentation du site dans le collecteur, puis attend la journée suivante :
   * ses matchs ne peuvent venir que de cette présentation.
   */
  const phase = async (mode, label, shot, expected) => {
    const from = (await truth()).round;
    openInCollector(mode);
    await waitFor(async () => ({ ok: (await targets()).some((x) => x.type === "page" && x.url.includes(`mode=${mode}`)) }), 60_000, `page ${mode}`);
    await ui.click('[data-testid="tab-matches"]');
    const shown = await waitFor(async () => {
      const t = await truth();
      if (t.round <= from) return { ok: false, waiting: `journée ${t.round}` };
      return shownVsTruth();
    }, 150_000, `${label} : matchs de la journée suivante`);
    // Méthodes qui ont vu les matchs de cette journée (le texte affiché arrive quelques secondes après les réponses JSON)
    const seen = await waitFor(async () => {
      const methods = await idb(`return (await all("matches")).filter((m) => m.round === ${shown.round}).map((m) => m.methods.join("+"));`);
      return { ok: methods.length >= shown.expected && methods.every((m) => m === expected), methods: [...new Set(methods)], count: methods.length };
    }, 30_000, `${label} : matchs vus par ${expected}`);
    step(`${label} : journée ${shown.round} affichée et identique au site`, { ...shown, methods: seen.methods });
    await screencap(shot);
  };

  // Dans l'iframe : réponses JSON (méthode C) et texte affiché (méthode D)
  await phase("iframe", "iframe d'une autre origine", "8-iframe", "C+D");
  const fromFrame = await idb(`return (await all("raw_captures")).filter((r) => (r.frame || "").includes("127.0.0.1:4173/provider") && r.items > 0).map((r) => r.kind);`);
  if (!fromFrame.includes("xhr") || !fromFrame.includes("dom")) throw new Error(`iframe : données non relevées dans l'iframe (${JSON.stringify(fromFrame)})`);
  step("iframe : réponses et texte relevés dans l'iframe", { captures: fromFrame.length, kinds: [...new Set(fromFrame)] });

  await phase("dom", "texte affiché seul", "9-texte", "D");
  const fromText = await idb(`return (await all("raw_captures")).filter((r) => r.kind === "dom" && (r.frame || "").includes("mode=dom") && r.items > 0).length;`);
  if (!fromText) throw new Error("texte : aucune lecture du texte affiché");
  step("texte : matchs lus sur l'écran uniquement (méthode D)", { captures: fromText });

  // Relevé de diagnostic : enregistré dans Téléchargements/MatchScores puis proposé au partage
  await ui.click('[data-testid="tab-more"]');
  await ui.click('[data-testid="more-settings"]');
  await ui.click('[data-testid="diagnostic"]');
  const saved = await waitFor(async () => {
    const ls = adb("shell", "ls", "/sdcard/Download/MatchScores/");
    const name = ls.split(/\s+/).find((f) => /^releve-matchscores-.*\.json$/.test(f));
    return name ? { ok: true, name } : false;
  }, 60_000, "relevé de diagnostic");
  const releve = JSON.parse(adb("shell", "cat", `/sdcard/Download/MatchScores/${saved.name}`));
  step("relevé de diagnostic enregistré", {
    file: saved.name,
    endpoints: releve.endpoints.map((e) => `${e.kind} ${e.url} (${e.normalized?.matches ?? 0} matchs)`),
    pages: releve.pages.map((p) => p.frame),
    screenshot: Boolean(releve.screenshot),
  });
  if (!releve.endpoints.some((e) => (e.normalized?.matches ?? 0) > 0) || !releve.pages.length) throw new Error("relevé incomplet");
  // Le site de test simule un solde et un numéro de téléphone : ils ne doivent jamais être relevés
  if (JSON.stringify(releve).includes("+261 34 00 000 00")) throw new Error("le relevé contient des données de compte");
  await screencap("10-releve");
  adb("shell", "input", "keyevent", "4");

  const counts = await idb(`return { raw: await count("raw_captures"), matches: await count("matches"), odds: await count("odds"), standings: await count("standings"), cycles: await count("cycles") };`);
  step("base locale", counts);
  report.ok = true;
  ui.close();
} catch (e) {
  step("ÉCHEC", { error: String(e?.stack ?? e) });
  try {
    await screencap("echec");
  } catch {}
} finally {
  writeFileSync(`${OUT}/rapport.json`, JSON.stringify(report, null, 2));
  try {
    writeFileSync(`${OUT}/logcat.txt`, execFileSync("adb", ["logcat", "-d", "-t", "400"], { encoding: "utf8" }));
  } catch {}
}
process.exit(report.ok ? 0 : 1);
