// Audit exhaustif Congobet + Apollo : basket, tennis, volleyball
// prématch + LIVE. Compare marchés dispos vs parsés actuellement.
import congobet from '../src/bookmakers/congobet/index.js';
import apollo from '../src/bookmakers/apollo/index.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';

// IDs déjà parsés — basket Congobet
const CONGOBET_BASKET_PARSED = new Set([
  10007, 10011, 10024, 10105, 10107, 10113, 10121, 10123, 10127,
  10170, 10172, 10174, 10176, 10177, 10182, 10491,
  10001, 10009, 10021, 10059, 10209, 10211, // ignored combos
]);
// IDs déjà parsés — tennis/volleyball Congobet
const CONGOBET_TENNIS_PARSED = new Set([
  10002, 10155, 10044, 10045, 10048, 10157, 10158, 10161, 10162, 10163,
]);
// BetTypeKeys déjà parsés — tennis/volleyball Apollo
const APOLLO_TENNIS_PARSED = new Set([
  20, 502, 558, 910, 911, 841, 842, 597, 988, 914, 915,
]);

async function dumpBook(book, sport, live = false) {
  console.log(`\n${'='.repeat(30)}`);
  console.log(`=== ${book.key.toUpperCase()} ${sport.toUpperCase()} ${live ? 'LIVE' : 'PREMATCH'} ===`);
  console.log('='.repeat(30));
  const matches = await book.listMatches({ sport, live, horizonHours: 72 });
  console.log(`Total matchs : ${matches.length}`);
  if (!matches.length) return;
  // Log 2-3 samples matchs
  matches.slice(0, 3).forEach(m => {
    const start = m.start ? new Date(m.start).toISOString().slice(0, 16) : '?';
    console.log(`  · [${m.league || '?'}] ${m.home} vs ${m.away} @ ${start}`);
  });
  return matches;
}

async function auditCongobet(sport, parsedSet) {
  const matches = await dumpBook(congobet, sport, false);
  if (!matches?.length) return;
  const sample = matches.slice(0, 3);
  const inventaire = new Map();
  for (const m of sample) {
    const json = await congoJson(`${CONGO_API}events/${m.id}`);
    if (!json?.eventBetTypes) continue;
    for (const bt of json.eventBetTypes) {
      const id = Number(bt.betTypeId);
      const norm = id >= 20000 && id < 30000 ? id - 10000 : id;
      const items = (bt.eventBetTypeItems || []).filter(it => it.active && it.bettingAllowed);
      if (!items.length) continue;
      if (!inventaire.has(norm)) inventaire.set(norm, { name: bt.name, count: 0, samples: [] });
      const e = inventaire.get(norm);
      e.count++;
      if (e.samples.length < 3) items.slice(0, 3).forEach(it => e.samples.push(it.shortName));
    }
  }
  const sorted = [...inventaire.entries()].sort((a, b) => a[0] - b[0]);
  const notParsed = sorted.filter(([id]) => !parsedSet.has(id));
  console.log(`\n[NON PARSÉS ${sport}]`);
  notParsed.forEach(([id, info]) => console.log(`  id=${id} "${info.name}" (${info.count}m, ${info.samples.slice(0, 3).join(' | ')})`));
  console.log(`[Résumé] Parsés=${sorted.length - notParsed.length} | NonParsés=${notParsed.length}`);
}

async function auditApollo(sport, parsedSet) {
  const matches = await dumpBook(apollo, sport, false);
  if (!matches?.length) return;
  const sample = matches.slice(0, 3);
  const inventaire = new Map();
  for (const m of sample) {
    const j = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}&IncludeBetTypeNames=true`);
    const offers = j?.Offers || (j?.BasicOffer ? [j.BasicOffer] : []);
    for (const o of offers) {
      const k = Number(o.BetTypeKey);
      const oddsCount = (o.Odds || []).length;
      if (!oddsCount) continue;
      if (!inventaire.has(k)) inventaire.set(k, { name: o.BetTypeName || k, count: 0, samples: [] });
      const e = inventaire.get(k);
      e.count++;
      if (e.samples.length < 3) (o.Odds || []).slice(0, 3).forEach(od => e.samples.push(`${od.Type}:${od.Name}`));
    }
  }
  const sorted = [...inventaire.entries()].sort((a, b) => a[0] - b[0]);
  const notParsed = sorted.filter(([id]) => !parsedSet.has(id));
  console.log(`\n[NON PARSÉS ${sport}]`);
  notParsed.forEach(([id, info]) => console.log(`  key=${id} "${info.name}" (${info.count}m, ${info.samples.slice(0, 3).join(' | ')})`));
  console.log(`[Résumé] Parsés=${sorted.length - notParsed.length} | NonParsés=${notParsed.length}`);
}

async function auditLive() {
  console.log('\n\n' + '#'.repeat(40));
  console.log('# LIVE MATCHS PAR SPORT (Congobet + Apollo)');
  console.log('#'.repeat(40));
  for (const book of [congobet, apollo]) {
    for (const sport of ['football', 'basket', 'tennis', 'volleyball', 'hockey']) {
      try {
        const matches = await book.listMatches({ sport, live: true });
        console.log(`  ${book.key} ${sport} LIVE = ${matches.length} matchs`);
      } catch (e) {
        console.log(`  ${book.key} ${sport} LIVE = ERR ${e.message}`);
      }
    }
  }
}

(async () => {
  await auditCongobet('basket', CONGOBET_BASKET_PARSED);
  await auditCongobet('tennis', CONGOBET_TENNIS_PARSED);
  await auditCongobet('volleyball', CONGOBET_TENNIS_PARSED);
  await auditApollo('basket', new Set());  // basket Apollo pas encore parsé
  await auditApollo('tennis', APOLLO_TENNIS_PARSED);
  await auditApollo('volleyball', APOLLO_TENNIS_PARSED);
  await auditLive();
  console.log('\n=== FIN ===');
  process.exit(0);
})();
