# arbitrage-service

Service Node.js autonome de scan d'arbitrage sportif (surebets) — extrait du
système AL VE CAPITAL construit sur Base44 et porté fidèlement vers Node.js pur
pour déploiement sur Render.

Deux boucles indépendantes tournent en permanence :

- **Prématch** — toutes les 5 min, tous les matchs à venir sur les 72 h suivantes.
- **Live** — toutes les 15 s, tous les matchs en direct (le live n'est jamais
  bloqué par un scan prématch lent).

Bookmakers intégrés (10) : 1xbet, 1win, Congobet, YellowBet, Apollo Games,
BetMomo, PremierBet, BetPawa, SportyBet, Casongo.

Sports : football, tennis, basket, hockey (glace).

Marchés comparés : 1X2, Double Chance, BTTS, Totaux 0.5/1.5/2.5/3.5 (demi-lignes
uniquement), Handicaps, Mi-temps, DNB, Pair/Impair, 1ère équipe à marquer,
Mi-temps la plus prolifique, Corners.

## Architecture

```
arbitrage-service/
├── src/
│   ├── config.js
│   ├── net/
│   │   ├── fetcher.js       ← couche unique proxy (jina | residential | headless)
│   │   ├── headless.js      ← hook Playwright optionnel
│   │   └── limiter.js       ← sémaphore + cache TTL
│   ├── bookmakers/
│   │   ├── index.js         ← registre central (une ligne = un bookmaker)
│   │   ├── xbet/            ← chaque book = 1 dossier autonome
│   │   ├── onewin/            (list.js + odds.js + parse.js + index.js)
│   │   ├── congobet/
│   │   ├── yellowbet/
│   │   ├── apollo/
│   │   ├── betmomo/
│   │   ├── sportcash/
│   │   └── premierbet/
│   ├── core/
│   │   ├── text.js          ← normalisation + fuzzy matching équipes
│   │   ├── matching.js      ← appariement matchs + orientation dom/ext
│   │   ├── markets.js       ← vocabulaire standard des clés + demi-lignes
│   │   └── arbitrage.js     ← pushArb, pushArb3, compareTwoBooks, dedup
│   ├── scanners/
│   │   ├── collect.js       ← orchestrateur agnostique du registre
│   │   ├── prematch.js
│   │   ├── live.js
│   │   └── state.js
│   ├── store/
│   │   └── base44.js        ← persistance ArbitrageOpportunity (optionnelle)
│   ├── server/
│   │   ├── index.js
│   │   ├── routes.js
│   │   └── auth.js
│   └── cron/
│       └── schedule.js
├── .env.example
├── render.yaml
└── package.json
```

## Interface commune d'un bookmaker

Chaque dossier `src/bookmakers/<key>/` exporte par défaut :

```js
export default {
  key: 'monbook',
  label: 'Mon Book',
  supports: { prematch: true, live: true },
  async listMatches({ live, horizonHours }) {
    // → [{ id, home, away, league, start, __raw? }]
  },
  async getOdds(match, { live }) {
    // → { match_1: 2.05, match_X: 3.2, ..., ht_over_1.5: 1.4, ... }
  },
  // Optionnel : batch (WebSocket 1win, offers Apollo…)
  async getOddsBatch(matches, { live }) {
    // → Map<matchId, { marketKey: odd }>
  },
};
```

Le moteur d'arbitrage ne connaît que ces méthodes — il ignore tout des noms de
bookmakers en dur. Ajouter, retirer ou remplacer un bookmaker n'affecte jamais
le reste du système.

## Variables d'environnement

Voir `.env.example`. À définir dans l'onglet **Environment** de Render :

| Variable | Rôle |
|---|---|
| `PORT` | Port HTTP (Render impose 10000 par défaut) |
| `API_SECRET_KEY` | Secret exigé dans `x-api-secret` sur toutes les routes sauf `/health` |
| `PROXY_MODE` | `jina` (défaut), `residential` ou `headless` |
| `JINA_API_KEY` | Clé Jina Reader (si `PROXY_MODE=jina`) |
| `RESIDENTIAL_PROXY_URL` | URL du proxy résidentiel (si `PROXY_MODE=residential`) |
| `BASE44_API_URL` / `BASE44_SERVICE_KEY` | Persistance des opportunités dans Base44 (facultatif) |
| `MIN_PROFIT_PREMATCH` / `MIN_PROFIT_LIVE` | Seuils de profit (%) |
| `MAX_MATCHES` | Cap dur sur le nombre de matchs analysés par scan |
| `HORIZON_HOURS` | Fenêtre prématch (défaut 72 h) |
| `CRON_PREMATCH` | Expression cron du scan prématch (défaut `*/5 * * * *`) |
| `LIVE_INTERVAL_MS` | Intervalle du scan live en ms (défaut 15 000) |

## Endpoints HTTP

- `GET /health` — public. `{ status, uptime_s, last_prematch_scan, last_live_scan,
  last_prematch_count, last_live_count, bookmakers[] }`. Sert de ping anti-veille Render.
- `GET /scan/prematch` — force un scan prématch manuel. Query : `horizon_hours`,
  `min_profit`, `max_matches`.
- `GET /scan/live` — force un scan live manuel.
- `GET /opportunities?live=1&limit=100` — dernières opportunités en mémoire.

Toutes les routes sauf `/health` exigent le header `x-api-secret: <API_SECRET_KEY>`.

## Déploiement Render (procédure complète)

1. **Pousser ce dépôt sur GitHub.**
2. Sur [Render](https://dashboard.render.com/), *New → Web Service*.
3. Connecter le dépôt GitHub `verol333/arbitrage`.
4. Render détecte `render.yaml` et propose la configuration. Sinon :
   - **Runtime** : Node
   - **Build command** : `npm install`
   - **Start command** : `node src/server/index.js`
   - **Health check path** : `/health`
   - **Instance type** : Starter (largement suffisant, upgradable si besoin).
5. Onglet **Environment** → ajouter TOUTES les variables listées ci-dessus.
   Ne PAS mettre de valeurs sensibles dans le repo — Render les injecte au boot.
6. *Create Web Service*. Le premier build prend ~2 min.
7. Une fois « Live », tester : `curl https://<votre-service>.onrender.com/health`.

**Ping anti-veille Render.** Le plan Starter met le service en veille après 15 min
d'inactivité. Un pinger externe (UptimeRobot, cron-job.org, GitHub Actions) qui
appelle `/health` toutes les 10 min garde le service chaud. Le scan prématch
tourne aussi toutes les 5 min et déclenche déjà des logs, ce qui suffit
généralement à empêcher la veille — le health check Render intégré s'en charge.

**Proxy headless.** Si `PROXY_MODE=headless`, l'image Node standard de Render
n'inclut pas Chromium. Options :
- Utiliser un service tiers de rendu (Browserless, ScrapingBee) et adapter
  `src/net/headless.js`.
- Basculer sur un déploiement Docker avec Chromium préinstallé — voir la doc
  Playwright pour un Dockerfile compatible Render.

## Ajouter un nouveau bookmaker

Objectif : zéro impact sur les autres bookmakers ni sur le moteur.

1. Créer un dossier `src/bookmakers/<nouveaubook>/` avec, au minimum :
   - `api.js` — constantes réseau, helpers spécifiques.
   - `list.js` — export de `listPrematch()` et éventuellement `listLive()`.
   - `parse.js` — transforme la réponse brute en cotes plates au format standard
     (voir `src/core/markets.js` pour le vocabulaire).
   - `index.js` — exporte l'objet contrat commun (`key`, `label`, `supports`,
     `listMatches`, `getOdds`, éventuellement `getOddsBatch`).
2. Ajouter UNE LIGNE dans `src/bookmakers/index.js` :
   ```js
   import nouveaubook from './nouveaubook/index.js';
   export const bookmakers = [xbet, onewin, /* … */, nouveaubook];
   ```
3. Vérifier que les clés de cotes produites (`match_1`, `dc_1X`, `match_over_2.5`,
   `hcp_home_-0.5`, `tt_home_over_1.5`, `ht_match_1`, `cor_over_9.5`, `odd`,
   `even`, `fts_home`, etc.) respectent le vocabulaire de `src/core/markets.js`.
   Sinon ajouter un alias dans `normalizeAliases()` — pas dans le moteur.

Contraintes durables :

- **Rester sous ~150 lignes par fichier** — coupez en `list.js` / `odds.js` /
  `parse.js` / `api.js` séparés si nécessaire.
- **N'importer AUCUN autre bookmaker** — chaque dossier est autonome.
- **Isoler les erreurs** — `runScan` catche déjà `listMatches` et `getOdds` par
  bookmaker ; ne pas ré-throw depuis l'interface publique.
- **Passer par `src/net/fetcher.js`** pour tout accès protégé par Cloudflare
  (`proxyFetchJson` / `proxyFetchText`). Pour les APIs publiques directes, `fetchJson`.

## Garde-fous conservés (identiques à Base44)

- Cote > 80 → rejetée (cotes gelées/corrompues).
- Profit > 40 % → rejeté (systématiquement une cote périmée).
- Demi-lignes uniquement pour totaux et handicaps comparés.
- Orientation dom/ext obligatoire à `same` pour tout appariement.
- Fenêtre temporelle STRICTE de ±35 min quand les deux heures sont connues.
- Déduplication neutre sur l'ordre A/B (jambes exactes `book:label`).

## Lancer en local

```bash
cp .env.example .env
# éditer .env — au minimum API_SECRET_KEY
npm install
npm start
```

Puis :

```bash
curl http://localhost:10000/health
curl -H "x-api-secret: <API_SECRET_KEY>" http://localhost:10000/scan/prematch
curl -H "x-api-secret: <API_SECRET_KEY>" http://localhost:10000/opportunities
```
