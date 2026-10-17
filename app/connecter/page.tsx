"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bookmark,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  ExternalLink,
  FileJson,
  Globe,
  Loader2,
  MousePointerClick,
  PlayCircle,
  Puzzle,
  Trash2,
} from "lucide-react";
import { ASSISTANT_CODE } from "@/lib/generated/assistant-code";
import { useStore } from "@/lib/store";
import { decodeSnapshot, isSnapshot, snapshotFromText } from "@/lib/snapshot";
import type { Snapshot } from "@/lib/types";
import { Button, Card } from "@/components/ui";
import { InstallApp } from "@/components/InstallApp";

const BET261 = "https://bet261.mg";

function summary(s: Snapshot) {
  const v = s.virtual.reduce((n, l) => n + l.matches.length, 0);
  return `${s.matches.length} match(s) sport, ${v} match(s) virtuel(s)`;
}

/** Lien-favori : React bloque les href « javascript: », on le pose donc à la main. */
function BookmarkletLink({ code, children }: { code: string; children: React.ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    ref.current?.setAttribute("href", code);
  }, [code]);
  return (
    <a
      ref={ref}
      onClick={(e) => {
        e.preventDefault();
        alert("Glisse ce bouton dans ta barre de favoris, puis clique dessus quand tu es sur bet261.mg.");
      }}
      className="inline-flex cursor-grab items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2.5 text-sm font-bold text-emerald-950 shadow-lg shadow-emerald-500/20 active:cursor-grabbing"
    >
      <Bookmark className="h-4 w-4" /> {children}
    </a>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="relative flex gap-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-400/15 font-display text-sm font-bold text-emerald-300">{n}</span>
      <div className="flex-1 pb-6">
        <div className="font-semibold">{title}</div>
        <div className="mt-1.5 text-sm text-slate-400">{children}</div>
      </div>
    </li>
  );
}

export default function ConnectPage() {
  const router = useRouter();
  const { setSnapshot, loadDemo, clear, snapshot } = useStore();
  const [origin, setOrigin] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [scrape, setScrape] = useState<{ loading: boolean; diagnostics?: string[]; ok?: boolean }>({ loading: false });
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"sports" | "virtual">("sports");

  const accept = (s: Snapshot, label: string) => {
    setSnapshot(s);
    setToast(`${label} : ${summary(s)}`);
    const hasSports = s.matches.length > 0;
    setTimeout(() => router.push(hasSports ? "/" : "/virtuels"), 1400);
  };

  useEffect(() => {
    setOrigin(location.origin);
    // Données envoyées par l'assistant via l'URL (#import=…)
    const m = location.hash.match(/import=([^&]+)/);
    if (m) {
      history.replaceState(null, "", location.pathname);
      decodeSnapshot(m[1]).then((s) => (s ? accept(s, "Données reçues de Bet261") : setToast("Données illisibles.")));
    }
    // … ou via postMessage depuis la fenêtre Bet261 ouverte par l'app
    const onMsg = (e: MessageEvent) => {
      if (!/(^|\.)bet261\.mg$/.test(new URL(e.origin).hostname)) return;
      if (e.data?.type === "matchscores:snapshot" && isSnapshot(e.data.snapshot)) accept(e.data.snapshot, "Données reçues de Bet261");
    };
    addEventListener("message", onMsg);
    return () => removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inline = origin ? `javascript:${encodeURIComponent(`window.__MS_APP__=${JSON.stringify(origin)};${ASSISTANT_CODE}`)}` : "";
  const loader = origin
    ? `javascript:(function(){window.__MS_APP__=${JSON.stringify(origin)};var s=document.createElement('script');s.src=${JSON.stringify(origin + "/assistant.js")}+'?'+Date.now();s.onerror=function(){alert('Bet261 bloque le chargement externe : utilise le favori « autonome ».')};document.body.appendChild(s)})()`
    : "";

  const runScrape = async () => {
    setScrape({ loading: true });
    try {
      const res = await fetch("/api/scrape");
      const data = await res.json();
      setScrape({ loading: false, diagnostics: data.diagnostics, ok: data.ok });
      if (data.ok) accept(data.snapshot, "Scraping réussi");
    } catch (e) {
      setScrape({ loading: false, ok: false, diagnostics: [(e as Error).message] });
    }
  };

  const importText = () => {
    const trimmed = text.trim();
    if (trimmed.startsWith("{")) {
      try {
        const data = JSON.parse(trimmed);
        if (isSnapshot(data)) return accept({ ...data, source: data.source ?? "file" }, "Import JSON");
      } catch {}
    }
    const s = snapshotFromText(trimmed, mode);
    if (!s.matches.length && !s.virtual.length) return setToast("Aucun match reconnu dans ce texte.");
    accept(s, "Texte analysé");
  };

  return (
    <div className="space-y-8">
      <section>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Connecter <span className="text-gradient">Bet261</span>
        </h1>
        <p className="mt-2 max-w-3xl text-slate-400">
          Trois façons de récupérer les matchs. L&apos;<b className="text-slate-200">assistant flottant</b> est la plus
          fiable : il s&apos;exécute dans ton navigateur, directement sur le site, et voit exactement ce que tu vois.
        </p>
      </section>

      <InstallApp />

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="flex items-center gap-3 border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-300" /> {toast}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* --- Méthode 1 : assistant flottant --- */}
        <Card className="relative overflow-hidden p-6">
          <div className="absolute right-0 top-0 rounded-bl-2xl bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">Recommandé</div>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-400 text-emerald-950">
              <MousePointerClick className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-xl font-bold">Assistant flottant</h2>
              <p className="text-sm text-slate-400">Un panneau d&apos;analyse qui s&apos;ouvre par-dessus Bet261</p>
            </div>
          </div>

          <ol className="mt-6">
            <Step n={1} title="Installe le bouton (une seule fois)">
              <p>Glisse ce bouton dans ta barre de favoris :</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {inline && <BookmarkletLink code={inline}>MatchScores · Bet261</BookmarkletLink>}
                <Button
                  variant="ghost"
                  onClick={() => navigator.clipboard.writeText(inline).then(() => setToast("Code du favori copié."))}
                >
                  <Copy className="h-4 w-4" /> Copier le code
                </Button>
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-slate-300">Sur téléphone / autres options</summary>
                <ul className="mt-2 list-disc space-y-1.5 pl-5">
                  <li>
                    <b>Chrome Android</b> : ajoute n&apos;importe quelle page en favori, modifie-le, nomme-le
                    « matchscores » et remplace l&apos;URL par le code copié. Sur Bet261, tape « matchscores » dans la
                    barre d&apos;adresse et choisis le favori.
                  </li>
                  <li>
                    <b>iPhone (Safari)</b> : ajoute cette page en signet, puis Signets → Modifier → remplace
                    l&apos;adresse par le code copié. Sur Bet261, ouvre tes signets et touche « matchscores ».
                  </li>
                  <li>
                    <b>Extension Tampermonkey / Violentmonkey</b> : l&apos;assistant s&apos;affiche automatiquement sur
                    Bet261.{" "}
                    <a className="text-emerald-300 underline" href="/bet261-assistant.user.js" target="_blank">
                      Installer le userscript
                    </a>
                  </li>
                  <li>
                    Favori léger (charge toujours la dernière version) :{" "}
                    {loader && <BookmarkletLink code={loader}>MS léger</BookmarkletLink>}
                  </li>
                </ul>
              </details>
            </Step>
            <Step n={2} title="Ouvre Bet261">
              <Button variant="outline" onClick={() => window.open(BET261, "bet261")}>
                <ExternalLink className="h-4 w-4" /> Ouvrir bet261.mg
              </Button>
              <p className="mt-2">Va sur la liste des matchs (Football, Basket, Tennis…) ou sur la section Virtuels.</p>
            </Step>
            <Step n={3} title="Clique sur le favori « MatchScores »">
              Le panneau flottant apparaît, détecte les matchs et affiche les paris les plus sûrs. Coche « Auto » pour qu&apos;il
              se mette à jour quand la page change.
            </Step>
            <Step n={4} title="Envoie l'analyse ici">
              Clique sur « Envoyer vers l&apos;app » : cette page reçoit les données et t&apos;affiche l&apos;analyse complète
              (combinés, détails par match, virtuels).
            </Step>
          </ol>
        </Card>

        <div className="space-y-6">
          {/* --- Méthode 2 : scraping --- */}
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-cyan-300" />
              <h2 className="font-display text-lg font-bold">Scraping automatique</h2>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Le serveur tente de lire bet261.mg directement. Si le site charge ses cotes en JavaScript ou bloque les
              robots, utilise l&apos;assistant flottant.
            </p>
            <Button className="mt-4" variant="outline" onClick={runScrape} disabled={scrape.loading}>
              {scrape.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Puzzle className="h-4 w-4" />} Lancer le scraping
            </Button>
            {scrape.diagnostics && (
              <ul className={`mt-3 space-y-1 rounded-xl p-3 font-mono text-[11px] ${scrape.ok ? "bg-emerald-400/5 text-emerald-200" : "bg-rose-400/5 text-rose-200"}`}>
                {scrape.diagnostics.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </Card>

          {/* --- Méthode 3 : copier-coller --- */}
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <ClipboardPaste className="h-5 w-5 text-violet-300" />
              <h2 className="font-display text-lg font-bold">Copier-coller</h2>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Sur Bet261 : Ctrl+A puis Ctrl+C (ou « Tout sélectionner » sur mobile), puis colle ici. Accepte aussi le JSON
              copié depuis l&apos;assistant.
            </p>
            <div className="mt-3 inline-flex rounded-xl bg-white/5 p-1 text-sm">
              {(["sports", "virtual"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 ${mode === m ? "bg-white/10 text-white" : "text-slate-400"}`}>
                  {m === "sports" ? "Sports" : "Virtuels"}
                </button>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Colle ici le contenu de la page Bet261…"
              className="mt-3 w-full rounded-xl border border-white/10 bg-ink-900/60 p-3 font-mono text-xs outline-none focus:border-emerald-400/40"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="primary" onClick={importText} disabled={!text.trim()}>
                Analyser le texte
              </Button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10">
                <FileJson className="h-4 w-4" /> Fichier JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      const data = JSON.parse(await f.text());
                      if (isSnapshot(data)) accept({ ...data, source: "file" }, "Fichier importé");
                      else setToast("Ce fichier n'est pas une capture MatchScores.");
                    } catch {
                      setToast("Fichier JSON invalide.");
                    }
                  }}
                />
              </label>
            </div>
          </Card>

          <Card className="flex flex-wrap gap-2 p-4">
            <Button variant="ghost" onClick={() => (loadDemo(), router.push("/"))}>
              <PlayCircle className="h-4 w-4" /> Charger la démo
            </Button>
            {snapshot && (
              <Button variant="ghost" onClick={() => (clear(), setToast("Données effacées."))}>
                <Trash2 className="h-4 w-4" /> Effacer les données
              </Button>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
