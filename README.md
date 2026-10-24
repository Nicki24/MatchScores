# MatchScores — football virtuel bet261

Appli Android qui **relève les matchs du football virtuel de bet261** (English League : affiches, cotes, résultats,
classement) **depuis ton téléphone**, les enregistre dans une base locale, les affiche avec leurs statistiques et
calcule des **pronostics** (issue la plus probable, matchs les moins risqués, scores exacts les plus probables).

> Les matchs virtuels sont tirés au sort par un générateur aléatoire : les pronostics sont des probabilités, jamais
> des certitudes. L'appli ne place aucun pari. Jeu responsable : mise uniquement ce que tu peux perdre.

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
3. Touche « ← Analyse » : les onglets **Matchs** (la liste des matchs à venir : heure, équipes, cotes 1 X 2),
   **Résultats** et **Classement** se remplissent pendant que la page reste ouverte (l'écran reste allumé pendant la
   collecte).
4. Onglet **Pronos** : pour chaque match à venir, qui joue contre qui, qui devrait gagner et avec quelles chances, l'option
   la plus sûre, le score probable ; puis ce qu'ont donné les pronostics de la dernière journée et le bilan (voir plus bas).
5. En haut à droite, **Virtuel / Réel** : bet261 affiche aussi des matchs réels (accueil, Sport, Live), relevés en passant.
   Ils ne sont jamais mélangés aux virtuels : chaque onglet montre la catégorie choisie. Le classement est automatique
   (page ouverte, adresse des données, nom de la ligue, journée) ; une ligue mal classée se corrige dans
   **Plus → Réglages → Ligues**.
6. Onglet **Plus → Qualité** : la grille du cahier des charges est calculée sur tes données (voir plus bas).
7. Si aucun match n'apparaît après une minute : **Plus → Réglages → Créer le relevé** et envoie le fichier
   (enregistré dans `Téléchargements/MatchScores`).
8. Pour repartir de zéro : **Plus → Réglages → Effacer les données collectées** (matchs, cotes, résultats,
   classements, captures et journal ; les réglages et la connexion à bet261 sont gardés). Inutile d'effacer les
   données de l'appli dans les paramètres d'Android.

La source **Démo** (Réglages) simule une ligue pour découvrir l'appli sans bet261.

## Pronostics

Pour des matchs tirés au sort, la meilleure estimation disponible des chances de chaque issue est donnée par les cotes
du site, une fois la marge du bookmaker retirée (`app/src/core/predict.ts`) :

- **pronostic en clair** (« Leeds gagne », « Match nul ») avec ses chances, les chances de chaque équipe et du nul, la
  **double chance** la plus probable (« Leeds ou nul »), le **risque** (probabilité que le pronostic soit faux) et un
  niveau : très probable (≥ 70 %), probable (≥ 55 %), incertain ; dès 30 matchs relevés, le taux de réussite observé de
  ce niveau sur tes données ;
- **les moins risqués** de la journée, et la probabilité que les 3 premiers passent ensemble dans un combiné ;
- **score exact** : cotes du score exact si elles sont relevées, sinon modèle de Poisson (buts de chaque équipe)
  ajusté sur les cotes 1X2 et plus/moins de 2,5 buts ; la carte donne le score le plus probable *qui va avec le
  pronostic* (« 1-0 pour Leeds »), et le plus fréquent s'il diffère ; il dépasse rarement 15 % ;
- **résultat du match seulement** : les marchés qui reprennent les issues 1 / X / 2 sans être le résultat du match
  (mi-temps, mi-temps/fin de match, handicap, totaux d'une équipe…) sont écartés à la lecture. Après une mise à jour
  de cette lecture, l'appli relit une fois d'elle-même les captures conservées (bandeau « Mise à jour des données ») ;
- **matchs à venir seulement** : un match dont le coup d'envoi est passé, ou dont la journée a déjà commencé dans sa
  ligue, n'est plus proposé même si son résultat n'a pas été relevé ;
- **résultats** : sous chaque score, le pronostic d'avant-match et s'il a réussi ; par journée, le nombre de pronostics
  justes ;
- **bilan sur tes données** : pronostics d'avant-match comparés aux résultats (réussite réelle contre réussite
  attendue), et comparaison avec « l'équipe en meilleure forme ».

Rien ne peut prévoir le tirage : à long terme, chaque mise perd en moyenne la marge du bookmaker, quel que soit le
pronostic. Le bilan permet de le vérifier sur les matchs réellement relevés.

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
raw_captures (brut horodaté) ───────────► adaptateurs normalize_<source>() ──► matches · odds · standings
                                                                          (IndexedDB du téléphone)
                                                                                 ▼
                                                     interface : matchs, cotes, forme, classement, qualité
```

| Cahier des charges | Réalisation |
| --- | --- |
| Tables `sources`, `raw_captures`, `matches`, `odds`, `standings` | Mêmes tables, dans la base locale (IndexedDB) : `app/src/core/store.ts`. Pour ménager le téléphone, une capture brute n'est gardée que si sa lecture apporte du nouveau (une page dont seul le compte à rebours change n'est pas ré-enregistrée), les réponses illisibles par échantillons ; 3 jours et 3 000 captures au plus ; matchs, cotes et classements 5 jours |
| Contrat d'adaptateur `{ matches, odds, standings }`, upsert sur `(source_id, external_id)` | `app/src/core/normalize/` ; un même match vu par plusieurs méthodes est fusionné (aucun doublon). Une même affiche revenue à la saison suivante ou le lendemain (même journée, mêmes équipes) est une nouvelle rencontre : elle ne reprend ni le score ni l'heure de l'ancienne. La ligne « Pays - Compétition » que bet261 affiche sous les équipes (« Suède - D1 Suède ») donne la compétition du match, jamais ses équipes (`normalize/competition.ts`) |
| Virtuel / réel | `app/src/core/category.ts` : d'après la page, l'adresse des données, la ligue et la journée ; correction par ligue dans les réglages |
| F1–F4 matchs, cotes horodatées, scores, classement | Collecte continue tant que la page est ouverte ; une ligne de cote par changement et par méthode |
| F5 affichage | Onglets Matchs (détail : cotes, probabilités sans marge, pronostic, forme, confrontations), Pronos, Résultats, Classement |
| F6 sources | Réglages → Sources (activer/désactiver) |
| F7 re-normaliser | Réglages → « Re-normaliser les captures brutes » (ce qui précède les captures conservées reste tel quel) |
| NF1 / NF2 | Méthode B : une requête par adresse toutes les 30 s, 3 essais à délai croissant ; rechargement auto de la page |
| NF3 / NF4 | Plus → Journal (chaque réponse + un cycle par minute) ; alerte et notification après 3 cycles vides |
| NF5 | Aucun secret : pas de clé, pas de serveur |
| NF6 | Interface mobile, données locales |
| Section 4 (note /20) | Plus → Qualité : exactitude (croisée avec l'écran ou 20 matchs cochés), complétude (3 journées), stabilité, fraîcheur, coût, conformité |
| Section 7 | User-Agent honnête (`… MatchScores/2.x`), aucune donnée de compte relevée, aucun pari, rappel aléatoire + jeu responsable |

## Vérifications automatiques (GitHub Actions)

À chaque envoi, `.github/workflows/android.yml` :

1. tests unitaires (adaptateurs sur 3 formats JSON + texte, base sans doublon, re-normalisation, grille /20, relevé,
   pronostics : sur 2 280 matchs simulés, la réussite réelle suit la réussite annoncée) ;
2. tests dans Chromium sur un **site de test** (`tools/mock-site`) qui imite une page de football virtuel livrée de
   4 façons : API JSON, WebSocket, texte seul, iframe d'une autre origine — exactitude contrôlée par rapport à la
   vérité du site ;
3. construction des APK ;
4. **test de l'APK sur un émulateur Android** : l'appli ouvre le site de test dans son collecteur et doit afficher
   exactement les matchs et cotes 1X2 de la journée, les résultats et le classement ; puis la journée suivante quand
   le jeu est servi par une iframe d'une autre origine, puis par le texte affiché seul ; puis les pronostics (issue
   à la cote la plus basse, moins risqués, bilan) ; enfin le relevé de diagnostic doit être enregistré sans aucune
   donnée de compte (captures d'écran et rapport à l'appui) ;
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
