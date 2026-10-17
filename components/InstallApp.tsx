"use client";

import { useEffect, useState } from "react";
import { Download, Share, Smartphone } from "lucide-react";
import { Button, Card } from "./ui";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Installation sur l'écran d'accueil : bouton natif (Android/Chrome) ou instructions (iPhone). */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (window.MatchScoresAndroid) return setInstalled(true); // déjà dans l'appli Android
    setInstalled(matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    addEventListener("beforeinstallprompt", onPrompt);
    addEventListener("appinstalled", onInstalled);
    return () => {
      removeEventListener("beforeinstallprompt", onPrompt);
      removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;
  return (
    <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <Smartphone className="h-6 w-6 shrink-0 text-emerald-300" />
        <div>
          <div className="font-display font-bold">Installer MatchScores sur ton téléphone</div>
          <p className="text-sm text-slate-400">
            {ios ? (
              <>
                Dans Safari : touche <Share className="inline h-4 w-4" /> Partager puis « Sur l&apos;écran d&apos;accueil ».
              </>
            ) : prompt ? (
              "Une icône sera ajoutée à ton écran d'accueil, l'app s'ouvrira en plein écran."
            ) : (
              "Dans Chrome : menu ⋮ puis « Installer l'application » ou « Ajouter à l'écran d'accueil »."
            )}
          </p>
        </div>
      </div>
      {prompt && (
        <Button
          variant="primary"
          onClick={async () => {
            await prompt.prompt();
            if ((await prompt.userChoice).outcome === "accepted") setInstalled(true);
            setPrompt(null);
          }}
        >
          <Download className="h-4 w-4" /> Installer
        </Button>
      )}
    </Card>
  );
}
