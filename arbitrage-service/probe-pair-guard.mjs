import assert from 'node:assert/strict';
import fs from 'node:fs';

// Le dépôt n'a pas de package.json : src/core/markets.js n'est pas chargeable
// tel quel par Node. On charge donc UNIQUEMENT le bloc du garde-fou, extrait du
// vrai fichier — on teste ainsi exactement le code livré au scanner.
const src = fs.readFileSync(new URL('../src/core/markets.js', import.meta.url), 'utf8');
const start = src.indexOf('const PAIR_FLOOR');
assert.ok(start > 0, 'bloc PAIR_FLOOR introuvable dans src/core/markets.js');
const block = src.slice(start).replace(/export function/g, 'function');
const { dropInconsistentPairs, complementKey } = new Function(block + '\nreturn { dropInconsistentPairs, complementKey };')();

// Cas réel du 13/11/2026 — « Suisse U20 – Roumanie U20 », les deux équipes
// marquent. 1xBet lu avec btts_no 3.97 alors que son site affichait 2.05 :
// 1/1.58 + 1/3.97 = 0.885 < 1, paire impossible chez un book.
const u20 = { btts_yes: 1.58, btts_no: 3.97, _ids: { btts_yes: { betType: 180 }, btts_no: { betType: 181 } } };
const dropped = dropInconsistentPairs(u20);
assert.equal(dropped.length, 1);
assert.equal(dropped[0].sum, 0.885);
assert.equal(u20.btts_yes, undefined);
assert.equal(u20.btts_no, undefined);
assert.equal(u20._ids.btts_no, undefined);
console.log(JSON.stringify({ cas: 'U20 réel 1.58 / 3.97', somme: dropped[0].sum, garde: 'PAIRE RETIRÉE' }));

// La cote réellement affichée (2.05) : paire cohérente, conservée.
const u20ok = { btts_yes: 1.58, btts_no: 2.05 };
assert.deepEqual(dropInconsistentPairs(u20ok), []);
assert.equal(u20ok.btts_no, 2.05);

assert.deepEqual(dropInconsistentPairs({ 'match_over_2.5': 1.6, 'match_under_2.5': 1.65 }), []);
const tot = { 'match_over_2.5': 4.5, 'match_under_2.5': 1.65 };
assert.equal(dropInconsistentPairs(tot).length, 1);
assert.equal(tot['match_over_2.5'], undefined);
assert.equal(complementKey('hcp_home_1.5'), 'hcp_away_-1.5');
assert.equal(dropInconsistentPairs({ 'hcp_home_1.5': 1.9, 'hcp_away_-1.5': 3.5 }).length, 1);
assert.deepEqual(dropInconsistentPairs({ ht_btts_yes: 3.74, ht_btts_no: 1.21 }), []);
assert.deepEqual(dropInconsistentPairs({ odd: 1.9, even: 1.95 }), []);
assert.deepEqual(dropInconsistentPairs({ 'tt_home_over_1.5': 2.4, 'tt_home_under_1.5': 1.5 }), []);

// 1X2 et marchés à trois issues jamais touchés (le nul est une issue réelle).
assert.deepEqual(dropInconsistentPairs({ match_1: 1.5, match_X: 4, match_2: 4, dnb_1: 1.2, dnb_2: 3.4 }), []);
assert.equal(complementKey('match_1'), null);
assert.equal(complementKey('match_X'), null);

// Une seule issue exposée : rien à vérifier.
assert.deepEqual(dropInconsistentPairs({ btts_yes: 1.58 }), []);

console.log('PAIR_FLOOR_VALIDATED');
