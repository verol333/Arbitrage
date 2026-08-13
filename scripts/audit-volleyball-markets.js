// Audit exhaustif Congobet + Apollo foot : dump TOUS les marchés dispos
// sur 3 matchs récents, identifier ceux non parsés actuellement.
import congobet from '../src/bookmakers/congobet/index.js';
import apollo from '../src/bookmakers/apollo/index.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';

// IDs déjà parsés (extraits de src/bookmakers/congobet/odds.js)
const CONGOBET_PARSED = new Set([
  10001, 10008, 10010, 10003, 10055, 10056, 10015, 10016, 10031, 10022, // FT
  10007, 10104, 10028, 10011, 10108, 10109, 10107, 10113, 10106,          // 1MT
  10024, 10120, 10029, 10030, 10124, 10125, 10123, 10127, 10119,          // 2MT
  10147, 10504, 10153, 10146,                                             // Corners
  10009, 10021, 10025, 10026, 10027, 10039, 10040, 10116, 10117,          // Explicitement ignorés (combos)
  10309, 10310, 10312, 10489,
]);

// Apollo BetTypeKeys déjà parsés
const APOLLO_PARSED = new Set([
  1, 3, 4, 43, 45, 47, 60, 598, 599, 41, 531,               // FT
  42, 200, 606, 5000, 952, 4035, 4037, 4038,                // 1MT
  546, 201, 607, 5001, 953, 4036, 4041, 4042,               // 2MT
  127, 128, 129, 5002,                                       // Corners
]);

async function auditCongobet() {
  console.log('\n==============================');
  console.log('=== CONGOBET FOOT AUDIT ===');
  console.log('==============================');
  const matches = await congobet.listMatches({ sport: 'football', horizonHours: 72 });
  console.log(`Total matchs : ${matches.length}`);
  if (!matches.length) { console.log('AUCUN MATCH — abort'); return; }

  // Prendre 3 matchs représentatifs
  const sample = matches.slice(0, 3);
  const inventaire = new Map();  // betTypeId → { name, count, sampleShortName }

  for (const m of sample) {
    console.log(`\n>>> [${m.league}] ${m.home} vs ${m.away} (id=${m.id})`);
    const json = await congoJson(`${CONGO_API}events/${m.id}`);
    if (!json?.eventBetTypes) { console.log('   pas de eventBetTypes'); continue; }
    for (const bt of json.eventBetTypes) {
      const id = Number(bt.betTypeId);
      const norm = id >= 20000 && id < 30000 ? id - 10000 : id;
      const items = (bt.eventBetTypeItems || []).filter(it => it.active && it.bettingAllowed);
      if (!items.length) continue;
      const key = norm;
      if (!inventaire.has(key)) {
        inventaire.set(key, {
          rawId: id, name: bt.name, matchCount: 0, sampleItems: []
        });
      }
      const entry = inventaire.get(key);
      entry.matchCount++;
      if (entry.sampleItems.length < 3) {
        for (const it of items.slice(0, 3)) {
          entry.sampleItems.push(it.shortName);
        }
      }
    }
  }

  console.log('\n--- CONGOBET FOOT : INVENTAIRE TOUS betTypeId ---');
  const sorted = [...inventaire.entries()].sort((a, b) => a[0] - b[0]);
  const parsed = [], notParsed = [];
  for (const [id, info] of sorted) {
    const status = CONGOBET_PARSED.has(id) ? '✅ PARSÉ' : '❌ NON PARSÉ';
    const line = `  id=${id} ${status} "${info.name}" (${info.matchCount} matchs, items: ${info.sampleItems.slice(0, 3).join(' | ')})`;
    if (CONGOBET_PARSED.has(id)) parsed.push(line); else notParsed.push(line);
  }
  console.log('\n[NON PARSÉS - À EXPLORER]');
  notParsed.forEach(l => console.log(l));
  console.log(`\n[Résumé] Parsés: ${parsed.length} | Non parsés: ${notParsed.length}`);
}

async function auditApollo() {
  console.log('\n==============================');
  console.log('=== APOLLO FOOT AUDIT ===');
  console.log('==============================');
  const matches = await apollo.listMatches({ sport: 'football' });
  console.log(`Total matchs : ${matches.length}`);
  if (!matches.length) { console.log('AUCUN MATCH — abort'); return; }

  const sample = matches.slice(0, 3);
  const inventaire = new Map();

  for (const m of sample) {
    console.log(`\n>>> [${m.league}] ${m.home} vs ${m.away} (id=${m.id})`);
    // Apollo requiert IncludeBetTypeNames=true pour avoir les noms des marchés
    const j = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}&IncludeBetTypeNames=true`);
    const offers = j?.Offers || j?.BasicOffer || [];
    if (!offers.length) { console.log('   pas de Offers'); continue; }
    for (const o of offers) {
      const key = Number(o.BetTypeKey);
      const oddsCount = (o.Odds || []).length;
      if (!oddsCount) continue;
      if (!inventaire.has(key)) {
        inventaire.set(key, {
          name: o.BetTypeName || o.BetTypeKey, matchCount: 0, sampleOdds: []
        });
      }
      const entry = inventaire.get(key);
      entry.matchCount++;
      if (entry.sampleOdds.length < 3) {
        for (const od of (o.Odds || []).slice(0, 3)) {
          entry.sampleOdds.push(`${od.Type}:${od.Name}`);
        }
      }
    }
  }

  console.log('\n--- APOLLO FOOT : INVENTAIRE TOUS BetTypeKey ---');
  const sorted = [...inventaire.entries()].sort((a, b) => a[0] - b[0]);
  const parsed = [], notParsed = [];
  for (const [id, info] of sorted) {
    const status = APOLLO_PARSED.has(id) ? '✅ PARSÉ' : '❌ NON PARSÉ';
    const line = `  key=${id} ${status} "${info.name}" (${info.matchCount} matchs, samples: ${info.sampleOdds.slice(0, 3).join(' | ')})`;
    if (APOLLO_PARSED.has(id)) parsed.push(line); else notParsed.push(line);
  }
  console.log('\n[NON PARSÉS - À EXPLORER]');
  notParsed.forEach(l => console.log(l));
  console.log(`\n[Résumé] Parsés: ${parsed.length} | Non parsés: ${notParsed.length}`);
}

(async () => {
  await auditCongobet();
  await auditApollo();
  console.log('\n=== FIN ===');
  process.exit(0);
})();
