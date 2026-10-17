"use client";

/** Ponts JavaScript exposés par l'application Android (android/). */
export interface AndroidAppBridge {
  status(): string;
  requestOverlay(): void;
  openAccessibility(): void;
  openAppInfo(): void;
  startBubble(): void;
  stopBubble(): void;
  openUrl(url: string): void;
}

export interface AndroidPanelBridge {
  close(): void;
  openApp(): void;
  stopBubble(): void;
}

export interface AndroidStatus {
  overlay: boolean;
  accessibility: boolean;
  bubble: boolean;
  version: string;
}

declare global {
  interface Window {
    MatchScoresAndroid?: AndroidAppBridge;
    MatchScoresPanel?: AndroidPanelBridge;
    msIngest?: (text: string, pkg?: string) => void;
    __msQueue?: [string, string | undefined][];
  }
}

export const androidApp = () => (typeof window !== "undefined" ? window.MatchScoresAndroid : undefined);

export function androidStatus(): AndroidStatus | null {
  try {
    const s = androidApp()?.status();
    return s ? (JSON.parse(s) as AndroidStatus) : null;
  } catch {
    return null;
  }
}

export const APK_URL = "https://github.com/Nicki24/MatchScores/releases/download/android-latest/MatchScores.apk";
