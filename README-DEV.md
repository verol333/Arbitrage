# Guide développeur — Arbitrage

Ce projet détecte des surebets sur le **football uniquement** en scannant 9
bookmakers africains. Chaque bookmaker est un dossier autonome dans
`src/bookmakers/`. Le noyau ne connaît aucun nom de book en dur.

## Architecture (10 secondes)

```
src/
  cli.js                    Point d'entrée (prematch | live)
  config.js                 Toutes les valeurs env
  bookmakers/
    <book>/index.js         Interface commune (voir plus bas)
    <book>/list.js          Liste les matchs
    <book>/parse.js         JSON API → clés d'odds standardisées
    <book>/api.js           Fetch bas niveau (URL, headers)
  core/
    arbitrage.js            compareTwoBooks(oddsA, bookA, oddsB, bookB)
    matching.js             Apparie matchs entre books (Jaro-Winkler)
    markets.js              Aliases (game/point/set/period)
  scanners/collect.js       Orchestrateur (liste, apparie, lit, compare)
  net/fetcher.js            Proxy switchable (Jina/residential/CF worker)
  store/base44.js           Persistance (webhook Base44)
```

Le bundle prod est `arbitrage-service/dist/action.min.js` (ESM minifié
esbuild, ~100 KB). Rebuild : voir « Build » plus bas.

## Ajouter un nouveau bookmaker

Créer un dossier `src/bookmakers/<nom>/` avec un `index.js` exportant :

```js
export default {
  key: 'monbook',                       // identifiant unique interne
  label: 'Mon Book',                    // nom d'affichage (webhook, logs)
  supports: { prematch: true, live: true },

  async listMatches({ live, horizonHours, sport }) {
    if (sport !== 'football') return [];   // garde-fou obligatoire
    return [ /* { id, home, away, league, start } */ ];
  },

  async getOdds(match) {
    return { /* clés d'odds standardisées — voir plus bas */ };
  },

  // Optionnel — si l'API supporte batch (ex: 1win WebSocket)
  async getOddsBatch(matches) {
    return new Map(/* id → oddsObj */);
  },
};
```

Puis l'importer dans `src/bookmakers/index.js` et l'ajouter au tableau
`bookmakers`. Puis rebuild + push. C'est tout : le noyau le prend en compte
automatiquement.

## Le contrat des clés d'odds (crucial)

Chaque parser retourne un objet **plat** dont les clés sont **standardisées**.
Le comparateur `compareTwoBooks` ne matche QUE des paires de clés identiques
entre deux books. Si tu mets `match_home_1` au lieu de `match_1`, ta cote sera
invisible du scanner.

**Familles supportées** (football) :

| Famille           | Clés                                            |
|-------------------|-------------------------------------------------|
| 1X2               | `match_1`, `match_X`, `match_2`                 |
| Double Chance     | `dc_1X`, `dc_12`, `dc_X2`                       |
| DNB               | `dnb_1`, `dnb_2`                                |
| BTTS              | `btts_yes`, `btts_no`                           |
| Total buts        | `match_over_2.5`, `match_under_2.5` (toutes lignes) |
| Team Total        | `tt_home_over_1.5`, `tt_away_under_2.5`, etc.   |
| Handicap Asiatique| `hcp_home_-1.5`, `hcp_away_+1.5` (symétriques)  |
| Pair/Impair       | `odd`, `even`                                   |
| Corners Total     | `cor_over_9.5`, `cor_under_9.5`                 |
| Corners HCP       | `cor_hcp_home_-1.5`, `cor_hcp_away_+1.5`        |
| Corners Pair/Impair | `cor_odd`, `cor_even`                         |
| 1ère mi-temps     | Préfixe `ht_` (`ht_match_1`, `ht_btts_yes`, ...) |
| 2ème mi-temps     | Préfixe `h2_`                                   |
| Mi-temps + de buts | `half_most_ht`, `half_most_h2`, `half_most_equal` |
| 1er marqueur      | `fts_home`, `fts_away`, `fts_none`              |

**Cotes handicap** : la ligne est signée (`hcp_home_-1.5` = équipe à domicile
handicapée de 1.5 but). Le comparateur cherche la paire symétrique
(`hcp_home_L` vs `hcp_away_-L`).

Seules les cotes > 1 sont conservées (filtre implicite dans les helpers).

## Vérifier ce que ton parser expose

```
node scripts/audit-market-keys.js
```

Sort une matrice **book × famille** avec le nombre de matchs (sur 5) qui
exposent chaque famille. Un « · » signifie que le book n'expose rien pour
cette famille — soit c'est normal (l'API ne propose pas), soit le parser
oublie ce marché. À utiliser après chaque modif de parser.

Cet audit tourne aussi sur GH Actions via le workflow **« Audit — Couverture
marchés »**.

## Ajouter un nouveau marché

1. **Standardiser le nom** : choisir une clé selon le tableau ci-dessus.
2. **Étendre tous les parsers concernés** : chaque `src/bookmakers/<book>/parse.js`
   doit émettre la nouvelle clé.
3. **Étendre `compareTwoBooks`** dans `src/core/arbitrage.js` si nécessaire
   (nouveau bloc `pushArb(...)`).
4. **Étendre `marketKeyFromOpp`** dans `src/scanners/collect.js` : reconstruire
   la paire de clés à partir du `market_family` (utilisé au re-fetch).
5. Vérifier avec l'audit couverture, rebuild, push.

## Le pipeline en 8 étapes

Dans `src/scanners/collect.js`, `runScan()` fait dans l'ordre :

1. **Liste** les matchs de chaque book en parallèle
2. **Apparie** les matchs inter-books (Jaro-Winkler + kickoff)
3. **Filtre** ceux qui n'ont pas ≥ 2 books
4. **Lit** les cotes de chaque book en parallèle (batch 25 par défaut)
5. **Sanitize** : retire les clés qui n'appartiennent pas au football
6. **Compare** chaque paire (book_a, book_b) pour chaque match → surebets
7. **Re-fetch** les 2 legs de chaque opp pour confirmer avec cotes fraîches
8. **Envoie** au webhook (Base44 + Slack/Discord)

## Build

```bash
cd arbitrage-service
npx esbuild ../src/cli.js --bundle --minify --platform=node --format=esm \
  --target=node20 --outfile=dist/action.min.js \
  --external:undici --external:playwright --external:got-scraping --external:ws \
  --banner:js='import{createRequire as ___cR}from"module";const require=___cR(import.meta.url);'
```

Le bundle sort à ~101 KB. Il tourne sur `node dist/action.min.js prematch`
ou `... live`.

## GitHub Actions

Workflows utiles :
- `arbitrage-prematch.yml` — cron toutes les 10 min
- `arbitrage-live.yml` — polling live
- `audit-market-coverage.yml` — matrice book × marchés
- `audit-<book>.yml` — audit ciblé d'un book (endpoints, filtres, cotes)
- `probe-betpawa.yml` — sanity check BetPawa
- `debug-match.yml` — inspecte un match précis (utile pour investiguer une opp)

Le fichier `secrets` doit contenir `BASE44_*`, `WEBHOOK_*`, `SCRAPE_DO_KEY`
(actuellement inutilisé côté PB — migré vers Guinée Games), `PROXY_MODE`.

## Bookmakers actuels

| Book       | Endpoint principal                            | Note                              |
|------------|-----------------------------------------------|-----------------------------------|
| 1xbet      | 1xbet.cg (CF workers proxy)                   | mobile v3                          |
| 1win       | 1win.xyz WebSocket top-parser                 | batch odds via WS                  |
| congobet   | congobet.cg REST                              | betTypeId numérique                |
| yellowbet  | yellowbet.cg evapi                            | 4 pages max                        |
| apollo     | apollo.games REST                             | batch getOddsBatch                 |
| betmomo    | betmomo.com SWARM WebSocket                   | type strings                       |
| sportcash  | sportcash.ci XSport                           | codes `cs` numériques              |
| premierbet | **sports-api.guineegames.com** (partage codes) | PB CG bloqué Cloudflare, on utilise GN |
| betpawa    | cg.betpawa.com                                | list = protobuf, odds = /events/{id} JSON |
