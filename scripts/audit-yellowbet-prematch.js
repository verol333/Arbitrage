#!/usr/bin/env node
// Audit YellowBet PREMATCH football : dump les noms de marches reels renvoyes
// avec language=fr pour verifier que parse.js matche les bons libelles.
// L'utilisateur a signale que certains bookmakers renvoient FR, d'autres EN.
import { evapi } from '../src/bookmakers/yellowbet/api.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';

const url = 'https://yellowbet.cg/services/evapi/event/GetEvents?sportIds=31&count=200&take=200';
const data = await evapi(url);
const events = (data?.data || []).filter((e) => e.sid === 31 && e.bts && e.bts.length);

console.log(`=== YELLOWBET PREMATCH FOOTBALL AUDIT ===`);
console.log(`Total prematch football events: ${events.length}`);
if (!events.length) { console.log('NO EVENTS'); process.exit(1); }

// Trouver un match "riche" (nombreux markets) pour audit representatif
events.sort((a, b) => (b.bts?.length || 0) - (a.bts?.length || 0));
const ev = events[0];
console.log(`\nMatch le plus riche : ${ev.h} vs ${ev.a} (${ev.ln}) — ${ev.bts.length} markets`);

const NAMES_SAMPLE = new Set();
console.log(`\n=== TOUS LES NOMS DE MARCHES (${ev.bts.length}) ===`);
for (const bt of ev.bts) {
  NAMES_SAMPLE.add(String(bt.n || '').trim());
  const nOdds = (bt.odds || []).length;
  const oddsSample = (bt.odds || []).slice(0, 4).map((o) =>
    `${o.n || o.id}=${o.p}${o.l != null ? ' l=' + o.l : ''}${o.sp != null ? ' sp=' + o.sp : ''}`
  );
  console.log(`- "${bt.n}" (${nOdds} odds): ${oddsSample.join(' | ')}`);
}

// Test parseur sur ce match
const parsed = yellowbetFlatOdds(ev.bts);
console.log(`\n=== PARSEUR ACTUEL (yellowbetFlatOdds) ===`);
console.log(`Cles produites: ${Object.keys(parsed).length}`);
console.log(JSON.stringify(parsed, null, 2));

// Detection de noms non-mappes (probable FR au lieu d'EN attendu)
const KNOWN_EN = [
  'FT 1X2', 'Double Chance', 'GG/NG', 'Under/Over', 'HT 1X2', 'HT U/O',
  '2nd Half : 1X2', '2nd Half : Totals', 'Draw No Bet', 'Odd/Even goals',
  'HT Double Chance', 'HT GG/NG', '2nd Half : Double Chance', '2nd Half : GG/NG',
  'Corners Under/Over', 'Corners U/O', 'HT Corners U/O', 'HT Odd/Even goals',
  '2nd Half : Odd/Even goals',
];
const unrecognized = [];
for (const name of NAMES_SAMPLE) {
  if (!name) continue;
  const isKnown = KNOWN_EN.some((k) => name.toLowerCase() === k.toLowerCase())
    || /handicap|team.*total|individual.*total|home.*total|away.*total/i.test(name);
  if (!isKnown) unrecognized.push(name);
}
console.log(`\n=== NOMS NON MATCHES PAR PARSE.JS ACTUEL (${unrecognized.length}) ===`);
for (const n of unrecognized) console.log(`  "${n}"`);

// Verdict langue
const hasFrKeywords = [...NAMES_SAMPLE].some((n) =>
  /résultat|résultat|plus|moins|à|deux équipes|marquent|mi-temps|impair/i.test(n)
);
const hasEnKeywords = [...NAMES_SAMPLE].some((n) =>
  /result|both teams|score|half time|odd\/even/i.test(n)
);
console.log(`\n=== LANGUE ===`);
console.log(`FR keywords: ${hasFrKeywords ? 'OUI' : 'non'}`);
console.log(`EN keywords: ${hasEnKeywords ? 'OUI' : 'non'}`);

process.exit(0);
