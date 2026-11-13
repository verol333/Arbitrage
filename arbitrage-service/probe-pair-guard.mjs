import assert from 'node:assert/strict';
import { dropInconsistentPairs, complementKey } from '../src/core/markets.js';

// Cas réel du 13/11/2026 — « Suisse U20 – Roumanie U20 », les deux équipes
// marquent. 1xBet avait été lu avec btts_no 3.97 alors que son site affichait
// 2.05 : 1/1.58 + 1/3.97 = 0.884 < 1, paire impossible chez un book.
const u20 = { btts_yes: 1.58, btts_no: 3.97, _ids: { btts_yes: { betType: 180 }, btts_no: { betType: 181 } } };
const droppedU20 = dropInconsistentPairs(u20);
assert.equal(droppedU20.length, 1);
assert.equal(droppedU20[0].sum, 0.884);
assert.equal(u20.btts_yes, undefined);
assert.equal(u20.btts_no, undefined);
assert.equal(u20._ids.btts_no, undefined);
console.log(JSON.stringify({ cas: 'U20 réel (1.58 / 3.97)', somme: droppedU20[0].sum, garde: 'PAIRE RETIRÉE' }));

// Même match avec la cote réellement affichée (2.05) : paire cohérente, gardée.
const u20ok = { btts_yes: 1.58, btts_no: 2.05 };
assert.deepEqual(dropInconsistentPairs(u20ok), []);
assert.equal(u20ok.btts_no, 2.05);

// Totaux, handicaps, mi-temps, pair/impair : même plancher.
assert.deepEqual(dropInconsistentPairs({ 'match_over_2.5': 1.6, 'match_under_2.5': 1.65 }), []);
const tot = { 'match_over_2.5': 4.5, 'match_under_2.5': 1.65 };
assert.equal(dropInconsistentPairs(tot).length, 1);
assert.equal(tot['match_over_2.5'], undefined);
const hcp = { 'hcp_home_1.5': 1.9, 'hcp_away_-1.5': 3.5 };
assert.equal(complementKey('hcp_home_1.5'), 'hcp_away_-1.5');
assert.equal(dropInconsistentPairs(hcp).length, 1);
assert.deepEqual(dropInconsistentPairs({ ht_btts_yes: 3.74, ht_btts_no: 1.21 }), []);
assert.deepEqual(dropInconsistentPairs({ odd: 1.9, even: 1.95 }), []);
assert.deepEqual(dropInconsistentPairs({ 'tt_home_over_1.5': 2.4, 'tt_home_under_1.5': 1.5 }), []);

// Le 1X2 et les marchés à trois issues ne sont JAMAIS touchés (le nul existe).
assert.deepEqual(dropInconsistentPairs({ match_1: 1.5, match_X: 4, match_2: 4, dnb_1: 1.2, dnb_2: 3.4 }), []);
assert.equal(complementKey('match_1'), null);
assert.equal(complementKey('match_X'), null);

// Une seule issue exposée : rien à vérifier.
assert.deepEqual(dropInconsistentPairs({ btts_yes: 1.58 }), []);

console.log('PAIR_FLOOR_VALIDATED');
