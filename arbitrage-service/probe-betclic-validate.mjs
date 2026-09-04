// Validation des parseurs Betclic (tennis/basket/hockey/volley) contre les
// vraies cotes Betclic : liste -> 1er match -> odds -> parseur -> cles canoniques.
import { bcListAll, bcMatchMarkets } from '../src/bookmakers/betclic/api.js';
import { betclicTennisFlatOdds } from '../src/bookmakers/betclic/parseTennis.js';
import { betclicBasketFlatOdds } from '../src/bookmakers/betclic/parseBasket.js';
import { betclicHockeyFlatOdds } from '../src/bookmakers/betclic/parseHockey.js';
import { betclicVolleyballFlatOdds } from '../src/bookmakers/betclic/parseVolleyball.js';

const PARSERS = {
  tennis: betclicTennisFlatOdds,
  basket: betclicBasketFlatOdds,
  hockey: betclicHockeyFlatOdds,
  volleyball: betclicVolleyballFlatOdds,
};
const log = (m) => console.log(m);

async function validate(sport) {
  log('\n========================================');
  log('=== ' + sport.toUpperCase() + ' ===');
  const matches = await bcListAll(sport);
  log('Matchs listes: ' + matches.length);
  if (!matches.length) return;
  for (const m of matches.slice(0, 3)) {
    const markets = await bcMatchMarkets(m.id);
    const odds = PARSERS[sport](markets, { home: m.home, away: m.away });
    const keys = Object.keys(odds).filter((k) => k !== '_ids');
    log('  ' + m.home + ' vs ' + m.away + ' (' + m.league + ')');
    log('    cles: ' + (keys.length ? keys.join(' | ') : 'AUCUNE'));
    for (const k of keys.slice(0, 6)) log('    ' + k + ' = ' + odds[k]);
  }
}

for (const sp of ['tennis', 'basket', 'hockey', 'volleyball']) { await validate(sp); }
log('\n=== FIN VALIDATION ===');
