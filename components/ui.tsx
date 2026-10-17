"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { RiskLevel } from "@/lib/analysis/sports";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("glass rounded-2xl", className)}>{children}</div>;
}

export function Button({
  variant = "ghost",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "bg-gradient-to-r from-emerald-400 to-cyan-400 text-emerald-950 shadow-lg shadow-emerald-500/20 hover:brightness-110",
        variant === "ghost" && "bg-white/5 text-slate-200 hover:bg-white/10",
        variant === "outline" && "border border-white/15 text-slate-200 hover:bg-white/5",
        className,
      )}
    />
  );
}

export const riskColor = (r: RiskLevel | number) => {
  const level = typeof r === "number" ? (r >= 72 ? "faible" : r >= 58 ? "modéré" : "élevé") : r;
  return level === "faible" ? "#34d399" : level === "modéré" ? "#fbbf24" : "#f87171";
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
      style={{ color: riskColor(risk), background: `${riskColor(risk)}1a` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: riskColor(risk) }} />
      Risque {risk}
    </span>
  );
}

/** Jauge circulaire de sécurité (0-100). */
export function SafetyRing({ value, size = 56 }: { value: number; size?: number }) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = riskColor(value);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-display text-sm font-bold tabular-nums" style={{ color }}>
          {Math.round(value)}
        </span>
      </div>
    </div>
  );
}

/** Barre empilée 1 / X / 2 */
export function OutcomeBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
        {parts.map((p) => (
          <motion.div
            key={p.label}
            initial={{ width: 0 }}
            animate={{ width: `${p.value * 100}%` }}
            transition={{ duration: 0.7 }}
            style={{ background: p.color }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
        {parts.map((p) => (
          <span key={p.label} className="tabular-nums">
            <span style={{ color: p.color }}>●</span> {p.label} {Math.round(p.value * 100)} %
          </span>
        ))}
      </div>
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

export function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
        active ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200" : "border-white/10 text-slate-300 hover:bg-white/5",
      )}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export const pct = (p: number) => `${Math.round(p * 100)} %`;
