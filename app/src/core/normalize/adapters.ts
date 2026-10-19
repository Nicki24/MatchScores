/**
 * Registre des adaptateurs normalize_<source>() (cahier des charges, section 5).
 * Ajouter un site = écrire son adaptateur ici, sans toucher au reste.
 */
import type { Adapter, NormalizedBatch, RawCapture } from "../types";
import { normalizeJsonText } from "./json";
import { normalizeText } from "./text";

/** Adaptateur générique : JSON (méthodes B et C) ou texte de la page (méthode D). */
export const normalize_generic: Adapter = (c: RawCapture): NormalizedBatch =>
  c.kind === "dom" ? normalizeText(c.payload, c.captured_at) : normalizeJsonText(c.payload, c.captured_at);

/**
 * bet261 (plateforme Sporty-tech). Le format exact des réponses n'est visible que
 * depuis Madagascar : l'adaptateur générique est utilisé tant que le relevé de
 * diagnostic n'a pas permis d'écrire une lecture dédiée.
 */
export const normalize_bet261: Adapter = (c) => normalize_generic(c);

export const ADAPTERS: Record<string, Adapter> = {
  bet261: normalize_bet261,
  demo: normalize_generic,
};

export function adapterFor(sourceId: string): Adapter {
  return ADAPTERS[sourceId] ?? normalize_generic;
}
