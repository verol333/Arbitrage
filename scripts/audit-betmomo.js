#!/usr/bin/env node
// AUDIT BetMomo (SWARM WS) : dump market types inconnus par sport.
import bm from '../src/bookmakers/betmomo/index.js';
import { swarmSession, BETMOMO_SID, BETMOMO_SITE_ID } from '../src/bookmakers/betmomo/api.js';
import { betmomoFlatOdds } from '../src/bookmakers/betmomo/parse.js';
import { readFileSync } from 'fs';

const SPORTS = ['football','tennis','basket','hockey'];

// Extraire market type strings dynamiquement
const parseSrc = readFileSync('src/bookmakers/betmomo/parse.js', 'utf8');
const KNOWN = new Set(
  (parseSrc.match(/'[A-Z][a-zA-Z0-9]{2,25}'/g) || []).map(s => s.slice(1, -1))
);
console.log(`▶ AUDIT BetMomo — ${KNOWN.size} market_types connus\n`);

function sanity2(o, k1, k2) {
  const a=o[k1], b=o[k2];
  if (!a||!b) return '-';
  return `${a.toFixed(2)}+${b.toFixed(2)}→inv=${(1/a+1/b).toFixed(3)}`;
}

// Fetch un match via SWARM avec markets complets
async function fetchMatchMarkets(matchId, sport) {
  return swarmSession(async (send) => {
    const sid = BETMOMO_SID[sport];
    const where = {
      partner: BETMOMO_SITE_ID, site: BETMOMO_SITE_ID, game: { id: matchId },
      sport: { id: sid },
    };
    const what = {
      market: ['id','type','name','base','main','group_id'],
      event: ['id','name','type','type_1','price','ob_id'],
    };
    const raw = await send(what, where);
    if (!raw || !raw.data) return [];
    const gd = raw.data.game || {};
    const markets = [];
    for (const gid of Object.keys(gd)) {
      const g = gd[gid];
      const gmarkets = g.market || {};
      for (const mid of Object.keys(gmarkets)) {
        const m = gmarkets[mid];
        m._events = Object.values(m.event || {});
        markets.push(m);
      }
    }
    return markets;
  }, { timeoutMs: 30_000 });
}

for (const sport of SPORTS) {
  console.log(`\n═══════════════════ ${sport.toUpperCase()} ═══════════════════`);
  let matches;
  try { matches = await bm.listMatches({ sport, horizonHours: 48 }); }
  catch (e) { console.log(`  listMatches err=${e.message}`); continue; }
  console.log(`  Matchs listes : ${matches.length}`);
  if (!matches.length) { console.log('  ⚠ 0 matchs'); continue; }
  console.log(`  Samples : ${matches.slice(0,3).map(m=>`${m.home} vs ${m.away}`).join(' | ')}`);

  for (const s of matches.slice(0, 2)) {
    console.log(`\n  ── ${s.home} vs ${s.away} (id=${s.id}) ──`);
    let markets;
    try { markets = await fetchMatchMarkets(s.id, sport); }
    catch (e) { console.log(`    ⚠ fetch err=${e.message}`); continue; }
    if (!markets || !markets.length) { console.log('    ⚠ no markets'); continue; }
    console.log(`    ${markets.length} markets raw`);
    const typesSeen = new Map();
    for (const m of markets) {
      const t = m.type || '?';
      if (!typesSeen.has(t)) typesSeen.set(t, { name: m.name || '', count: 0 });
      typesSeen.get(t).count++;
    }
    const known_p = [...typesSeen.keys()].filter(t => KNOWN.has(t));
    const unknown_p = [...typesSeen.keys()].filter(t => !KNOWN.has(t));
    console.log(`    market_types distincts : ${typesSeen.size}`);
    console.log(`    MAPPES : ${known_p.length} [${known_p.slice(0, 6).join(', ')}${known_p.length > 6 ? '...' : ''}]`);
    console.log(`    INCONNUS : ${unknown_p.length}`);
    for (const t of unknown_p.slice(0, 15)) {
      const info = typesSeen.get(t);
      console.log(`      NEW type="${t}" count=${info.count} name="${info.name}"`);
    }
    const parsed = betmomoFlatOdds(markets, { sport });
    const keys = Object.keys(parsed).filter(k => k !== '_ids');
    console.log(`    ► parseur emit ${keys.length} keys plates`);
    if (parsed.match_1 && parsed.match_2) console.log(`      match_1/2: ${sanity2(parsed, 'match_1', 'match_2')}`);
    if (parsed.match_X) console.log(`      match_X  : ${parsed.match_X}`);
    const hcpLines = [...new Set(keys.filter(k=>k.startsWith('hcp_home_')).map(k=>k.replace('hcp_home_','')))].slice(0,3);
    for (const l of hcpLines) {
      const h = parsed[`hcp_home_${l}`], a = parsed[`hcp_away_${-Number(l)}`];
      if (h && a) console.log(`      hcp L=${l}: ${sanity2(parsed, `hcp_home_${l}`, `hcp_away_${-Number(l)}`)}`);
    }
  }
}

console.log('\n═══ FIN AUDIT BetMomo ═══');
process.exit(0);
