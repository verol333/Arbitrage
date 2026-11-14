import { dropInconsistentPairs } from '../src/core/markets.js';
const a = { 'tt_home_over_0.5': 1.28, 'tt_home_under_0.5': 2.45, _ids: {} };
console.log('corrompue  ->', JSON.stringify(dropInconsistentPairs(a)), JSON.stringify(a));
const b = { 'tt_home_over_0.5': 1.85, 'tt_home_under_0.5': 1.95, _ids: {} };
console.log('saine      ->', JSON.stringify(dropInconsistentPairs(b)), JSON.stringify(b));
const c = { 'match_over_2.5': 3.4, 'match_under_2.5': 4.2, _ids: {} };
console.log('figee      ->', JSON.stringify(dropInconsistentPairs(c)), JSON.stringify(c));
