import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mozzartTennisFlatOdds } from './parseSports.js';
import { mozzartFlatOdds } from './parse.js';
import { compareTennisTwoBooks } from '../../core/arbitrage.js';
const winner = (side, price, extra = {}) => ({ value: String(price), winStatus: 'ACTIVE', matchId: 10116786, id: side === '1' ? 885397709 : 885397710, specialOddValue: '-1', subGame: { id: side === '1' ? 1005017001 : 1005017003, gameId: 17, gameName: 'Match Winner', subGameName: side }, ...extra });
test('Landreth-Pampanin: keep the native 1.01 opposite 10.90', () => {
  const odds = mozzartTennisFlatOdds({ a: winner('1', '1.01'), b: winner('2', '10.90') });
  assert.equal(odds.match_1, 1.01); assert.equal(odds.match_2, 10.9);
  assert.equal(odds._ids.match_2.odd_id, '885397710');
  assert.deepEqual(compareTennisTwoBooks({ match_1: 2.22, match_2: 1.60 }, 'betmomo', odds, 'mozzart'), []);
});
for (const [name, a, b] of [['Bandurowska-Straszewska', 1.50, 2.41], ['Chudejova-Njiric', 4.40, 1.17], ['valid high price', 1.01, 10.90]]) test(name + ': native prices are preserved, not capped', () => {
  const odds = mozzartTennisFlatOdds([winner('1', a), winner('2', b)]);
  assert.equal(odds.match_1, a); assert.equal(odds.match_2, b);
});
test('suspended price is not restored by the 1.01 fix', () => assert.equal(mozzartTennisFlatOdds([winner('1', 1.01, {winStatus: 'SUSPENDED'})]).match_1, undefined));
test('football also preserves 1.01 for the existing source-coherence check', () => {
  const o = winner('1', 1.01); o.subGame.gameId = 1;
  assert.equal(mozzartFlatOdds([o]).match_1, 1.01);
});
test('a set winner never becomes the match winner', () => {
  const o = winner('2', 10.9); o.subGame.gameId = 22;
  const odds = mozzartTennisFlatOdds([o]);
  assert.equal(odds.match_2, undefined); assert.equal(odds.s1_match_2, 10.9);
});
