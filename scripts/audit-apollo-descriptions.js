// AUDIT APOLLO — dump exhaustif des Offers (BetTypeKey, Description, Odds)
// pour identifier les BetTypeKeys mismappés dans le parseur.
// Priorite : Clean Sheet (user report 2026-08-14 — cotes ~2x fausses sur 5 matchs
// consécutifs). Puis audit tous les autres BetTypeKeys parsés pour détecter
// d'éventuels autres mismappings sur marchés secondaires.
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import apollo from '../src/bookmakers/apollo/index.js';

// BetTypeKeys parses actuellement dans src/bookmakers/apollo/parse.js (foot).
const PARSED_KEYS = [
  { k: 1, name: 'match_1/X/2 (1X2)' },
  { k: 3, name: 'dc_1X/12/X2' },
  { k: 4, name: 'hcp_home/away (Sbv)' },
  { k: 43, name: 'btts_yes/no' },
  { k: 45, name: 'odd/even' },
  { k: 47, name: 'dnb_1/2' },
  { k: 60, name: 'match_over/under (Sbv)' },
  { k: 598, name: 'tt_home_over/under' },
  { k: 599, name: 'tt_away_over/under' },
  { k: 41, name: 'fts_home/away/none' },
  { k: 531, name: 'half_most_ht/h2/equal' },
  { k: 42, name: 'ht_match_1/X/2 + ht_dc' },
  { k: 200, name: 'ht_dnb_1/2' },
  { k: 606, name: 'ht_odd/even' },
  { k: 5000, name: 'ht_under/over (Sbv)' },
  { k: 952, name: 'ht_btts_yes/no' },
  { k: 4035, name: 'ht_hcp_home/away' },
  { k: 129, name: 'cor_odd/even' },
  { k: 5002, name: 'cor_ht_under/over' },
  { k: 901, name: '⚠️ cs_home_yes/no (USER SAYS WRONG)' },
  { k: 902, name: '⚠️ cs_away_yes/no (USER SAYS WRONG)' },
  { k: 965, name: 'tt_home_even/odd' },
  { k: 966, name: 'tt_away_even/odd' },
];
const PARSED_SET = new Set(PARSED_KEYS.map((x) => x.k));

async function auditMatch(matchId, label) {
  console.log(`\n${'='.repeat(80)}\n=== ${label} (id=${matchId})\n${'='.repeat(80)}`);
  const raw = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${matchId}`);
  if (!raw) { console.log('  ❌ pas de réponse'); return; }
  const offers = raw.Offers || (raw.BasicOffer ? [raw.BasicOffer] : []);
  console.log(`  Total offers: ${offers.length}`);
  console.log(`  Teams: ${raw.TeamHome} vs ${raw.TeamAway}`);

  // Group by BetTypeKey
  const byKey = new Map();
  for (const o of offers) {
    const k = Number(o.BetTypeKey);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(o);
  }

  // Section 1 : BetTypeKeys PARSÉS — dump description + Sbv + Odds pour cross-check
  console.log(`\n─── BetTypeKeys PARSÉS (${PARSED_SET.size}) ───`);
  for (const { k, name } of PARSED_KEYS) {
    const grp = byKey.get(k);
    if (!grp) { console.log(`  ${k}\t${name}\t— absent`); continue; }
    // Sample first offer
    const sample = grp[0];
    const oddsStr = (sample.Odds || []).map((od) => `${od.Type || od.PickCode || '?'}=${od.Odd}`).slice(0, 4).join(' ');
    const sbv = sample.Sbv ? ` Sbv=${sample.Sbv}` : '';
    const desc = sample.Description || sample.Name || '?';
    console.log(`  ${k}\t${name}`);
    console.log(`     → Desc="${desc}"${sbv} | Odds: ${oddsStr} (${grp.length} offer${grp.length > 1 ? 's' : ''})`);
  }

  // Section 2 : Chercher spécifiquement "Clean Sheet" dans les Descriptions
  console.log(`\n─── Recherche "Clean Sheet" dans les Descriptions ───`);
  const cleanSheetHits = [];
  for (const o of offers) {
    const d = (o.Description || o.Name || '').toLowerCase();
    if (d.includes('clean') || d.includes('to nil') || d.includes('ne marque') || d.includes('cage')) {
      cleanSheetHits.push(o);
    }
  }
  if (!cleanSheetHits.length) console.log('  ⚠️ Aucune Description Clean Sheet trouvée');
  for (const o of cleanSheetHits) {
    const oddsStr = (o.Odds || []).map((od) => `${od.Type || od.PickCode || '?'}=${od.Odd}(${od.Name || ''})`).slice(0, 4).join(' | ');
    console.log(`  BetTypeKey=${o.BetTypeKey}\tDesc="${o.Description}"\tSbv=${o.Sbv || '—'}`);
    console.log(`     Odds: ${oddsStr}`);
  }

  // Section 3 : BetTypeKeys NON PARSÉS — top 20 pour repérer les marchés qu'on rate
  const unparsed = [...byKey.entries()].filter(([k]) => !PARSED_SET.has(k)).sort((a, b) => b[1].length - a[1].length);
  console.log(`\n─── BetTypeKeys NON PARSÉS (${unparsed.length}, top 20) ───`);
  for (const [k, grp] of unparsed.slice(0, 20)) {
    const sample = grp[0];
    const oddsStr = (sample.Odds || []).map((od) => `${od.Type || od.PickCode || '?'}=${od.Odd}`).slice(0, 4).join(' ');
    const sbv = sample.Sbv ? ` Sbv=${sample.Sbv}` : '';
    console.log(`  ${k}\t"${sample.Description || sample.Name || '?'}"${sbv} | ${oddsStr}`);
  }
}

// ═════ main ═════
async function main() {
  console.log('▶ AUDIT APOLLO Descriptions (Clean Sheet + BetTypeKeys parsés)\n');

  // Chercher un match Suédois (Mjällby) ou Chypriote (AC Omonia) — cas user report
  const matches = await apollo.listMatches({ sport: 'football', live: false });
  console.log(`Total matches Apollo football: ${matches.length}`);

  const targets = [
    matches.find((m) => /mj[aä]llby|sirius/i.test(m.home + ' ' + m.away)),
    matches.find((m) => /omonia|lincoln/i.test(m.home + ' ' + m.away)),
    matches.find((m) => /verl|duisburg/i.test(m.home + ' ' + m.away)),
    matches.find((m) => /zenit|dynamo/i.test(m.home + ' ' + m.away)),
    matches.find((m) => /neom|fayha/i.test(m.home + ' ' + m.away)),
  ].filter(Boolean);
  console.log(`Cibles user-report trouvées: ${targets.length}`);

  // Fallback : take top 3 upcoming matches if no target found
  const sample = targets.length ? targets.slice(0, 3) : matches.slice(0, 3);
  for (const m of sample) {
    await auditMatch(m.id, `[${m.league}] ${m.home} vs ${m.away}`);
  }

  console.log('\n▶ Fin.');
  process.exit(0);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
