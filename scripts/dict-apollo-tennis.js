#!/usr/bin/env node
// Dictionnaire complet Apollo tennis — approche systematique :
// 1. Chercher endpoint /BetTypes ou /BetTypeGroups pour recuperer les NOMS
// 2. Sinon : fetcher 10+ matchs et analyser patterns par BetTypeKey
// 3. Pour chaque BetTypeKey, produire hypothese avec preuves

import { fetchJson } from '../src/net/fetcher.js';

const SPORT_API = 'https://sportapis-apollo.webapis.sk/SportsOfferApi/api';
const HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Origin: 'https://m.apollogames.cg',
  Referer: 'https://m.apollogames.cg/',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
};

const apolloGet = (path) => fetchJson(`${SPORT_API}${path}`, { headers: HEADERS, timeoutMs: 20000 });

// ═══════════════════════════════════════════════════════════════
// PHASE 1 : chercher endpoint dictionnaire BetTypes
// ═══════════════════════════════════════════════════════════════
console.log('═══ PHASE 1 : chercher dictionnaire BetTypes ═══\n');
const dictCandidates = [
  '/sport/offer/v3/bettypes',
  '/sport/offer/v3/bet-types',
  '/sport/offer/v3/BetTypes',
  '/sport/offer/v3/bettypesgroups',
  '/sport/offer/v3/dict/bettypes',
  '/sport/offer/v3/markets',
  '/sport/offer/v3/sport/bettypes?SportId=389',
  '/sport/offer/v3/bettypes/389',
  '/sport/offer/v3/BetTypeGroups?SportId=389',
  '/sport/offer/v3/sport/389/bettypes',
];
for (const p of dictCandidates) {
  try {
    const j = await apolloGet(p);
    if (j) {
      const size = JSON.stringify(j).length;
      const keys = Array.isArray(j) ? `Array(${j.length})` : Object.keys(j).slice(0, 5).join(',');
      console.log(`  ✓ ${p} → ${size}b keys=${keys}`);
      // Si array, montrer premier item
      if (Array.isArray(j) && j.length) console.log(`    sample: ${JSON.stringify(j[0]).slice(0, 300)}`);
      else if (typeof j === 'object') console.log(`    sample: ${JSON.stringify(j).slice(0, 300)}`);
    } else console.log(`  ✗ ${p}`);
  } catch (e) { console.log(`  ✗ ${p} : ${e.message}`); }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 2 : fetch 10 matchs tennis + analyse par BetTypeKey
// ═══════════════════════════════════════════════════════════════
console.log('\n\n═══ PHASE 2 : sample large + analyse patterns ═══\n');
const now = new Date().toISOString();
const dateTo = '2046-01-01T00:00:00.000Z';
const list = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=200&DateFrom=${now}&DateTo=${dateTo}&SportIds=389`);
const allMatches = [];
for (const s of list?.Response || []) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) {
  if (!m.Id || !m.TeamHome || !m.TeamAway) continue;
  allMatches.push({ id: m.Id, home: m.TeamHome, away: m.TeamAway, league: `${c.Name} / ${l.Name}` });
}
console.log(`  ${allMatches.length} matchs tennis dispos`);
const sample = allMatches.slice(0, 8);

// Fetch offers en batch
const BATCH = 8;
const offersMap = new Map();
for (let i = 0; i < sample.length; i += BATCH) {
  const chunk = sample.slice(i, i + BATCH);
  const res = await Promise.all(chunk.map(m => apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}`)));
  res.forEach((r, k) => { if (r?.Id) offersMap.set(chunk[k].id, r.Offers || (r.BasicOffer ? [r.BasicOffer] : [])); });
}
console.log(`  ${offersMap.size}/${sample.length} matchs avec offers`);

// Grouper toutes les offers par BetTypeKey
const byKey = {};
for (const [matchId, offers] of offersMap.entries()) {
  const match = sample.find(m => m.id === matchId);
  for (const o of offers) {
    const k = String(o.BetTypeKey || '');
    if (!byKey[k]) byKey[k] = { instances: [], distinctSbvs: new Set(), outcomeTypesAcrossAll: new Set(), outcomeNamesAcrossAll: new Set() };
    const outs = (o.Odds || []).map(od => ({ Type: String(od.Type || ''), Name: (od.Name || '').toString(), Odd: parseFloat(od.Odd) }));
    outs.forEach(x => { byKey[k].outcomeTypesAcrossAll.add(x.Type); byKey[k].outcomeNamesAcrossAll.add(x.Name); });
    if (o.Sbv !== undefined && o.Sbv !== null && o.Sbv !== '') byKey[k].distinctSbvs.add(o.Sbv);
    byKey[k].instances.push({
      matchLabel: `${match?.home} vs ${match?.away}`,
      sbv: o.Sbv,
      outcomes: outs,
    });
  }
}

// Afficher pour chaque BetTypeKey
console.log(`\n  ${Object.keys(byKey).length} BetTypeKeys distincts observés :\n`);
for (const k of Object.keys(byKey).sort((a, b) => Number(a) - Number(b))) {
  const b = byKey[k];
  const sbvs = [...b.distinctSbvs].sort();
  const outTypes = [...b.outcomeTypesAcrossAll].sort();
  const outNames = [...b.outcomeNamesAcrossAll].filter(n => n && n !== '').sort();
  console.log(`\n  ━━ BetTypeKey=${k} ━━`);
  console.log(`    Instances : ${b.instances.length}`);
  console.log(`    Sbvs distincts (${sbvs.length}) : ${sbvs.slice(0, 15).join(', ')}${sbvs.length > 15 ? '...' : ''}`);
  console.log(`    Outcome Types : ${outTypes.slice(0, 10).join(', ')}`);
  console.log(`    Outcome Names : ${outNames.slice(0, 10).join(' | ')}`);
  // Exemple : afficher 2-3 instances avec les cotes
  console.log(`    Exemples :`);
  for (const inst of b.instances.slice(0, 3)) {
    const outs = inst.outcomes.map(x => `${x.Type}"${x.Name}"=${x.Odd}`).join(' | ');
    console.log(`      [${inst.matchLabel}] Sbv=${inst.sbv ?? ''} → ${outs}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// PHASE 3 : chercher endpoint qui donne NOMS des marchés dans un match
// ═══════════════════════════════════════════════════════════════
console.log('\n\n═══ PHASE 3 : chercher endpoint avec noms de markets ═══\n');
if (sample[0]) {
  const id = sample[0].id;
  const alternativeEndpoints = [
    `/sport/offer/v3/match?MatchId=${id}`,
    `/sport/offer/v3/match/${id}`,
    `/sport/offer/v3/match/${id}/offers`,
    `/sport/offer/v3/matches/${id}`,
    `/sport/offer/v3/match/full-offer?MatchId=${id}`,
    `/sport/offer/v3/match/detail?MatchId=${id}`,
    `/sport/offer/v3/match/offers?MatchId=${id}&IncludeBetTypeNames=true`,
    `/sport/offer/v3/match/offers?MatchId=${id}&Detailed=true`,
    `/sport/offer/v3/BetTypeInfo?BetTypeKey=20`,
    `/sport/offer/v3/BetTypesForSport?SportId=389`,
  ];
  for (const p of alternativeEndpoints) {
    try {
      const j = await apolloGet(p);
      if (j) {
        const size = JSON.stringify(j).length;
        const first = JSON.stringify(j).slice(0, 400);
        console.log(`  ✓ ${p} → ${size}b`);
        console.log(`    ${first}`);
      } else console.log(`  ✗ ${p}`);
    } catch (e) { console.log(`  ✗ ${p} : ${e.message}`); }
  }
}

console.log('\n═══ FIN DICTIONNAIRE APOLLO ═══');
