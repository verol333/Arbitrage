#!/usr/bin/env node
// AUDIT SportyBet : liste + dump marketIds inconnus par sport.
import sb from '../src/bookmakers/sportybet/index.js';
import { SB_SPORT_IDS } from '../src/bookmakers/sportybet/api.js';
import { sportybetFlatOdds } from '../src/bookmakers/sportybet/parse.js';

// sportybetFlatOdds dispatch en interne selon sport option.
const runParse = (markets, sport, names) => sportybetFlatOdds(markets, { sport, ...names });
const SPORTS = ['football','tennis','basket','hockey'];

// KNOWN marketIds per sport (from parse.js)
const KNOWN = {
  football: new Set(['1','10','11','16','18','26','29','60','68']),
  tennis: new Set(['186','187','188','189','190','191','196','198','202','203','204','314']),
  basket: new Set(['219','223','225','227','228','229','60','66','68','83','235','236','303','304']),
  hockey: new Set(['1','10','16','18','26','27','29','86']),
};

function sanity2(o, k1, k2) {
  const a=o[k1], b=o[k2];
  if (!a||!b) return '-';
  return `${a.toFixed(2)}+${b.toFixed(2)}→inv=${(1/a+1/b).toFixed(3)}`;
}

// Fetch full event (ALL markets, sans filter) via /api/ng/factsCenter/event
async function fetchEventFull(eventId) {
  const url = `https://www.sportybet.com/api/ng/factsCenter/event?eventId=${eventId}`;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
        Accept: '*/*', 'Accept-Language': 'en',
        Referer: 'https://www.sportybet.com/ng/sport/football/today',
        clientid: 'web', operid: '2', platform: 'web',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.data || j;
  } catch (e) { return null; }
}

console.log('▶ AUDIT SportyBet\n');

for (const sport of SPORTS) {
  console.log(`\n═══════════════════ ${sport.toUpperCase()} ═══════════════════`);
  let matches;
  try { matches = await sb.listMatches({ sport, horizonHours: 48 }); }
  catch (e) { console.log(`  listMatches err=${e.message}`); continue; }
  console.log(`  Matchs listes : ${matches.length}`);
  if (!matches.length) { console.log('  ⚠ 0 matchs'); continue; }
  console.log(`  Samples : ${matches.slice(0,3).map(m=>`${m.home} vs ${m.away}`).join(' | ')}`);
  const known = KNOWN[sport] || new Set();

  for (const s of matches.slice(0,2)) {
    console.log(`\n  ── ${s.home} vs ${s.away} (id=${s.id}) ──`);
    const ev = await fetchEventFull(s.id);
    if (!ev) { console.log('    ⚠ event fetch failed'); continue; }
    const markets = ev.markets || [];
    console.log(`    ${markets.length} markets dans /event`);
    const uniqueIds = new Map();
    for (const m of markets) {
      const mid = String(m.id || m.marketId || '');
      if (!uniqueIds.has(mid)) uniqueIds.set(mid, m);
    }
    console.log(`    ${uniqueIds.size} marketIds distincts`);
    const newIds = [...uniqueIds.entries()].filter(([mid]) => !known.has(mid));
    console.log(`    NOUVEAUX (non mappes): ${newIds.length}`);
    for (const [mid, m] of newIds.slice(0, 25)) {
      const nm = m.desc || m.name || m.marketDesc || '';
      const nOut = (m.outcomes || []).length;
      const specs = m.specifier ? ` spec="${m.specifier}"` : '';
      console.log(`      NEW id=${mid} nOut=${nOut} name="${nm}"${specs}`);
    }
    // Parse
    const parsed = runParse(markets, sport, { home: s.home, away: s.away });
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

console.log('\n═══ FIN AUDIT SportyBet ═══');
process.exit(0);
