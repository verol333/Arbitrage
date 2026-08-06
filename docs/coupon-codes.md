# Coupon codes / booking codes par bookmaker

Endpoints capturés en F12 (session user 06/08/2026) pour générer un code
partageable qui recharge le pari exact chez le user cible.

## Tableau des endpoints

| Book | Endpoint | Format IDs requis | Réponse code |
|---|---|---|---|
| **1xbet** | `POST 1xbet.cg/service-api/LiveBet/Open/SaveCoupon` | `{ Events: [{ GameId, Type, Coef, Param, Kind, PlayerId }], partner: 1, Summ }` | `{ Success, Value: "CODE" }` |
| **1win** | `POST api-gateway.top-parser.com/shared-bets/create` | `{ coupons: [{ oddId }], currencyCode, l, p: PLATFORM }` | `{ result: { code } }` |
| **sportybet** | `POST www.sportybet.com/api/ng/orders/share` | `[{ eventId: "sr:match:XXX", marketId, outcomeId }]` | `{ data: { shareCode, shareURL } }` |
| **betpawa** | `POST cg.betpawa.com/api/sportsbook/v3/booking-number` | `{ selections: [...] }` | `{ code: "65FNKJA" }` (7 chars alphanum) |
| **congobet** | `POST hg-betting-api-prod.sporty-tech.net/api/betting/get-my-code` | `{ eventBetTypeItemIds: [10375080979], betCategory: "SportsFixedOdds", betSystemType: "Simple", stakePerLine: [50], totalStake: 50 }` | `{ code: "504126" }` (6 digits) |
| **betmomo** | Via image-creator/share-booking (BetConstruct SWARM) | Selections BetConstruct (game_id + event_id) | `bookingId` numérique 7 chars, URL `betmomo.com?bookingId={N}` |
| **yellowbet** | `POST yellowbet.cg/services/clapi/api/Bet/placebetsport` avec `isBooking: true` | `{ selections: [{ key: "E{eventId}B{betTypeId}O{oddKey}X", eventId, betTypeId, oddKey, oddPrice }], isBooking: true }` | `{ code: "B199971" }` (7 chars) |
| **premierbet** | À investiguer (probablement même que 1xbet/megapari : SaveCoupon `/service-api/LiveBet/Open/SaveCoupon` avec partner différent car guineegames) | idem 1xbet | idem |
| **apollo** | À investiguer via F12 | ? | ? |
| **maxibet** | Meme stack BetConstruct = même image-creator/share-booking que BetMomo | idem BetMomo | bookingId numérique |

## Ce dont notre scanner a besoin d'enrichir dans chaque opp

Actuellement une opp contient : `{ leg_a_book, leg_a_label, leg_a_odd, leg_b_book, leg_b_label, leg_b_odd, market_family, ... }`.

Pour permettre au backend Base44 de générer un coupon code, il faut aussi transmettre les IDs BRUTS de chaque leg :

```json
{
  "leg_a": {
    "book": "1xbet",
    "coupon_data": {
      "game_id": 123456,       // GameId 1xbet
      "type": 1,               // "1" du 1X2
      "param": 0,
      "coef": 2.30             // cote de reference
    }
  },
  "leg_b": {
    "book": "sportybet",
    "coupon_data": {
      "event_id": "sr:match:69923776",
      "market_id": "1",
      "outcome_id": "2"
    }
  }
}
```

Chaque bookmaker a un format différent — donc chaque parseur doit ajouter dans `getOdds()` (ou dans les cles retournees) les IDs bruts pour permettre au backend de reconstruire le SaveCoupon.

## Options d'architecture

### Option A : le scanner enrichit les opps
- Chaque parseur retourne, avec chaque cote, les `raw_ids` de l'event (game_id/market_id/outcome_id).
- L'opp envoyée au webhook contient `leg_a.coupon_data` + `leg_b.coupon_data`.
- Le backend Base44 lit ces IDs et appelle le SaveCoupon adéquat quand l'user clique "Copier le code".
- **Avantage** : coupon généré à la demande (fresh, cote garantie).
- **Inconvénient** : ajoute ~50-200 bytes par opp dans le payload.

### Option B : le scanner génère le code direct à l'envoi
- Après détection de l'opp, on appelle SaveCoupon des 2 books, on récupère les 2 codes, on les met dans l'opp.
- **Avantage** : le user voit directement le code sans clic supplémentaire.
- **Inconvénient** : latence (2 API calls sync par opp), risque de fail si book rate-limite le SaveCoupon.

**Recommandation** : Option A. Enrichir + délégué au backend. Beaucoup plus robuste.

## Marchés couverts pour l'instant (arbitrage)

Le scanner produit des opps sur ces markets :
- 1X2 / DC / DNB
- Total Buts (over/under X.5)
- Total Buts Individuels (home/away over/under)
- Handicap Asiatique
- BTTS Yes/No
- Corners / MT1 / MT2 variants

Chaque market a un mapping `type_id` + `param` différent par book. Pour chaque `market_family` généré par le scanner, il faut identifier dans le parseur d'origine quel event brut le sous-tend, puis exposer ses `raw_ids`.

## Prochaine étape concrète

1. Modifier chaque parseur (`src/bookmakers/*/parse.js`) pour retourner PLUS QUE les cotes plates : chaque cote doit s'accompagner de `raw_ids: { game_id, type/market_id/outcome_id, param }`.
2. Structurer ça sans casser l'existant (les cotes restent comparables, on ajoute juste un side-channel).
3. Modifier `arbitrage.js` pour propager les `raw_ids` dans les opps générées.
4. Modifier `cli.js` webhook payload pour inclure `leg_a.coupon_data` + `leg_b.coupon_data`.
5. Côté backend Base44 : écrire `arbitrageCoupon` function qui reçoit `{ book, coupon_data }` et retourne `{ code, shareURL }`.
