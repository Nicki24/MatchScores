"use client";

import { useEffect, useMemo, useState } from "react";
import { Maximize2, Power, ScanLine, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { snapshotFromText } from "@/lib/snapshot";
import { analyzeMatch, isEligible, type Pick } from "@/lib/analysis/sports";
import { analyzeLeague } from "@/lib/analysis/virtuals";
import type { Snapshot } from "@/lib/types";
import { riskColor, pct } from "@/components/ui";

/**
 * Panneau affiché par la bulle flottante de l'appli Android.
 * L'appli lit le texte de l'écran (service d'accessibilité) et appelle window.msIngest(texte).
 */

interface Capture {
  snap: Snapshot;
  pkg?: string;
  at: Date;
  lines: number;
  virtual: boolean;
}

function Row({ title, sub, label, odds, prob, safety }: { title: string; sub: string; label: string; odds?: number; prob: number; safety: number }) {
  const color = riskColor(safety);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[.04] p-3">
      <div className="truncate text-xs text-slate-400">{sub}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2">
        <div className="min-w-0 truncate font-semibold">{title}</div>
        <div className="shrink-0 font-display font-bold text-emerald-300 tabular-nums">{odds ? odds.toFixed(2) : `≈${(1 / prob).toFixed(2)}`}</div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${Math.max(4, safety)}%`, background: color }} />
      </div>
      <div className="mt-1 text-[11px] text-slate-400">
        {label} · probabilité {pct(prob)} · note {Math.round(safety)}
      </div>
    </div>
  );
}

export default function BubblePanel() {
  const { setSnapshot, settings } = useStore();
  const [capture, setCapture] = useState<Capture | null>(null);

  useEffect(() => {
    const ingest = (text: string, pkg?: string) => {
      const virtual = /virtu/i.test(text);
      let snap = snapshotFromText(text, virtual ? "virtual" : "sports");
      if (virtual && !snap.virtual.length) snap = snapshotFromText(text, "sports");
      snap = { ...snap, source: "assistant", url: pkg };
      if (snap.matches.length || snap.virtual.length) setSnapshot(snap);
      setCapture({ snap, pkg, at: new Date(), lines: text.split("\n").length, virtual: snap.virtual.length > 0 });
    };
    window.msIngest = ingest;
    // Textes envoyés par l'appli avant que la page soit prête
    for (const [text, pkg] of window.__msQueue?.splice(0) ?? []) ingest(text, pkg);
    return () => {
      delete window.msIngest;
    };
  }, [setSnapshot]);

  const sportPicks: Pick[] = useMemo(
    () =>
      (capture?.snap.matches ?? [])
        .map((m) => analyzeMatch(m, settings).best)
        .filter((p): p is Pick => !!p && isEligible(p, settings))
        .sort((a, b) => b.safety - a.safety),
    [capture, settings],
  );
  const virtualAnalyses = useMemo(() => (capture?.snap.virtual[0] ? analyzeLeague(capture.snap.virtual[0], settings.minOdds) : []), [capture, settings]);
  const panel = typeof window !== "undefined" ? window.MatchScoresPanel : undefined;
  const count = (capture?.snap.matches.length ?? 0) + (capture?.snap.virtual[0]?.matches.length ?? 0);

  return (
    <div className="-mx-4 -mt-6 min-h-dvh px-3 pb-6 pt-3 sm:-mx-6">
      <header className="sticky top-0 z-10 -mx-3 mb-3 flex items-center gap-2 border-b border-white/10 bg-ink-950/90 px-3 py-2 backdrop-blur">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-400 text-xs font-extrabold text-emerald-950">MS</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">Analyse de l&apos;écran</div>
          <div className="truncate text-[11px] text-slate-400">
            {capture ? `${count} match(s) · ${capture.at.toLocaleTimeString("fr-FR")}` : "En attente…"}
          </div>
        </div>
        <button onClick={() => panel?.openApp()} className="grid h-8 w-8 place-items-center rounded-lg bg-white/5" aria-label="Analyse complète">
          <Maximize2 className="h-4 w-4" />
        </button>
        <button onClick={() => panel?.stopBubble()} className="grid h-8 w-8 place-items-center rounded-lg bg-white/5" aria-label="Arrêter la bulle">
          <Power className="h-4 w-4" />
        </button>
        <button onClick={() => panel?.close()} className="grid h-8 w-8 place-items-center rounded-lg bg-white/5" aria-label="Fermer">
          <X className="h-4 w-4" />
        </button>
      </header>

      {!capture && (
        <div className="mt-6 text-center text-sm text-slate-400">
          <ScanLine className="mx-auto mb-2 h-8 w-8 text-emerald-300" />
          Ouvre la liste des matchs sur Bet261 puis touche la bulle MS.
        </div>
      )}

      {capture && count === 0 && (
        <div className="rounded-xl border border-dashed border-amber-400/40 bg-amber-400/5 p-3 text-sm text-amber-100">
          Aucun match reconnu ({capture.lines} lignes lues{capture.pkg ? ` dans ${capture.pkg}` : ""}). Ouvre une liste de matchs avec
          leurs cotes (pas l&apos;accueil), puis retouche la bulle.
        </div>
      )}

      {capture && !capture.virtual && sportPicks.length > 0 && (
        <div className="space-y-2">
          {sportPicks.slice(0, 12).map((p) => (
            <Row
              key={p.id}
              title={p.description}
              sub={`${p.match.home} vs ${p.match.away}`}
              label={`Risque ${p.risk}`}
              odds={p.odds}
              prob={p.probability}
              safety={p.safety}
            />
          ))}
        </div>
      )}
      {capture && !capture.virtual && count > 0 && sportPicks.length === 0 && (
        <p className="text-sm text-slate-400">{count} match(s) lus, mais aucun pari dans ta plage de cotes.</p>
      )}

      {capture?.virtual && (
        <div className="space-y-2">
          {virtualAnalyses.slice(0, 10).map((a) =>
            a.best ? (
              <Row
                key={a.match.id}
                title={a.best.description}
                sub={`${a.match.home} vs ${a.match.away} · xG ${a.expectedGoals.join("–")}`}
                label={`Risque ${a.best.risk}`}
                odds={a.best.odds}
                prob={a.best.probability}
                safety={a.best.safety}
              />
            ) : null,
          )}
        </div>
      )}

      {capture && count > 0 && (
        <p className="mt-3 text-center text-[11px] text-slate-500">
          Fais défiler la page Bet261 et retouche la bulle pour ajouter d&apos;autres matchs. Aucun pari n&apos;est garanti.
        </p>
      )}
    </div>
  );
}
