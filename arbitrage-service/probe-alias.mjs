import { dropInconsistentPairs } from '../src/core/markets.js';
// Paire corrompue constatée chez Mozzart (Hatta Club - Al Ain) : 119 % de marge.
const a = { tt_home_over_0.5: 1.28, tt_home_under_0.5: 2.45, _ids: {} };
console.log('corrompue  ->', JSON.stringify(dropInconsistentPairs(a)), JSON.stringify(a));
// Paire saine (marge 6 %).
const b = { tt_home_over_0.5: 1.85, tt_home_under_0.5: 1.95, _ids: {} };
console.log('saine      ->', JSON.stringify(dropInconsistentPairs(b)), JSON.stringify(b));
// Paire figée (somme < 1) : plancher historique.
const c = { match_over_2.5: 3.4, match_under_2.5: 4.2, _ids: {} };
console.log('figee      ->', JSON.stringify(dropInconsistentPairs(c)), JSON.stringify(c));
