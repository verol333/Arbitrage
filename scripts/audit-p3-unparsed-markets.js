// P3 audit — agrège les BetTypeKey Apollo non-parsés sur un large échantillon de
// matchs pour identifier les marchés secondaires à ajouter en priorité.
// Sortie : tableau (frequency, key, description sample, odds sample).
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import apollo from '../src/bookmakers/apollo/index.js';

// Keys actuellement parsés dans src/bookmakers/apollo/parse.js (foot only).
const PARSED_KEYS = new Set([
  1, 3, 4, 43, 45, 47, 60, 598, 599, 41, 531,
  42, 200, 606, 5000, 952, 4035, 4037, 4038,
  546, 201, 607, 5001, 953, 4036, 4041, 4042,
  127, 128, 129, 5002,
  9980, 9979, 958, 959, 960, 961, 965, 966,
]);

async function main() {
  console.log('▶ P3 audit — BetTypeKey Apollo non-parsés (foot)\n');
  const matches = await apollo.listMatches({ sport: 'football', live: false });
  console.log(`Matches: ${matches.length}`);
  const sample = matches.slice(0, 30);
  console.log(`Sampling ${sample.length} matchs\n`);

  // Aggregate : key → { count, descriptions: Set, sampleOdds: [] }
  const agg = new Map();
  let processed = 0;
  for (const m of sample) {
    processed++;
    let raw;
    try { raw = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}`); }
    catch (e) { continue; }
    if (!raw) continue;
    const offers = raw.Offers || (raw.BasicOffer ? [raw.BasicOffer] : []);
    for (const o of offers) {
      const k = Number(o.BetTypeKey);
      if (PARSED_KEYS.has(k)) continue;
      if (!agg.has(k)) agg.set(k, { count: 0, descs: new Set(), sample: null, sbvs: new Set(), oddTypes: new Set() });
      const a = agg.get(k);
      a.count++;
      const d = o.Description || o.Name || '?';
      a.descs.add(d);
      if (o.Sbv != null) a.sbvs.add(o.Sbv);
      for (const od of (o.Odds || [])) a.oddTypes.add(String(od.Type || od.PickCode || '?'));
      if (!a.sample) a.sample = { desc: d, sbv: o.Sbv, odds: (o.Odds || []).slice(0, 4).map((od) => `${od.Type || od.PickCode || '?'}=${od.Odd}(${od.Name || ''})`).join(' | ') };
    }
    if (processed % 10 === 0) console.log(`... ${processed}/${sample.length}`);
  }

  // Sort by frequency desc
  const sorted = [...agg.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`\n═══ ${sorted.length} BetTypeKey non-parsés (agrégés sur ${processed} matchs) ═══\n`);
  console.log('key\tcount\tdescription\tsbv?\toddTypes\tsample');
  for (const [k, a] of sorted.slice(0, 40)) {
    const descList = [...a.descs].slice(0, 2).join(' | ');
    const sbvSample = a.sbvs.size ? [...a.sbvs].slice(0, 3).join(',') : '—';
    const types = [...a.oddTypes].slice(0, 6).join(',');
    console.log(`${k}\t${a.count}\t${descList}\t${sbvSample}\t${types}`);
    console.log(`   sample: ${a.sample?.odds || ''}`);
  }

  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
