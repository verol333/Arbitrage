// Vérifie que la collecte BetKing du scanner produit bien des cotes.
import { listBetking } from '../src/bookmakers/betking/list.js';
import { betkingOdds } from '../src/bookmakers/betking/parse.js';
import { closeBetking } from '../src/bookmakers/betking/api.js';

const rows = await listBetking({ force: true });
console.log('ROWS', rows.length);
const r = rows.find((x) => (x.collections || []).length) || rows[0];
if (r) {
  const c0 = (r.collections || [])[0] || {};
  console.log('SAMPLE', JSON.stringify({ id: r.id, home: r.home, away: r.away, nb: (r.collections || []).length, c0name: c0?.OddsType?.OddsTypeName, c0type: c0?.OddsType?.OddsTypeID, c0param: c0?.SpecialBetValue, c0sels: (c0.MatchOdds || []).map((m) => m?.OddAttribute?.OddName + '=' + m?.Outcome?.OddOutcome) }));
  console.log('ODDS', JSON.stringify(betkingOdds(r)).slice(0, 700));
}
await closeBetking();
