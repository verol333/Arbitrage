import { test } from 'node:test';
import assert from 'node:assert/strict';
import { winFlatOdds } from './parse.js';
const odd = (id, name, cf, outcome) => ({ id, name, cf, outcome, status: 1 });
for (const [home, away, price] of [['Granada', 'Las Palmas', 1.32], ['UD Almeria', 'Andorra Andorra la Vella', 1.31], ['Mallorca', 'Cordoba', 1.30]]) {
  test(home + ': Result and total Yes/No must never become team O/U', () => {
    const groups = { ['1st half. ' + home + '. Result and total']: [odd('1:a:b:2663:196:2.5:_', home + ' and total under 2.5 - Yes', 2.75), odd('1:a:b:2663:206:2.5:_', home + ' and total under 2.5 - No', price)], ['1st half. W1 and ' + home + ' total']: [odd('combo', 'Under 2.5', price)] };
    const odds = winFlatOdds(groups, {home, away});
    assert.equal(odds.ht_tt_home_under_2_5, undefined);
    assert.equal(odds['ht_tt_home_under_2.5'], undefined);
    assert.equal(odds['tt_home_under_2.5'], undefined);
  });
}
test('plain team totals and their native IDs are preserved in the correct half', () => {
  const odds = winFlatOdds({ 'Granada total': [odd('ft', 'Under 1.5', 1.5, 'under')], '1st half. Granada total': [odd('ht', 'Under 1.5', 1.1, 'under')], '2nd half. Las Palmas total': [odd('h2', 'Over 0.5', 2.1, 'over')] }, {home:'Granada',away:'Las Palmas'});
  assert.equal(odds['tt_home_under_1.5'],1.5); assert.equal(odds['ht_tt_home_under_1.5'],1.1); assert.equal(odds['h2_tt_away_over_0.5'],2.1);
  assert.equal(odds._ids['ht_tt_home_under_1.5'].oddId,'ht');
});
test('a compound selection cannot overwrite a valid simple total', () => {
  const odds = winFlatOdds({'1st half. Granada total': [odd('plain','Under 2.5',1.02,'under'),odd('combo','Granada and total under 2.5 - No',1.32)]},{home:'Granada',away:'Las Palmas'});
  assert.equal(odds['ht_tt_home_under_2.5'],1.02); assert.equal(odds._ids['ht_tt_home_under_2.5'].oddId,'plain');
});
