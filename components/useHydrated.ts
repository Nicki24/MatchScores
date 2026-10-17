"use client";

import { useEffect, useState } from "react";

/** Évite les écarts SSR/client : le store est persisté dans le navigateur. */
export function useHydrated() {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok;
}
