import { useLiveQuery } from "dexie-react-hooks";
import { Globe, Radar, TriangleAlert } from "lucide-react";
import { db } from "../db";
import { sendNative, useRuntime } from "../runtime";
import { useSetting, useTick } from "./hooks";
import { ago, Button, Card, Pill, Section, Toggle } from "./kit";

export function CollectPage({ onDemo }: { onDemo: () => void }) {
  const rt = useRuntime();
  useTick(5000);
  const [keepAwake, setKeepAwake] = useSetting("keepAwake", true);
  const [replay, setReplay] = useSetting("replay", false);
  const today = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const stats = useLiveQuery(async () => {
    const cycles = await db.cycles.where("started_at").above(today).toArray();
    const real = cycles.filter((c) => c.kind !== "timer" && c.source_id === "bet261");
    return {
      withData: real.filter((c) => c.matches + c.odds + c.standings > 0).length,
      matches: await db.matches.where("source_id").equals("bet261").count(),
    };
  }, [today]);

  if (!rt.native) {
    return (
      <div>
        <Card className="p-5">
          <div className="flex items-center gap-2 font-bold">
            <Globe className="h-5 w-5 text-cyan-300" /> Collecte bet261
          </div>
          <p className="mt-2 text-sm text-slate-300">
            La collecte fonctionne dans l'appli Android, depuis Madagascar : bet261 n'est pas accessible depuis l'étranger. Dans ce navigateur, tu
            peux découvrir l'appli avec la source « Démo ».
          </p>
          <Button className="mt-4" variant="primary" onClick={onDemo} testId="collect-demo">
            Activer la démo
          </Button>
        </Card>
      </div>
    );
  }

  const open = () => {
    sendNative({ t: "keepAwake", on: keepAwake });
    sendNative({ t: "showCollector", show: true });
  };

  return (
    <div>
      {rt.alert && (
        <div className="mb-4 flex gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {rt.alert}
        </div>
      )}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold">
            <Radar className="h-5 w-5 text-emerald-300" /> Collecte bet261
          </div>
          {rt.lastDataAt && Date.now() - Date.parse(rt.lastDataAt) < 90_000 ? <Pill tone="green">● Données reçues</Pill> : <Pill tone="amber">En attente</Pill>}
        </div>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-300">
          <li>Touche « Ouvrir bet261 » : le site s'affiche dans l'appli.</li>
          <li>Va dans Virtuels → Football → English League. Pas besoin de te connecter.</li>
          <li>Laisse la page ouverte : les matchs, cotes, résultats et le classement sont relevés pendant que tu navigues.</li>
          <li>Touche « ← Analyse » en haut pour revenir aux matchs.</li>
        </ol>
        <Button className="mt-4 w-full" variant="primary" onClick={open} testId="open-collector">
          Ouvrir bet261
        </Button>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-slate-400">
          <div className="rounded-xl bg-white/5 p-2">
            <div className="text-lg font-bold text-slate-100 tabular">{rt.captures}</div>
            réponses reçues
          </div>
          <div className="rounded-xl bg-white/5 p-2">
            <div className="text-lg font-bold text-slate-100 tabular">{stats?.withData ?? 0}</div>
            avec du nouveau
          </div>
          <div className="rounded-xl bg-white/5 p-2">
            <div className="text-lg font-bold text-slate-100 tabular">{stats?.matches ?? 0}</div>
            matchs en base
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Dernière réponse {ago(rt.lastCaptureAt)} · dernière donnée utile {ago(rt.lastDataAt)}
          {rt.collector.url ? ` · page : ${rt.collector.title || rt.collector.url}` : ""}
        </p>
      </Card>

      <Section title="Options">
        <Card className="px-4 py-2">
          <Toggle
            label="Garder l'écran allumé pendant la collecte"
            hint="La collecte s'arrête quand le téléphone se met en veille."
            checked={keepAwake}
            onChange={(v) => {
              setKeepAwake(v);
              sendNative({ t: "keepAwake", on: v });
            }}
          />
          <Toggle
            label="Méthode B : relire les adresses JSON repérées"
            hint="Toutes les 30 s, une requête par adresse (NF1), 3 essais en cas d'échec (NF2). Désactivé par défaut."
            checked={replay}
            onChange={setReplay}
          />
        </Card>
      </Section>
      <p className="px-1 text-xs text-slate-500">
        Si aucun match n'apparaît après une minute sur la page de l'English League, crée un relevé de diagnostic (onglet Plus → Réglages) et
        envoie-le : la lecture sera ajustée au format exact de bet261.
      </p>
    </div>
  );
}
