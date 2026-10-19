import { ensureSources, MatchScoresDB, pruneRawCaptures } from "./core/store";

/** Base locale unique de l'appli. */
export const db = new MatchScoresDB();

export const dbReady = (async () => {
  await ensureSources(db);
  await pruneRawCaptures(db, 7);
})();
