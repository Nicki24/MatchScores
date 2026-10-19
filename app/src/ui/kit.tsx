import type { ReactNode } from "react";
import type { FormLetter } from "../core/analysis";

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
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-slate-400">{title}</h2>
        {right}
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
export const fmtDateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

export function ago(iso?: string) {
  if (!iso) return "jamais";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `il y a ${Math.max(0, s)} s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  return `il y a ${Math.round(s / 3600)} h`;
}
