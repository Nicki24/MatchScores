# MatchScores — conseils de paris Bet261

Application web (Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Framer Motion · Zustand) qui récupère les
matchs de [bet261.mg](https://bet261.mg) — **football, basket, tennis, volley, handball… et virtuels** — et classe les
paris du plus sûr au plus risqué.

> Aucun pari n'est sans risque. L'outil estime des probabilités à partir des cotes : il réduit les mauvais choix, il ne
> garantit aucun gain.

## Appli Android : bulle flottante

Le dossier `android/` contient une appli Kotlin (sans dépendance externe) :

- une **bulle « MS »** affichée par-dessus les autres applis (comme Hi Translate) ;
- toucher la bulle, ou la déplacer puis la relâcher, **lit le texte de l'écran** (service d'accessibilité) :
  liste des matchs Bet261 dans l'appli ou dans Chrome ;
- un **panneau** (page `/bulle` de l'app web) affiche les paris les plus sûrs ; « Analyse complète » ouvre l'app.

GitHub Actions (`.github/workflows/android.yml`) construit l'APK à chaque modification de `android/` et le publie dans la
release `android-latest` :
[MatchScores.apk](https://github.com/Nicki24/MatchScores/releases/download/android-latest/MatchScores.apk).

## Récupération des données : 4 méthodes

| Méthode | Comment | Fiabilité |
| --- | --- | --- |
| **Assistant flottant** (recommandé) | Favori (bookmarklet) ou userscript qui ouvre un panneau par-dessus Bet261, lit les cotes affichées et les renvoie à l'app | ⭐⭐⭐ voit exactement ce que tu vois |
| Bulle Android | Lit l'écran de Bet261 (appli ou Chrome) quand on touche la bulle | ⭐⭐⭐ |
| Scraping serveur | `GET /api/scrape` lit bet261.mg, analyse ses scripts pour trouver ses API internes et les interroge (`?debug` pour le rapport complet) | ⭐ dépend de l'ouverture des API |
| Copier-coller / JSON | Ctrl+A / Ctrl+C sur la page Bet261, collé dans l'app | ⭐⭐ |

Au premier lancement, l'app propose d'ouvrir l'assistant flottant (page **Connecter Bet261**).

### Assistant flottant

1. Page *Connecter Bet261* → glisser le bouton **MatchScores · Bet261** dans la barre de favoris
   (ou installer le userscript `/bet261-assistant.user.js` avec Tampermonkey / Violentmonkey).
2. Ouvrir bet261.mg, aller sur une liste de matchs ou sur *Virtuels*.
3. Cliquer sur le favori : le panneau détecte les matchs (DOM + réponses JSON interceptées), affiche les paris les plus
   sûrs. « Auto » relance l'analyse quand la page change.
4. « Envoyer vers l'app » transmet les données (compressées dans l'URL ou via `postMessage`).

L'extraction ne dépend pas des classes CSS du site : elle repère les cotes (`1.85`, `3,40`…) puis remonte jusqu'à la
ligne de match qui contient deux noms d'équipes. Elle s'adapte donc aux changements de mise en page.

## Analyse

**Sports** (`lib/analysis/sports.ts`)
- Probabilités « justes » : on retire la marge du bookmaker de chaque marché (1X2, vainqueur, double chance, plus/moins,
  les deux marquent).
- Note de sécurité 0-100 = probabilité − pénalités (marge élevée, risque de nul en football/handball, match en direct).
- Double chance estimée quand le site ne l'affiche pas (signalée par `*`).
- Filtres de cotes min/max, combinés *Prudent / Équilibré / Ambitieux* avec probabilité que tout passe.

**Virtuels** (`lib/analysis/virtuals.ts`)
- Classement, forme (5 derniers), buts pour/contre, résultats passés (classement recalculé si besoin).
- Modèle de Poisson → buts attendus, 1X2, +1.5 / +2.5 / −3.5, les deux marquent, score probable.
- Mélange modèle / cotes : le modèle pèse 10 à 45 % selon le nombre de matchs joués, car les virtuels sont tirés au
  sort par un générateur aléatoire et les cotes intègrent déjà la force des équipes.

**IA ?** Pas nécessaire : tout le calcul est statistique et s'exécute dans le navigateur. Une IA pourrait éventuellement
rédiger des commentaires, mais n'améliorerait pas les probabilités.

## Développement

```bash
npm install
npm run dev          # http://localhost:3000 (construit aussi l'assistant)
npm test             # tests du moteur d'analyse et des extracteurs
npm run build
```

Scraping avec un vrai navigateur, sur ton ordinateur :

```bash
npm i -D playwright && npx playwright install chromium
npm run scrape:local -- https://bet261.mg/ https://bet261.mg/virtuels   # → snapshot.json à importer dans l'app
```

Variables d'environnement (optionnelles) :

- `BET261_BASE_URL` — URL lue par `/api/scrape` (défaut `https://bet261.mg`)
- `BET261_API_URLS` — endpoints JSON supplémentaires repérés dans l'onglet Réseau du navigateur, séparés par des virgules
- `NEXT_PUBLIC_APP_URL` — URL publique de l'app intégrée au script de l'assistant

## Déploiement

Compatible Vercel sans configuration (`npm run build`).

## Structure

```
app/                 pages (Sports, Virtuels, Connecter) + API /api/scrape + userscript
assistant/           panneau flottant injecté sur bet261.mg (bundle esbuild)
components/          interface
lib/analysis/        moteur de probabilités (sports, virtuels, Poisson)
lib/extract/         extracteurs DOM / JSON / texte
scripts/             build de l'assistant, scraping Playwright local
tests/               tests (node:test)
```
