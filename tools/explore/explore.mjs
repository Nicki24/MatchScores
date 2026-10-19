// Phase 1 du cahier des charges : exploration de bet261 (football virtuel).
// Ouvre le site dans un vrai navigateur, enregistre toutes les réponses JSON,
// les WebSockets, le texte et des captures d'écran des pages visitées.
// Usage : node tools/explore/explore.mjs [dossier_sortie]
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "explore-out";
const BASE = process.env.BASE_URL ?? "https://bet261.mg";
const EXTRA_URLS = (process.env.EXTRA_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
mkdirSync(join(OUT, "bodies"), { recursive: true });
mkdirSync(join(OUT, "shots"), { recursive: true });

const log = [];
const network = [];
const sockets = [];
const pages = [];
const say = (...a) => {
  const line = a.join(" ");
  log.push(line);
  console.log(line);
};
const save = (name, data) => writeFileSync(join(OUT, name), typeof data === "string" ? data : JSON.stringify(data, null, 2));
const short = (s, n = 400) => (s.length > n ? s.slice(0, n) + `… (${s.length} car.)` : s);

function topKeys(v, depth = 0) {
  if (depth > 2 || v == null || typeof v !== "object") return typeof v;
  if (Array.isArray(v)) return [`array(${v.length})`, v.length ? topKeys(v[0], depth + 1) : null];
  return Object.fromEntries(Object.keys(v).slice(0, 25).map((k) => [k, depth < 1 ? topKeys(v[k], depth + 1) : typeof v[k]]));
}

const browser = await chromium.launch();
const context = await browser.newContext({
  locale: "fr-FR",
  timezoneId: "Indian/Antananarivo",
  viewport: { width: 1366, height: 900 },
});
const page = await context.newPage();

page.on("response", async (res) => {
  const req = res.request();
  const type = res.headers()["content-type"] ?? "";
  const entry = {
    t: new Date().toISOString(),
    url: res.url(),
    method: req.method(),
    status: res.status(),
    resource: req.resourceType(),
    type,
    postData: req.postData() ? short(req.postData(), 2000) : undefined,
    reqHeaders: ["xhr", "fetch"].includes(req.resourceType()) ? req.headers() : undefined,
  };
  if (/json|text\/plain|javascript/.test(type) && ["xhr", "fetch", "document", "script", "other"].includes(req.resourceType())) {
    try {
      const body = await res.text();
      entry.size = body.length;
      if (/json/.test(type) || /^[\s]*[[{]/.test(body.slice(0, 5))) {
        const file = createHash("sha1").update(entry.url + entry.t).digest("hex").slice(0, 12) + ".json";
        writeFileSync(join(OUT, "bodies", file), body.slice(0, 3_000_000));
        entry.body = file;
        try {
          entry.keys = topKeys(JSON.parse(body));
        } catch {}
      }
    } catch {}
  }
  network.push(entry);
});

page.on("websocket", (ws) => {
  const s = { url: ws.url(), opened: new Date().toISOString(), received: [], sent: [] };
  sockets.push(s);
  say("WEBSOCKET", ws.url());
  ws.on("framereceived", (f) => {
    if (s.received.length < 60) s.received.push(typeof f.payload === "string" ? short(f.payload, 20000) : `[binaire ${f.payload.length} o]`);
  });
  ws.on("framesent", (f) => {
    if (s.sent.length < 30) s.sent.push(typeof f.payload === "string" ? short(f.payload, 4000) : `[binaire ${f.payload.length} o]`);
  });
});

async function snapshot(label, wait = 8000) {
  await page.waitForTimeout(wait);
  const safe = label.replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
  const info = { label, url: page.url(), title: await page.title().catch(() => "") };
  try {
    await page.screenshot({ path: join(OUT, "shots", `${safe}.png`), fullPage: true, timeout: 30000 });
    info.shot = `shots/${safe}.png`;
  } catch (e) {
    info.shotError = e.message;
  }
  try {
    const text = await page.evaluate(() => document.body?.innerText ?? "");
    save(`text_${safe}.txt`, text);
    info.textLength = text.length;
    info.textSample = short(text.replace(/\s+/g, " "), 1500);
  } catch {}
  try {
    save(`html_${safe}.html`, await page.content());
  } catch {}
  try {
    info.links = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, text: (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80) })),
    );
  } catch {
    info.links = [];
  }
  try {
    info.frames = page.frames().map((f) => f.url()).filter((u) => u && u !== "about:blank");
  } catch {}
  pages.push(info);
  say(`PAGE ${label} → ${info.url} (${info.textLength ?? 0} car., ${info.links.length} liens, frames: ${(info.frames ?? []).length})`);
  return info;
}

async function visit(url, label, wait) {
  try {
    say("GOTO", url);
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    say("  statut", res?.status());
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    return await snapshot(label, wait);
  } catch (e) {
    say("  ERREUR", e.message);
    return null;
  }
}

try {
  // robots.txt
  try {
    const r = await fetch(new URL("/robots.txt", BASE));
    save("robots.txt", `HTTP ${r.status}\n` + (await r.text()));
    say("robots.txt HTTP", r.status);
  } catch (e) {
    say("robots.txt erreur", e.message);
  }

  const home = await visit(BASE, "accueil", 10000);
  const allLinks = home?.links ?? [];

  // Liens vers le virtuel, puis CGU
  const virtualLinks = [...new Map(allLinks.filter((l) => /virtu/i.test(l.href + " " + l.text)).map((l) => [l.href, l])).values()];
  say("Liens virtuels :", JSON.stringify(virtualLinks.slice(0, 15)));
  const legalLinks = [...new Map(allLinks.filter((l) => /condition|cgu|terms|r[eè]glement|legal|mentions/i.test(l.href + " " + l.text)).map((l) => [l.href, l])).values()];
  say("Liens légaux :", JSON.stringify(legalLinks.slice(0, 10)));

  const toVisit = [...new Set([...virtualLinks.map((l) => l.href), ...EXTRA_URLS])].slice(0, 4);
  if (!toVisit.length) {
    for (const p of ["/virtual", "/virtuals", "/virtuel", "/virtuels", "/fr/virtual", "/sport/virtual"]) toVisit.push(new URL(p, BASE).toString());
  }
  for (const [i, url] of toVisit.entries()) {
    const info = await visit(url, `virtuel_${i}`, 15000);
    if (!info) continue;
    // Cherche la ligue anglaise et clique dessus
    for (const re of [/english/i, /angleterre/i, /premier/i, /england/i]) {
      const target = page.getByText(re).first();
      if (await target.count().catch(() => 0)) {
        try {
          say("  clic sur", re.toString());
          await target.click({ timeout: 5000 });
          await snapshot(`virtuel_${i}_ligue`, 12000);
          break;
        } catch (e) {
          say("  clic impossible", e.message);
        }
      }
    }
    // Sous-liens virtuels de la page (football, ligues)
    const sub = (info.links ?? []).filter((l) => /foot|soccer|league|ligue/i.test(l.href + " " + l.text)).slice(0, 3);
    for (const [j, l] of sub.entries()) await visit(l.href, `virtuel_${i}_sub${j}`, 12000);
  }

  for (const [i, l] of legalLinks.slice(0, 3).entries()) await visit(l.href, `legal_${i}`, 3000);
} catch (e) {
  say("ERREUR GLOBALE", e.stack ?? e.message);
} finally {
  save("network.json", network);
  save("websockets.json", sockets);
  save("pages.json", pages);
  save("log.txt", log.join("\n"));
  await browser.close();
}

// Résumé lisible dans le journal du job
const jsonCalls = network.filter((n) => n.body);
console.log("\n===== RÉSUMÉ =====");
console.log(`Réponses enregistrées : ${network.length}, dont JSON : ${jsonCalls.length}, WebSockets : ${sockets.length}`);
const hosts = {};
for (const n of network) {
  try {
    const h = new URL(n.url).host;
    hosts[h] = (hosts[h] ?? 0) + 1;
  } catch {}
}
console.log("Hôtes contactés :", JSON.stringify(hosts));
for (const n of jsonCalls.slice(0, 120)) {
  console.log(`JSON ${n.method} ${n.status} ${n.size}o ${short(n.url, 250)} → ${short(JSON.stringify(n.keys ?? {}), 300)}`);
}
for (const s of sockets) {
  console.log(`WS ${s.url} reçus=${s.received.length} envoyés=${s.sent.length}`);
  for (const f of s.sent.slice(0, 5)) console.log("   >", short(f, 300));
  for (const f of s.received.slice(0, 5)) console.log("   <", short(f, 300));
}
for (const p of pages) console.log(`PAGE ${p.label} ${p.url} :: ${short(p.textSample ?? "", 600)}`);
