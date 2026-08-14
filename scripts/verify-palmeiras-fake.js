// Vérification directe du match "Palmeiras Sao Joao U20 vs Comercial Tiete U20"
// sur 1xBet et BetMomo pour identifier fake arb signalé par user (2026-08-14).
// Opp reportée : 1xBet match_1=3.65 + BetMomo dc_X2=6.20 → +56% profit.
// Suspect : cotes contradictoires (Palmeiras=27% vs 16%X2 impliquerait Palm=84%).
import xbet from '../src/bookmakers/xbet/index.js';
import betmomo from '../src/bookmakers/betmomo/index.js';

const NEEDLE_HOME = /palmeiras.*sao.*joao|palmeiras\s*sj/i;
const NEEDLE_AWAY = /comercial.*tiet[eé]/i;

function find(matches, book) {
  const hits = matches.filter((m) => {
    const s = `${m.home} ${m.away}`.toLowerCase();
    return NEEDLE_HOME.test(s) && NEEDLE_AWAY.test(s);
  });
  console.log(`\n[${book}] matches trouvés: ${hits.length}`);
  for (const h of hits) {
    console.log(`   id=${h.id}  ${h.home} vs ${h.away}  (${h.league || '?'})  kick=${h.kickoff || h.start || '?'}`);
  }
  return hits;
}

async function main() {
  console.log('▶ Verify Palmeiras SJ U20 vs Comercial Tiete U20\n');

  const [xMatches, bmMatches] = await Promise.all([
    xbet.listMatches({ sport: 'football', live: false }).catch((e) => { console.log('xbet list err:', e.message); return []; }),
    betmomo.listMatches({ sport: 'football', live: false }).catch((e) => { console.log('betmomo list err:', e.message); return []; }),
  ]);
  console.log(`1xBet total: ${xMatches.length}   BetMomo total: ${bmMatches.length}`);

  const xHits = find(xMatches, '1xBet');
  const bmHits = find(bmMatches, 'BetMomo');

  if (!xHits.length || !bmHits.length) {
    console.log('\n⚠️ Match introuvable sur au moins un book. Recherche large "palmeiras" :');
    const xLarge = xMatches.filter((m) => /palmeiras/i.test(`${m.home} ${m.away}`)).slice(0, 10);
    const bmLarge = bmMatches.filter((m) => /palmeiras/i.test(`${m.home} ${m.away}`)).slice(0, 10);
    console.log(`[1xBet] palmeiras candidates (${xLarge.length}):`);
    for (const m of xLarge) console.log(`   ${m.home} vs ${m.away}  kick=${m.kickoff || m.start}`);
    console.log(`[BetMomo] palmeiras candidates (${bmLarge.length}):`);
    for (const m of bmLarge) console.log(`   ${m.home} vs ${m.away}  kick=${m.kickoff || m.start}`);
  }

  // Fetch odds pour chaque hit
  for (const m of xHits.slice(0, 2)) {
    console.log(`\n═══ 1xBet parseur odds pour: ${m.home} vs ${m.away} ═══`);
    try {
      const parsed = await xbet.getOdds(m, { sport: 'football' });
      const keys = ['match_1', 'match_X', 'match_2', 'dc_1X', 'dc_12', 'dc_X2'];
      for (const k of keys) console.log(`   ${k}\t= ${parsed[k] ?? '(absent)'}`);
    } catch (e) { console.log(`   ⚠️ getOdds err: ${e.message}`); }
  }

  for (const m of bmHits.slice(0, 2)) {
    console.log(`\n═══ BetMomo parseur odds pour: ${m.home} vs ${m.away} ═══`);
    try {
      const parsed = await betmomo.getOdds(m, { sport: 'football' });
      const keys = ['match_1', 'match_X', 'match_2', 'dc_1X', 'dc_12', 'dc_X2'];
      for (const k of keys) console.log(`   ${k}\t= ${parsed[k] ?? '(absent)'}`);
      // Détail natif du dc_X2 si présent
      if (parsed._ids?.dc_X2) {
        const ids = parsed._ids.dc_X2;
        console.log(`   ↳ dc_X2 natif: market="${ids.market_name_native}" selection="${ids.selection_name_native}" eventName="${ids.eventName}"`);
      }
    } catch (e) { console.log(`   ⚠️ getOdds err: ${e.message}`); }
  }

  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
