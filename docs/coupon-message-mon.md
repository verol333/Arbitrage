# Message pour Mon — Codes coupons dans les opportunités d'arbitrage

Hey Mon,

Je viens d'ajouter dans le webhook `arbitrage_alert` de quoi générer des **codes coupons** sur les 5 bookmakers que le user a explorés (SportyBet, BetPawa, CongoBet, BetMomo, YellowBet), en plus des 3 déjà connus (1xBet, 1win, Megapari).

## Ce qui arrive maintenant dans chaque opp du webhook

En plus des champs actuels (`leg_a_book`, `leg_a_odd`, `leg_a_label`, `market_family`, …), chaque opp contient désormais :

```json
{
  "leg_a_book": "sportybet",
  "leg_a_match_id": "sr:match:69923776",
  "leg_a_coupon_data": {
    "eventId": "sr:match:69923776",
    "marketId": "1",
    "outcomeId": "1",
    "specifier": null
  },
  "leg_b_book": "premierbet",
  "leg_b_match_id": "30449696",
  "leg_b_coupon_data": null,
  "market_family": "1X2 — Domicile",
  "leg_a_label": "Domicile",
  "leg_b_label": "Nul ou Extérieur",
  ...
}
```

**Deux fallbacks possibles selon le book** :
- **Book fully enrichi** (SportyBet aujourd'hui, autres à venir) : `leg_a_coupon_data` contient tous les IDs bruts nécessaires au SaveCoupon — tu peux appeler directement l'endpoint du book.
- **Book pas encore enrichi** : `leg_a_coupon_data` sera `null`. Tu peux quand même construire le coupon via ta table de mapping `(book, market_family, label) → (marketId, outcomeId)` en utilisant `leg_a_match_id` comme event ID.

## Endpoints SaveCoupon par bookmaker

Voici ce que j'ai capturé en F12 sur les sites des books. Chaque function backend `arbitrageCoupon` prend `{ book, coupon_data | (match_id + market_family + label) }` et POST vers le bon endpoint :

### SportyBet
```
POST https://www.sportybet.com/api/ng/orders/share
Content-Type: application/json
Body: [
  { "eventId": "sr:match:69923776", "marketId": "1", "outcomeId": "1" }
]
Response: { "bizCode": 10000, "data": { "shareCode": "L3FRZR", "shareURL": "http://www.sportybet.com/ng/?shareCode=L3FRZR" } }
```

### BetPawa
```
POST https://cg.betpawa.com/api/sportsbook/v3/booking-number
Headers: x-pawa-brand=betpawa-congobrazzaville, x-pawa-language=fr
Body: { "selections": [ { ... event/market/outcome ... } ] }
Response: { "code": "65FNKJA" }
```

### CongoBet
```
POST https://hg-betting-api-prod.sporty-tech.net/api/betting/get-my-code
Body: {
  "totalOdds": 6,
  "eventBetTypeItemIds": [10375080979],
  "betCategory": "SportsFixedOdds",
  "betSystemType": "Simple",
  "drawGameSelections": [],
  "manualOddsBoostIds": [],
  "maxPayout": 300,
  "oddsBoostIds": [],
  "stakePerLine": [50],
  "totalStake": 50,
  "hasBetBuilderBetLines": false
}
Response: { "code": "504126" }
Note : `eventBetTypeItemIds` est le champ CLÉ — c'est l'ID unique par outcome
qui identifie exactement quel pari on prend. On l'obtient via les items
`eventBetTypes[i].eventBetTypeItems[j].id` dans le JSON `/events/{id}`.
```

### BetMomo (BetConstruct SWARM)
```
Pas de POST HTTP — passe par le WebSocket SWARM :
wss://eu-swarm-newm.betconstruct.com/
Commands : request_session (site_id=122) → puis `place_coupon` avec is_booking=true

Alternative simple : image-creator/share-booking
POST https://winners.bcapps.org/image-creator/share-booking/
Response contient : "share": { "bookingLink": "https://www.betmomo.com?bookingId1138687", "bookId": 1138687 }
```

### YellowBet
```
POST https://yellowbet.cg/services/clapi/api/Bet/placebetsport
Body: {
  "language": "fr",
  "acceptOddsChanges": true,
  "isBooking": true,     // ← LE FLAG QUI TRANSFORME LE PARI EN CODE
  "bonusIds": [],
  "BetBuilderModel": { "BetBuilderEvents": [] },
  "rows": [ { "amount": 0, "selectionKeys": ["E373008516B310310OX"] } ],
  "selections": [ {
    "key": "E373008516B310310OX",       // format E{eventId}B{betTypeId}O{oddKey}X
    "eventId": 373008516,
    "betTypeId": 310310,
    "betTypeName": "FT 1X2",
    "oddKey": "X",
    "oddName": "X",
    "oddPrice": "3.25",
    "gameTime": "2026-08-06T16:00:00Z",
    "homeName": "Jagiellonia Bialystok",
    "awayName": "Glasgow Rangers",
    "isLive": false,
    "isVirtual": false,
    "eventStatus": 0,
    "betStatus": 0,
    "order": 1
  } ],
  "source": "",
  "sourceRef": "",
  "totalStake": 0
}
Response: { "code": "B199971" }
```

## Ce qu'il te reste à faire côté backend

1. **Créer une function** `arbitrageCoupon({ book, match_id, market_family, leg_label, coupon_data? })` qui :
   - Si `coupon_data` est présent → utilise-le directement pour le POST SaveCoupon.
   - Sinon → fait un lookup dans ta table de mapping `(book, market_family, leg_label) → { marketId, outcomeId, specifier }` puis reconstruit la payload.
2. **Table de mapping** par book (à créer une seule fois, statique). Exemple format :
   ```
   sportybet.1X2 — Domicile           → { marketId: "1",  outcomeId: "1" }
   sportybet.1X2 — Extérieur          → { marketId: "1",  outcomeId: "3" }
   sportybet.BTTS — Oui               → { marketId: "29", outcomeId: "1" }
   sportybet.Total Buts Match 2.5     → { marketId: "18", outcomeId: "over/under", specifier: "total=2.5" }
   ...
   ```
3. **Frontend** : dans le composant qui affiche l'opp, ajouter 2 boutons "Copier code Book A" / "Copier code Book B" qui appellent `arbitrageCoupon` puis mettent le code dans le presse-papier avec toast "Copié ✅".

## Question à te poser sur le format

Actuellement chaque opp du webhook contient les 2 legs avec leur coupon_data en side-channel. Tu préfères :
- **(A)** Que je génère les codes en amont (côté scanner) et les envoie déjà prêts dans l'opp comme `leg_a_coupon_code` / `leg_b_coupon_code` ?
   → **Avantage** : user clique et copie direct, aucun round-trip.
   → **Inconvénient** : appel SaveCoupon à chaque opp = latence + risque throttle.

- **(B)** Ce mode actuel où le scanner envoie juste les IDs, et TON backend appelle SaveCoupon quand le user demande explicitement le code ?
   → **Avantage** : pas de call inutile pour les opps que le user ne regarde pas.
   → **Inconvénient** : latence perçue au clic (mais tu peux masquer avec un loader).

Perso je pense **(B)** est mieux, mais dis-moi ta préférence.

## Status actuel

- ✅ Scanner envoie `leg_a_match_id`, `leg_b_match_id`, `leg_a_coupon_data`, `leg_b_coupon_data` dans chaque opp.
- ✅ **SportyBet** enrichi complet (les 8 marchés foot + 12 marchés tennis).
- 🔎 BetPawa, CongoBet, BetMomo, YellowBet : `coupon_data` sera `null` tant que je n'ai pas fini leur enrichissement (dispo dans un patch suivant). Pour ces books tu peux déjà bosser avec `market_family + leg_label + match_id` via ta table de mapping.

À toi.
