"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Snapshot } from "./types";
import { DEFAULT_SETTINGS, type AnalysisSettings } from "./analysis/sports";
import { demoSnapshot } from "./demo";
import { mergeSnapshots } from "./snapshot";

interface State {
  snapshot: Snapshot | null;
  settings: AnalysisSettings;
  onboarded: boolean;
  setSnapshot: (s: Snapshot, merge?: boolean) => void;
  loadDemo: () => void;
  clear: () => void;
  updateSettings: (s: Partial<AnalysisSettings>) => void;
  setOnboarded: (v: boolean) => void;
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      snapshot: null,
      settings: DEFAULT_SETTINGS,
      onboarded: false,
      setSnapshot: (s, merge = true) => set((st) => ({ snapshot: merge ? mergeSnapshots(st.snapshot, s) : s, onboarded: true })),
      loadDemo: () => set({ snapshot: demoSnapshot(), onboarded: true }),
      clear: () => set({ snapshot: null }),
      updateSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
      setOnboarded: (v) => set({ onboarded: v }),
    }),
    { name: "matchscores", version: 1 },
  ),
);
