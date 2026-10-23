import { useEffect, useState, type ReactNode } from "react";
import { pct, selectionLabel, type FormLetter } from "../core/analysis";
import type { Choice, Confidence, ScoreProbability } from "../core/predict";
import type { MatchRow } from "../core/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div className={cx("card", onClick && "cursor-pointer active:scale-[.99] transition", className)} onClick={onClick}>
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  className,
  disabled,
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[.98] disabled:opacity-40",
        variant === "primary" && "bg-gradient-to-r from-emerald-400 to-cyan-400 text-emerald-950",
        variant === "ghost" && "bg-white/6 text-slate-100 hover:bg-white/10",
        variant === "danger" && "bg-rose-500/15 text-rose-200",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "amber" | "red" | "cyan" }) {
  const tones = {
    slate: "bg-white/8 text-slate-300",
    green: "bg-emerald-400/15 text-emerald-200",
    amber: "bg-amber-400/15 text-amber-200",
    red: "bg-rose-500/15 text-rose-200",
    cyan: "bg-cyan-400/15 text-cyan-200",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", tones[tone])}>{children}</span>;
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-end justify-between gap-2 px-1">
        <h2 className="min-w-0 text-[13px] font-bold uppercase tracking-wider text-slate-400">{title}</h2>
        {right && <div className="shrink-0 whitespace-nowrap">{right}</div>}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="p-5 text-center">
      <div className="font-semibold">{title}</div>
      {children && <div className="mt-2 text-sm text-slate-400">{children}</div>}
    </Card>
  );
}

const FORM_STYLE: Record<FormLetter, string> = { V: "bg-emerald-400 text-emerald-950", N: "bg-slate-400 text-slate-950", D: "bg-rose-400 text-rose-950" };

/** Forme « WWDLW » (anglais) ou « VVNDP » (français) → V / N / D. */
export function formLetters(raw?: string | FormLetter[]): FormLetter[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const s = raw.toUpperCase().replace(/[^WDLVNP]/g, "");
  const english = /[WL]/.test(s);
  return [...s].map((c) => (c === "W" || c === "V" ? "V" : english && c === "D" ? "N" : c === "N" ? "N" : "D"));
}

export function FormChips({ form }: { form?: string | FormLetter[] }) {
  const f = formLetters(form);
  if (!f.length) return <span className="text-xs text-slate-500">—</span>;
  return (
    <span className="inline-flex gap-0.5">
      {f.slice(-5).map((l, i) => (
        <span key={i} className={cx("grid h-3.5 w-3.5 place-items-center rounded-[3px] text-[8px] font-bold", FORM_STYLE[l])}>
          {l}
        </span>
      ))}
    </span>
  );
}

/** Choix entre quelques options (Virtuel / Réel…). */
export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { id: T; label: ReactNode; testId?: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx("flex rounded-xl bg-white/6 p-0.5 text-xs font-semibold", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          data-testid={o.testId}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx("flex items-center justify-center gap-1 rounded-[10px] px-2.5 py-1.5 transition", value === o.id ? "bg-emerald-400 text-emerald-950" : "text-slate-400")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Barre de probabilités (1 / X / 2). */
export function ProbBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-white/8">
      {parts.map((p) => (
        <div key={p.label} style={{ width: `${Math.max(0, p.value) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, testId }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; testId?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
      </span>
      <input data-testid={testId} type="checkbox" className="mt-1 h-5 w-5 accent-emerald-400" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—");

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Heure du coup d'envoi, avec le jour quand ce n'est pas aujourd'hui : « 14:32 », « demain 20:00 », « sam. 25/10 15:00 ». */
export function fmtKickoff(iso?: string, now = Date.now()) {
  if (!iso) return "heure inconnue";
  const d = new Date(iso);
  const days = Math.round((dayStart(d) - dayStart(new Date(now))) / 86400_000);
  const time = fmtTime(iso);
  if (days === 0) return time;
  if (days === 1) return `demain ${time}`;
  if (days === -1) return `hier ${time}`;
  return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" })} ${time}`;
}

/** « dans 1 min 05 s », « dans 12 min », « dans 3 h 05 », « commencé ». */
export function countdown(iso: string, now = Date.now()) {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (s <= 0) return "commencé";
  if (s < 60) return `dans ${s} s`;
  if (s < 600) return `dans ${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
  if (s < 3600) return `dans ${Math.round(s / 60)} min`;
  const m = Math.round(s / 60);
  return `dans ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** Compte à rebours qui se met à jour seul (sans redessiner toute la page). */
export function Countdown({ iso }: { iso: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular">{countdown(iso, now)}</span>;
}
export const fmtDateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

export function ago(iso?: string) {
  if (!iso) return "jamais";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `il y a ${Math.max(0, s)} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
}

const CONFIDENCE_TONE: Record<Confidence, "green" | "cyan" | "amber"> = { "très probable": "green", probable: "cyan", incertain: "amber" };

export function ConfidencePill({ c }: { c: Confidence }) {
  return <Pill tone={CONFIDENCE_TONE[c]}>{c[0].toUpperCase() + c.slice(1)}</Pill>;
}

/** Libellé d'un pronostic : nom de l'équipe, « Nul », « Leeds ou nul »… */
export const choiceLabel = (c: Choice, m: Pick<MatchRow, "home_team" | "away_team">) => selectionLabel(c.market, c.selection, m);
export const scoreLabel = (s: { home: number; away: number }) => `${s.home}-${s.away}`;

/** Le pronostic en une phrase : « Leeds gagne », « Match nul », « Leeds ou nul ». */
export function verdict(c: Choice, m: Pick<MatchRow, "home_team" | "away_team">) {
  if (c.market === "1X2") return c.selection === "1" ? `${m.home_team} gagne` : c.selection === "2" ? `${m.away_team} gagne` : "Match nul";
  return choiceLabel(c, m);
}

/** « 2-1 pour Leeds », « 1-1 », « 0-2 pour Burnley ». */
export function scoreSentence(s: ScoreProbability, m: Pick<MatchRow, "home_team" | "away_team">) {
  if (s.home === s.away) return `${scoreLabel(s)} (nul)`;
  return `${scoreLabel(s)} pour ${s.home > s.away ? m.home_team : m.away_team}`;
}

export const OUTCOME_COLORS = { "1": "#34d399", X: "#94a3b8", "2": "#22d3ee" } as const;

/** Chances de chaque issue, avec le nom des équipes : « Leeds 62 % · Nul 24 % · Burnley 14 % ». */
export function Chances({ m, p }: { m: Pick<MatchRow, "home_team" | "away_team">; p: { "1": number; X: number; "2": number } }) {
  return (
    <div className="mt-2.5">
      <ProbBar
        parts={[
          { label: "1", value: p["1"], color: OUTCOME_COLORS["1"] },
          { label: "X", value: p.X, color: OUTCOME_COLORS.X },
          { label: "2", value: p["2"], color: OUTCOME_COLORS["2"] },
        ]}
      />
      <div className="mt-1 grid grid-cols-[1fr_auto_1fr] gap-2 text-[11px] text-slate-400 tabular">
        <span className="truncate">
          <span style={{ color: OUTCOME_COLORS["1"] }}>●</span> {m.home_team} {pct(p["1"])}
        </span>
        <span>
          <span style={{ color: OUTCOME_COLORS.X }}>●</span> Nul {pct(p.X)}
        </span>
        <span className="truncate text-right">
          {m.away_team} {pct(p["2"])} <span style={{ color: OUTCOME_COLORS["2"] }}>●</span>
        </span>
      </div>
    </div>
  );
}
