# MatchScores — football virtuel bet261

Appli Android qui **relève les matchs du football virtuel de bet261** (English League : affiches, cotes, résultats,
classement) **depuis ton téléphone**, les enregistre dans une base locale et les affiche avec des statistiques
descriptives.

> Les matchs virtuels sont tirés au sort par un générateur aléatoire : l'historique décrit le passé, il ne prédit pas
> le prochain résultat. L'appli ne place aucun pari. Jeu responsable : mise uniquement ce que tu peux perdre.

## Installer

1. Sur le téléphone, ouvre la dernière release **matchscores-android** :
   <https://github.com/Nicki24/MatchScores/releases/tag/matchscores-android>
2. Télécharge **MatchScores.apk** et installe-le (autorise « sources inconnues » si Android le demande).
   La mise à jour s'installe par-dessus l'ancienne appli MatchScores.
3. Chaque release contient aussi `verification-emulateur.zip` (captures et rapport du test de cet APK sur un
   émulateur Android) et `captures-navigateur.zip`.

## Utiliser

1. Onglet **Collecte** → « Ouvrir bet261 » : le site s'affiche dans l'appli.
2. Va dans **Virtuels → Football → English League** (pas besoin de te connecter).
3. Touche « ← Analyse » : les onglets **Matchs**, **Résultats** et **Classement** se remplissent pendant que la page
   reste ouverte (l'écran reste allumé pendant la collecte).
4. Onglet **Plus → Qualité** : la grille du cahier des charges est calculée sur tes données (voir plus bas).
5. Si aucun match n'apparaît après une minute : **Plus → Réglages → Créer le relevé** et envoie le fichier
   (enregistré dans `Téléchargements/MatchScores`).

La source **Démo** (Réglages) simule une ligue pour découvrir l'appli sans bet261.

## Pourquoi le collecteur tourne sur le téléphone

Le cahier des charges prévoyait un worker sur Railway/Render. Phase 1 (exploration, 19/10/2026) :

- bet261 **bloque tout visiteur hors de Madagascar** (« Accès limité ! Ce site n'est pas disponible dans votre
  pays ! ») ; la plateforme est Sporty-tech (`hg-*-api-prod.sporty-tech.net`) ;
- son `robots.txt` exclut les agents d'IA.

Contourner le blocage (proxy à Madagascar) est interdit par la section 7. Le collecteur est donc l'appli elle-même,
utilisée à Madagascar comme un navigateur ordinaire. Le format exact des réponses de bet261 n'étant visible que
depuis Madagascar, l'adaptateur `normalize_bet261()` utilise pour l'instant l'adaptateur générique, et le **relevé
de diagnostic** sert à écrire la lecture dédiée.

## Architecture (adaptée au téléphone)

```
bet261 (WebView, Madagascar)
   │  script collecteur injecté dans la page et ses iframes :
   │  réponses JSON (fetch/XHR), WebSocket, SSE → méthode C · texte visible → méthode D · relecture → méthode B
   ▼
raw_captures (brut horodaté, 7 jours) ──► adaptateurs normalize_<source>() ──► matches · odds · standings
                                                                          (IndexedDB du téléphone)
                                                                                 ▼
                                                     interface : matchs, cotes, forme, classement, qualité
```

| Cahier des charges | Réalisation |
| --- | --- |
| Tables `sources`, `raw_captures`, `matches`, `odds`, `standings` | Mêmes tables, dans la base locale (IndexedDB) : `app/src/core/store.ts` |
| Contrat d'adaptateur `{ matches, odds, standings }`, upsert sur `(source_id, external_id)` | `app/src/core/normalize/` ; un même match vu par plusieurs méthodes est fusionné (aucun doublon) |
| F1–F4 matchs, cotes horodatées, scores, classement | Collecte continue tant que la page est ouverte ; une ligne de cote par changement et par méthode |
| F5 affichage | Onglets Matchs (détail : cotes, probabilités sans marge, forme, confrontations), Résultats, Classement |
| F6 sources | Réglages → Sources (activer/désactiver) |
| F7 re-normaliser | Réglages → « Re-normaliser les captures brutes » |
| NF1 / NF2 | Méthode B : une requête par adresse toutes les 30 s, 3 essais à délai croissant ; rechargement auto de la page |
| NF3 / NF4 | Plus → Journal (chaque réponse + un cycle par minute) ; alerte et notification après 3 cycles vides |
| NF5 | Aucun secret : pas de clé, pas de serveur |
| NF6 | Interface mobile, données locales |
| Section 4 (note /20) | Plus → Qualité : exactitude (croisée avec l'écran ou 20 matchs cochés), complétude (3 journées), stabilité, fraîcheur, coût, conformité |
| Section 7 | User-Agent honnête (`… MatchScores/2.x`), aucune donnée de compte relevée, aucun pari, rappel aléatoire + jeu responsable |

## Vérifications automatiques (GitHub Actions)

À chaque envoi, `.github/workflows/android.yml` :

1. tests unitaires (adaptateurs sur 3 formats JSON + texte, base sans doublon, re-normalisation, grille /20, relevé) ;
2. tests dans Chromium sur un **site de test** (`tools/mock-site`) qui imite une page de football virtuel livrée de
   4 façons : API JSON, WebSocket, texte seul, iframe d'une autre origine — exactitude contrôlée par rapport à la
   vérité du site ;
3. construction des APK ;
4. **test de l'APK sur un émulateur Android** : l'appli ouvre le site de test dans son collecteur et doit afficher
   exactement les matchs et cotes 1X2 de la journée, les résultats et le classement (captures d'écran à l'appui) ;
5. publication de l'APK uniquement si tout passe.

## Développer

```bash
npm install
npm run mock          # site de test : http://localhost:4173/virtual?mode=api|ws|dom|iframe
npm run dev           # interface : http://localhost:5173 (source « Démo » disponible)
npm test              # tests unitaires
npm run build && npx playwright test   # tests de bout en bout
npm run build:android && (cd android && ./gradlew assembleDebug)
```

`tools/explore/explore.mjs` (Playwright) enregistre ce que charge une page — à lancer **depuis Madagascar** pour
explorer bet261 sur un ordinateur.
