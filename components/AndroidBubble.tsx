"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Download, Layers, Power, ShieldCheck } from "lucide-react";
import { APK_URL, androidApp, androidStatus, type AndroidStatus } from "@/lib/android";
import { Button, Card } from "./ui";

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />}
      <div className="flex-1 text-sm">{children}</div>
    </div>
  );
}

/** Bulle flottante : téléchargement de l'appli Android, ou réglages quand on est dans l'appli. */
export function AndroidBubble() {
  const [inApp, setInApp] = useState(false);
  const [status, setStatus] = useState<AndroidStatus | null>(null);

  useEffect(() => {
    if (!androidApp()) return;
    setInApp(true);
    const refresh = () => setStatus(androidStatus());
    refresh();
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, []);

  const app = androidApp();

  if (!inApp) {
    return (
      <Card className="relative overflow-hidden p-6">
        <div className="absolute right-0 top-0 rounded-bl-2xl bg-cyan-400/15 px-3 py-1 text-xs font-semibold text-cyan-200">Android</div>
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-emerald-400 text-emerald-950">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-xl font-bold">Bulle flottante (appli Android)</h2>
            <p className="text-sm text-slate-400">Une bulle « MS » par-dessus Bet261, comme Hi Translate</p>
          </div>
        </div>
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-slate-300">
          <li>Télécharge et installe l&apos;appli (autorise « sources inconnues » si Android le demande).</li>
          <li>Ouvre MatchScores → Connecter → autorise l&apos;affichage par-dessus les applis, puis « Afficher la bulle » et « Commencer ».</li>
          <li>Ouvre Bet261 (appli ou Chrome) sur une liste de matchs, touche ou dépose la bulle : l&apos;analyse s&apos;affiche.</li>
        </ol>
        <a href={APK_URL} className="mt-5 inline-block">
          <Button variant="primary">
            <Download className="h-4 w-4" /> Télécharger l&apos;APK
          </Button>
        </a>
        <p className="mt-2 text-xs text-slate-500">Fichier construit automatiquement depuis ton dépôt GitHub (Releases).</p>
      </Card>
    );
  }

  const s: AndroidStatus = status ?? { overlay: false, accessibility: false, bubble: false, capture: false, version: "?" };
  return (
    <Card className="relative overflow-hidden p-6">
      <div className="absolute right-0 top-0 rounded-bl-2xl bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">Appli v{s.version}</div>
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-emerald-400 text-emerald-950">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-display text-xl font-bold">Bulle flottante</h2>
          <p className="text-sm text-slate-400">Active-la une fois, elle reste disponible par-dessus Bet261</p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <Check ok={s.overlay}>
          <div className="font-semibold">Affichage par-dessus les autres applis</div>
          {!s.overlay && (
            <Button className="mt-2" variant="outline" onClick={() => app?.requestOverlay()}>
              Autoriser
            </Button>
          )}
        </Check>
        <Check ok={s.bubble}>
          <div className="font-semibold">Bulle affichée</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {s.bubble ? (
              <Button variant="outline" onClick={() => app?.stopBubble()}>
                <Power className="h-4 w-4" /> Arrêter la bulle
              </Button>
            ) : (
              <Button variant="primary" disabled={!s.overlay} onClick={() => app?.startBubble()}>
                <Layers className="h-4 w-4" /> Afficher la bulle
              </Button>
            )}
            <Button variant="ghost" onClick={() => app?.openUrl("https://bet261.mg")}>
              Ouvrir Bet261
            </Button>
          </div>
        </Check>
        <Check ok={!!s.capture || s.accessibility}>
          <div className="font-semibold">Lecture de l&apos;écran</div>
          <p className="mt-1 text-slate-400">
            {s.capture
              ? "Capture d'écran active : la bulle lit les matchs affichés."
              : "Au démarrage de la bulle, Android demande l'autorisation de capture : choisis « Tout l'écran » puis « Commencer »."}
          </p>
          {s.bubble && !s.capture && (
            <Button className="mt-2" variant="outline" onClick={() => app?.requestCaptureAgain?.()}>
              Autoriser la capture
            </Button>
          )}
        </Check>
        <details className="text-sm text-slate-400">
          <summary className="cursor-pointer text-slate-300">
            Option avancée : accessibilité {s.accessibility ? "(activée ✓)" : "(facultatif)"}
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              Plus précis (lit aussi les matchs hors de l&apos;écran). Paramètres → Accessibilité → Applications téléchargées →{" "}
              <b className="text-slate-200">MatchScores — lecture des cotes</b>.
            </p>
            <p className="text-xs">
              Message « Paramètres restreints » ? Infos de l&apos;appli → menu ⋮ en haut à droite → « Autoriser les paramètres
              restreints », puis recommence. Sans cette option, la capture d&apos;écran suffit.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => app?.openAccessibility()}>
                <ShieldCheck className="h-4 w-4" /> Accessibilité
              </Button>
              <Button variant="ghost" onClick={() => app?.openAppInfo()}>
                Infos de l&apos;appli
              </Button>
            </div>
          </div>
        </details>
      </div>
      <p className="mt-5 text-xs text-slate-500">
        Sur Bet261, ouvre une liste de matchs (ou les Virtuels) puis touche la bulle, ou déplace-la et relâche-la sur l&apos;écran : le
        panneau d&apos;analyse s&apos;ouvre. Fais défiler et retouche pour ajouter des matchs.
      </p>
    </Card>
  );
}
