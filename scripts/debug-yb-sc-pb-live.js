// Debug ciblé : YellowBet live (cotes suspectes), Sportcash market mapping, PB opps
import { bookmakers } from '../src/bookmakers/index.js';
import { yellowbetFlatOdds } from '../src/bookmakers/yellowbet/parse.js';
import { sportcashFlatOdds } from '../src/bookmakers/sportcash/parse.js';

const [xbet, onewin, congobet, yellowbet, apollo, betmomo, sportcash, premierbet] = bookmakers;

// ═══════════════════════════ 1. YELLOWBET LIVE ═══════════════════════════
console.log('════════════ YELLOWBET LIVE — dump 2 matches brut vs parsed ════════════');
try {
  const ybLive = await yellowbet.listMatches({ sport: 'football', live: true });
  console.log(`YB live count = ${ybLive.length}`);
  for (const m of ybLive.slice(0, 2)) {
    console.log(`\n──── ${m.home} vs ${m.away}  score=${m.live?.score} min=${m.live?.minute}`);
    const bts = m.__raw?.bts || [];
    console.log(`  Markets bruts (${bts.length}) :`);
    for (const mkt of bts.slice(0, 25)) {
      const outs = (mkt.odds || []).slice(0, 5).map((o) => `"${o.n ?? o.id}"@${o.p}${o.l != null ? ` (l=${o.l})` : ''}${o.sp != null ? ` (sp=${o.sp})` : ''}${o.hc != null ? ` (hc=${o.hc})` : ''}`).join(', ');
      console.log(`    "${mkt.n}" [${outs}]`);
    }
    const parsed = yellowbetFlatOdds(bts);
    console.log(`  Parsed keys (${Object.keys(parsed).length}) :`);
    for (const [k, v] of Object.entries(parsed).slice(0, 30)) console.log(`    ${k} = ${v}`);
  }
} catch (e) { console.log('YB err:', e.message); }

// ═══════════════════════════ 2. SPORTCASH MARKET MAPPING ═══════════════════════════
console.log('\n\n════════════ SPORTCASH — cs codes → parsed keys ════════════');
try {
  const scList = await sportcash.listMatches({ sport: 'football', horizonHours: 72 });
  for (const m of scList.slice(0, 1)) {
    console.log(`\n──── ${m.home} vs ${m.away}`);
    const markets = m.__raw?.markets || [];
    console.log(`  Markets bruts (${markets.length}) — sample par cs :`);
    const byCs = new Map();
    for (const mk of markets) {
      if (!byCs.has(mk.cs)) byCs.set(mk.cs, []);
      byCs.get(mk.cs).push(mk);
    }
    for (const [cs, mks] of [...byCs.entries()].slice(0, 20)) {
      const mk = mks[0];
      const outs = (mk.eps || []).slice(0, 8).map((e) => `"${e.et || e.n}"@${e.cot || e.c}${e.hc != null ? ` hc=${e.hc}` : ''}`).join(', ');
      console.log(`    cs=${cs} n="${mk.dn || mk.n || '?'}" [${outs}]`);
    }
    const parsed = sportcashFlatOdds(markets);
    console.log(`  Parsed keys (${Object.keys(parsed).length}) :`);
    for (const [k, v] of Object.entries(parsed).slice(0, 30)) console.log(`    ${k} = ${v}`);
  }
} catch (e) { console.log('SC err:', e.message); }

// ═══════════════════════════ 3. PREMIERBET — pourquoi 0 opps ? ═══════════════════════════
console.log('\n\n════════════ PREMIERBET — 4 matches détail ════════════');
try {
  const pbList = await premierbet.listMatches({ sport: 'football' });
  console.log(`PB catalog = ${pbList.length}`);
  for (const m of pbList.slice(0, 4)) {
    const odds = await premierbet.getOdds(m);
    console.log(`\n──── ${m.home} vs ${m.away} (${new Date(m.start).toISOString().slice(11,16)})`);
    console.log(`  Keys (${Object.keys(odds).length}) : ${JSON.stringify(odds).slice(0, 300)}`);
  }
} catch (e) { console.log('PB err:', e.message); }
process.exit(0);
