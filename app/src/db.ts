import { ensureSources, MatchScoresDB, pruneStorage } from "./core/store";

/** Base locale unique de l'appli. */
export const db = new MatchScoresDB();

export const dbReady = (async () => {
  await ensureSources(db);
  await pruneStorage(db);
})();
