# Génération de codes coupons — recherche archivée

Ce document archive les résultats de l'exploration menée pour générer des codes
coupons/booking numbers automatiquement depuis le service GitHub Actions sur les
9 bookmakers du scanner. Le pipeline **n'est PAS actif en prod** — cette page
existe pour référence si on veut reprendre le sujet.

## Résumé

| Book | Endpoint | Marche depuis GitHub Actions ? | Notes |
|---|---|---|---|
| **CongoBet** | `POST hg-betting-api-prod.sporty-tech.net/api/betting/get-my-code` | ✅ OUI | Endpoint public, réponse `{code:"504126"}` |
| Megapari / 1xBet | `POST megapari.africa/service-api/LiveBet/Open/SaveCoupon` | ✅ (via workers CF) | Voir `base44/functions/megapariCoupon` — nécessite les Cloudflare Workers privés |
| SportyBet | `POST sportybet.com/api/ng/orders/share` | ❌ HTTP 400 `Invalid` | Body simple `[{eventId, marketId, outcomeId}]` mais rejette |
| BetPawa | `POST cg.betpawa.com/api/sportsbook/v3/booking-number` | ❌ HTTP 400 `BAD_REQUEST` | Body `{selections:{selections:[{type:"COMBO",selections:[NUM_IDS]}]}}` |
| YellowBet | `POST yellowbet.cg/services/clapi/api/Bet/placebetsport` `isBooking:true` | ❌ HTTP 403 (Cloudflare) | Body complet avec `selectionKeys` |
| BetMomo | `POST winners.bcapps.org/image-creator/share-booking/` | ❌ Pas de match trouvé via SWARM | Endpoint HTTP direct au lieu du SWARM WS |
| 1win | `POST api-gateway.top-parser.com/shared-bets/create` | ❌ Impossible d'obtenir `oddId` sans WS auth | Body `{coupons:[{oddId:"10:UNIQUEID:1", matchId:NUM}]}` |
| Apollo | Non documenté | — | À investiguer via F12 |
| PremierBet | Probablement même schéma que 1xBet | — | À investiguer |

**Verdict** : sur 7 books testés, **seul CongoBet fonctionne** depuis un runner
GitHub Actions. Les 6 autres rejettent nos requêtes malgré des payloads
identiques à ceux capturés en F12 sur le navigateur du user. Cause probable :
validation côté serveur du fingerprint TLS + cookies session (`__cf_bm`,
`_ga`, `sb_country`, `bp_country`, `x-device-fingerprint`, headers `sec-ch-ua-*`)
qui n'existent pas depuis un IP datacenter Azure sans navigateur réel.

**Pour reprendre le sujet plus tard**, deux voies viables :

1. **Base44 côté backend** : refaire le pattern `megapariCoupon` (Deno Deploy +
   workers CF privés) pour chacun des 6 books. Le user a déjà des scripts prod
   Base44 pour Megapari/1xBet qui marchent.
2. **Playwright headless** dans un runner : lance un vrai Chromium avec les
   cookies pré-chargés, clique le bouton "Partager", récupère le code. Lent
   (10-30s par code) mais contourne le fingerprint.

## Endpoints détaillés (F12 confirmés par user)

### CongoBet ✅ (marche)

```
POST https://hg-betting-api-prod.sporty-tech.net/api/betting/get-my-code
Content-Type: application/json
Origin: https://www.congobet.net
Referer: https://www.congobet.net/sports

{
  "totalOdds": 2.34,
  "eventBetTypeItemIds": [10375080979],
  "betCategory": "SportsFixedOdds",
  "betSystemType": "Simple",
  "drawGameSelections": [],
  "manualOddsBoostIds": [],
  "oddsBoostIds": [],
  "maxPayout": 300,
  "stakePerLine": [50],
  "totalStake": 50,
  "hasBetBuilderBetLines": false
}

→ { "code": "898643" }
```

Pour obtenir `eventBetTypeItemIds` : fetch `/api/events/{eventId}` et lire
`eventBetTypes[].eventBetTypeItems[].id`.

### SportyBet

```
POST https://www.sportybet.com/api/ng/orders/share
Content-Type: application/json;charset=UTF-8
clientid: web
operid: 2
platform: web
Cookie: locale=en; device-id=<UUID>; sb_country=ng

[{ "eventId": "sr:match:72115554", "marketId": "1", "outcomeId": "1" }]

→ { "bizCode": 10000, "data": { "shareCode": "U99NS9", "shareURL": "..." } }
```

### BetPawa

```
POST https://cg.betpawa.com/api/sportsbook/v3/booking-number
x-pawa-brand: betpawa-congobrazzaville
x-pawa-language: fr

{
  "selections": {
    "selections": [{
      "type": "COMBO",
      "selections": [1493437870, 1493438520, 1493437993]
    }]
  }
}

→ { "code": "X98DSPC" }
```

Les IDs numériques viennent de `market.row[].prices[].id` (converti en Number).

### YellowBet

```
POST https://yellowbet.cg/services/clapi/api/Bet/placebetsport
brandid: 122
channelid: 4
language: fr
terminal: yellowbet.cg

{
  "language": "fr",
  "acceptOddsChanges": true,
  "isBooking": true,
  "bonusIds": [],
  "BetBuilderModel": { "BetBuilderEvents": [] },
  "rows": [{ "amount": 0, "selectionKeys": ["E372202950B310310O1"] }],
  "selections": [{
    "key": "E372202950B310310O1",
    "eventId": 372202950,
    "eventStatus": 0,
    "homeName": "Club Brugge",
    "awayName": "KV Kortrijk",
    "betStatus": 0,
    "betTypeId": 310310,
    "betTypeName": "FT 1X2",
    "gameTime": "2026-08-07T18:45:00Z",
    "hasTCO": true,
    "isLive": false,
    "isVirtual": false,
    "oddDisplayName": "1",
    "oddKey": "1",
    "oddName": "1",
    "oddPrice": 1.19,
    "oldOddPrice": null,
    "order": 1,
    "sourceModule": "popular_event_carousel"
  }],
  "source": "",
  "sourceRef": "",
  "totalStake": 0
}

→ { "code": "B199971" }
```

Format `selectionKey` : `E{eventId}B{betTypeId}O{oddKey}`.

### BetMomo

```
POST https://winners.bcapps.org/image-creator/share-booking/
Content-Type: application/json
Origin: https://www.betmomo.com

(body inclut siteId=211, events avec eventId+gameId+price, betType)

→ { "share": { "bookingLink": "https://www.betmomo.com?bookingId1138687", "bookId": 1138687 } }
```

### 1win

```
POST https://api-gateway.top-parser.com/shared-bets/create
Origin: https://1win.ng

{
  "coupons": [{
    "oddId": "10:4087560419631843:1",
    "matchId": 38271915
  }]
}

→ { "result": { "code": "VyLL--0" } }
```

Format `oddId` : `<groupId>:<uniqueId>:<outcome>` où groupId=10 = Winner,
outcome=1 = Home. Obtenu via WebSocket `push-server-v2` `subscribe-match-odds`.

### 1xBet / Megapari (marche via workers Base44)

Voir `base44/functions/megapariCoupon/entry.ts` dans le projet Base44 pour
l'implémentation complète. Points clés :

- URL : `https://megapari.africa/service-api/LiveBet/Open/SaveCoupon` (miroir
  utilisé pour 1xBet aussi car les GameId sont communs).
- Headers obligatoires : `x-app-n: __BETTING_APP__`, `x-svc-source:
  __BETTING_APP__`.
- Payload avec `PlayersDuel: {Team1Ids: null, Team2Ids: null}`, `PV: null`,
  `Kind: 3` (prématch) ou `Kind: 1` (live), `CheckCf: 1` critique.
- Refresh la cote via `GetGameZip?id=<gameId>` AVANT SaveCoupon (sinon rejet
  "cote périmée").
- Route via Cloudflare Workers privés (`hidden-pine-7436.veolalex3.workers.dev`
  et `billowing-sea-2d8e.alvecapital60.workers.dev`) pour bypass des blocages
  géo/CF.

## Historique

- v1-v5 du probe : 5 itérations d'un script `probe-coupon-codes-all.js` qui
  tentait la génération sur 7 books. Résultat final : 1/7 (CongoBet).
- Décision : abandon de cette voie, doc archivée pour reprise ultérieure.
