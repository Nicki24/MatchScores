import { CalendarClock, ListOrdered, MoreHorizontal, Radar, Trophy } from "lucide-react";
import { useState } from "react";
import { db } from "../db";
import { setDemo, useRuntime } from "../runtime";
import { setSetting } from "../core/store";
import { CollectPage } from "./CollectPage";
import { useViewSource } from "./hooks";
import { cx, Pill } from "./kit";
import { MatchDetail, MatchesPage, ResultsPage, StandingsPage } from "./MatchesPages";
import { JournalPage, QualityPage, SettingsPage } from "./MorePages";

type Tab = "matches" | "results" | "standings" | "collect" | "more";
type More = "quality" | "journal" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Trophy }[] = [
  { id: "matches", label: "Matchs", icon: CalendarClock },
  { id: "results", label: "Résultats", icon: ListOrdered },
  { id: "standings", label: "Classement", icon: Trophy },
  { id: "collect", label: "Collecte", icon: Radar },
  { id: "more", label: "Plus", icon: MoreHorizontal },
];

export function App() {
  const [tab, setTab] = useState<Tab>("matches");
  const [more, setMore] = useState<More>("quality");
  const [detail, setDetail] = useState<string>();
  const [source] = useViewSource();
  const rt = useRuntime();

  const startDemo = async () => {
    await db.sources.update("demo", { enabled: true });
    await setDemo(true);
    await setSetting(db, "viewSource", "demo");
    setTab("matches");
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-400 text-xs font-black text-emerald-950">MS</span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold leading-tight">MatchScores</div>
          <div className="text-[11px] text-slate-500">Football virtuel · source : {source === "demo" ? "démo (simulée)" : source}</div>
        </div>
        {rt.demoRunning && <Pill tone="amber">Démo</Pill>}
        {rt.alert && <Pill tone="red">Alerte</Pill>}
      </header>

      <main className="flex-1 overflow-y-auto px-3 pb-24 pt-4">
        <div className="mx-auto max-w-xl">
          {tab === "matches" && <MatchesPage onOpen={setDetail} onCollect={() => setTab("collect")} onDemo={startDemo} />}
          {tab === "results" && <ResultsPage onOpen={setDetail} />}
          {tab === "standings" && <StandingsPage />}
          {tab === "collect" && <CollectPage onDemo={startDemo} />}
          {tab === "more" && (
            <div>
              <div className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-white/5 p-1 text-sm">
                {(
                  [
                    ["quality", "Qualité"],
                    ["journal", "Journal"],
                    ["settings", "Réglages"],
                  ] as [More, string][]
                ).map(([id, label]) => (
                  <button key={id} data-testid={`more-${id}`} onClick={() => setMore(id)} className={cx("rounded-lg py-2 font-semibold", more === id ? "bg-white/10 text-white" : "text-slate-400")}>
                    {label}
                  </button>
                ))}
              </div>
              {more === "quality" && <QualityPage />}
              {more === "journal" && <JournalPage />}
              {more === "settings" && <SettingsPage />}
            </div>
          )}
        </div>
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-ink-950/95 backdrop-blur">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} data-testid={`tab-${id}`} onClick={() => setTab(id)} className={cx("flex flex-col items-center gap-0.5 py-2.5 text-[11px]", tab === id ? "text-emerald-300" : "text-slate-500")}>
              <Icon className="h-5 w-5" />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {detail && <MatchDetail matchKey={detail} onClose={() => setDetail(undefined)} />}
      {rt.toast && <div className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-xl bg-slate-100 px-4 py-3 text-center text-sm font-medium text-slate-900 shadow-xl">{rt.toast}</div>}
    </div>
  );
}
