// Sonde de cartographie Bet9ja.
//
// 1. Combien de matchs Bet9ja expose sur les 72 h et combien aujourd'hui,
//    avec le détail par compétition (c'est la base du scan d'arbitrage).
// 2. Sur les trois matchs les plus riches, ce que produit CHAQUE marché :
//    les clés standard obtenues, et la liste de ceux volontairement non
//    mappés (handicaps européens, combinés, tirs, cartons...).
//
// Usage : node probe-bet9ja-map.mjs   (workflow : Sonde — cartographie Bet9ja)
import { listPrematch } from '../src/bookmakers/bet9ja/list.js';
import { getEventFull } from '../src/bookmakers/bet9ja/odds.js';
import { b9MappingReport, parseB9Odds } from '../src/bookmakers/bet9ja/parse.js';

const stamp = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log('[' + stamp() + '] ' + m);

const FAMILIES = [
  ['1X2', /^match_[1X2]$/],
  ['Double chance', /^dc_/],
  ['BTTS', /^btts_/],
  ['Draw No Bet', /^dnb_/],
  ['Totaux', /^match_(over|under)_/],
  ['Handicaps', /^hcp_/],
  ['Pair/Impair', /^(odd|even)$/],
  ['1re équipe à marquer', /^fts_/],
  ['Mi-temps prolifique', /^half_most_/],
  ['Totaux par équipe', /^tt_/],
  ['1re mi-temps', /^ht_/],
  ['2e mi-temps', /^h2_/],
  ['Corners', /^cor_/],
];

const CHECKS = ['match_1', 'match_X', 'match_2', 'btts_yes', 'match_over_2.5', 'hcp_home_-0.5', 'ht_match_1', 'h2_match_1', 'cor_over_9.5', 'cor_ht_over_4.5', 'cor_h2_over_4.5'];

const day = new Date().toISOString().slice(0, 10);
log('Lecture des matchs Bet9ja (football, 72 h)…');
const matches = await listPrematch('football', { horizonHours: 72 });
const today = matches.filter((m) => new Date(m.start).toISOString().slice(0, 10) === day);
log('Matchs à venir (72 h) : ' + matches.length + ' · aujourd\'hui (' + day + ') : ' + today.length);

const byLeague = new Map();
for (const m of today) byLeague.set(m.league, (byLeague.get(m.league) || 0) + 1);
log('Compétitions du jour (matchs) :');
[...byLeague.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([l, n]) => log('   ' + String(n).padStart(3) + '  ' + l));

const rich = [...matches].sort((a, b) => (b.__raw.markets || 0) - (a.__raw.markets || 0));
const pool = today.length >= 3 ? [...today].sort((a, b) => (b.__raw.markets || 0) - (a.__raw.markets || 0)) : rich;
const sample = pool.slice(0, 3);

for (const m of sample) {
  log('');
  log('══ ' + m.home + ' vs ' + m.away + ' · ' + m.league + ' · ' + new Date(m.start).toISOString());
  let D;
  try {
    D = await getEventFull(m.id, { noCache: true });
  } catch (e) {
    log('   ⚠️ lecture impossible : ' + (e.message || e));
    continue;
  }
  const report = b9MappingReport(D);
  const { odds } = parseB9Odds(D);
  const familles = FAMILIES.map(([name, re]) => name + ' ' + Object.keys(odds).filter((k) => re.test(k)).length);
  log('marchés Bet9ja ' + report.totals.markets + ' · mappés ' + report.totals.mapped + ' · clés standard ' + report.totals.keys);
  log('familles : ' + familles.join(' | '));

  const unmapped = report.rows.filter((r) => !r.keys.length).map((r) => r.name);
  log('non mappés (' + unmapped.length + ') : ' + (unmapped.length ? unmapped.join(' · ') : 'aucun'));

  const mapped = report.rows.filter((r) => r.keys.length).sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));
  for (const row of mapped) {
    const keys = row.keys.slice(0, 6).join(', ') + (row.keys.length > 6 ? ' …' : '');
    log('   ' + row.id.padEnd(17) + row.name.slice(0, 42).padEnd(44) + '→ ' + keys);
  }

  log('contrôle : ' + CHECKS.map((k) => k + '=' + (odds[k] == null ? '—' : odds[k])).join(' | '));
}

log('');
log('Fin de la sonde.');
