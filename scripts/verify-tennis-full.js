#!/usr/bin/env node
// Vérification finale : pour chaque book, applique le mapping dictionnaire tennis
// sur 2 matchs et affiche cles+cotes pour validation user.
import { fetchJson } from '../src/net/fetcher.js';
import { isHalfLine } from '../src/core/markets.js';

const header = (t) => console.log(`\n${'═'.repeat(15)} ${t} ${'═'.repeat(15)}`);
const bullet = (label, keys) => {
  console.log(`\n  📌 ${label}`);
  console.log(`  ${Object.keys(keys).length} cles extraites :`);
  for (const [k, v] of Object.entries(keys).sort()) {
    console.log(`    ${k.padEnd(32)} = ${v}`);
  }
};

// ═══════════════════════════════════════════════════════════════
// 1) 1XBET — parseur foot actuel applique au tennis
// ═══════════════════════════════════════════════════════════════
header('1XBET — parseur foot actuel appliqué au tennis');
try {
  const { listPrematch } = await import('../src/bookmakers/xbet/list.js');
  const { getOdds } = await import('../src/bookmakers/xbet/odds.js');
  const matches = await listPrematch({ sport: 'tennis' });
  console.log(`  ${matches.length} matchs listés`);
  for (const m of matches.slice(0, 2)) {
    const odds = await getOdds(m.id, { live: false });
    bullet(`${m.home} vs ${m.away} [${m.league}]`, odds || {});
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 2) CONGOBET — parseur foot actuel applique au tennis
// ═══════════════════════════════════════════════════════════════
header('CONGOBET — parseur foot actuel appliqué au tennis');
try {
  const { listPrematch } = await import('../src/bookmakers/congobet/list.js');
  const { getOdds } = await import('../src/bookmakers/congobet/odds.js');
  const matches = await listPrematch('tennis');
  console.log(`  ${matches.length} matchs listés`);
  for (const m of matches.slice(0, 2)) {
    const odds = await getOdds(m.id);
    bullet(`${m.home} vs ${m.away} [${m.league}]`, odds || {});
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 3) APOLLO — dict mapping applique (11 marches)
// ═══════════════════════════════════════════════════════════════
header('APOLLO — dict tennis mapping applique');
try {
  const { listMatches, fetchOffers } = await import('../src/bookmakers/apollo/list.js');
  const matches = await listMatches({ live: false, sport: 'tennis' });
  const sample = matches.slice(0, 2);
  const map = await fetchOffers(sample.map(m => m.id));
  for (const m of sample) {
    const offers = map.get(m.id) || [];
    const keys = {};
    for (const o of offers) {
      const k = String(o.BetTypeKey || '');
      const sbv = o.Sbv;
      const line = sbv != null && sbv !== '' ? parseFloat(sbv) : null;
      for (const od of (o.Odds || [])) {
        const c = parseFloat(od.Odd);
        if (isNaN(c) || c <= 1) continue;
        const t = String(od.Type || '');
        // Mapping dict Apollo tennis
        if (k === '20') {
          if (t === '1') keys.match_1 = c;
          else if (t === '2') keys.match_2 = c;
        } else if (k === '502') {
          if (t === '1') keys.s1_match_1 = c;
          else if (t === '2') keys.s1_match_2 = c;
        } else if (k === '558') {
          if (t === '1') keys.s2_match_1 = c;
          else if (t === '2') keys.s2_match_2 = c;
        } else if (k === '910' && line != null && isHalfLine(line)) {
          if (t === '1') keys[`hcp_home_${line}`] = c;
          else if (t === '2') keys[`hcp_away_${-line}`] = c;
        } else if (k === '911' && line != null && isHalfLine(line)) {
          // Doc API : "tip 1 = under, tip 2 = over" - CORRIGE
          if (t === '1') keys[`match_under_${line}`] = c;
          else if (t === '2') keys[`match_over_${line}`] = c;
        } else if (k === '841' && line != null && isHalfLine(line)) {
          if (t === '1') keys[`tt_home_under_${line}`] = c;
          else if (t === '2') keys[`tt_home_over_${line}`] = c;
        } else if (k === '842' && line != null && isHalfLine(line)) {
          if (t === '1') keys[`tt_away_under_${line}`] = c;
          else if (t === '2') keys[`tt_away_over_${line}`] = c;
        } else if (k === '597' && line != null && isHalfLine(line)) {
          if (t === '1') keys[`s1_under_${line}`] = c;
          else if (t === '2') keys[`s1_over_${line}`] = c;
        } else if (k === '988' && line != null && isHalfLine(line)) {
          if (t === '1') keys[`s1_hcp_home_${line}`] = c;
          else if (t === '2') keys[`s1_hcp_away_${-line}`] = c;
        } else if (k === '914' && line != null && isHalfLine(line)) {
          if (t === '1') keys[`hcp_sets_home_${line}`] = c;
          else if (t === '2') keys[`hcp_sets_away_${-line}`] = c;
        } else if (k === '915') {
          if (t === '2') keys.total_sets_2 = c;
          else if (t === '3') keys.total_sets_3 = c;
        }
      }
    }
    bullet(`${m.home} vs ${m.away} [${m.league}]`, keys);
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 4) SPORTYBET — dict mapping applique (12 marches)
// ═══════════════════════════════════════════════════════════════
header('SPORTYBET — dict tennis mapping applique');
try {
  const { listPrematch } = await import('../src/bookmakers/sportybet/list.js');
  const { sbFetchEvent } = await import('../src/bookmakers/sportybet/api.js');
  const matches = await listPrematch({ sport: 'tennis' });
  const sample = matches.slice(0, 2);
  for (const m of sample) {
    // Fetch detail (pas juste __raw car listPrematch filtre les markets par MARKET_IDS foot)
    const detail = await sbFetchEvent(m.id, { live: false });
    const markets = detail?.data?.markets || [];
    const keys = {};
    for (const mk of markets) {
      const id = String(mk.id || '');
      const spec = mk.specifier || '';
      // Parse specifier hcp=X, total=X, setnr=N, setnr=N|hcp=X, setnr=N|total=X
      const parseSpec = (key) => {
        const p = spec.split('|').find(x => x.startsWith(key + '='));
        return p ? parseFloat(p.split('=')[1]) : null;
      };
      const hcp = parseSpec('hcp');
      const total = parseSpec('total');
      const setnr = parseSpec('setnr');
      const setPfx = setnr ? `s${setnr}_` : '';
      for (const oc of (mk.outcomes || [])) {
        const c = parseFloat(oc.odds);
        if (isNaN(c) || c <= 1) continue;
        const ocId = String(oc.id || '');
        // Mapping dict SportyBet tennis
        if (id === '186') { // Winner
          if (ocId === '4') keys.match_1 = c;
          else if (ocId === '5') keys.match_2 = c;
        } else if (id === '187' && hcp != null && isHalfLine(hcp)) { // Game handicap
          if (ocId === '1714') keys[`hcp_home_${hcp}`] = c;
          else if (ocId === '1715') keys[`hcp_away_${-hcp}`] = c;
        } else if (id === '188' && hcp != null) { // Set handicap
          if (ocId === '1714') keys[`hcp_sets_home_${hcp}`] = c;
          else if (ocId === '1715') keys[`hcp_sets_away_${-hcp}`] = c;
        } else if (id === '189' && total != null && isHalfLine(total)) { // Total games
          if (ocId === '12') keys[`match_over_${total}`] = c;
          else if (ocId === '13') keys[`match_under_${total}`] = c;
        } else if (id === '190' && total != null && isHalfLine(total)) { // P1 total
          if (ocId === '12') keys[`tt_home_over_${total}`] = c;
          else if (ocId === '13') keys[`tt_home_under_${total}`] = c;
        } else if (id === '191' && total != null && isHalfLine(total)) { // P2 total
          if (ocId === '12') keys[`tt_away_over_${total}`] = c;
          else if (ocId === '13') keys[`tt_away_under_${total}`] = c;
        } else if (id === '196') { // Exact sets (2 ou 3)
          if (String(oc.id).includes(':32')) keys.total_sets_2 = c;
          else if (String(oc.id).includes(':33')) keys.total_sets_3 = c;
        } else if (id === '198') { // Odd/Even
          if (ocId === '70') keys.odd = c;
          else if (ocId === '72') keys.even = c;
        } else if (id === '202' && setnr) { // Set N winner
          if (ocId === '4') keys[`${setPfx}match_1`] = c;
          else if (ocId === '5') keys[`${setPfx}match_2`] = c;
        } else if (id === '203' && setnr && hcp != null && isHalfLine(hcp)) { // Set N handicap
          if (ocId === '1714') keys[`${setPfx}hcp_home_${hcp}`] = c;
          else if (ocId === '1715') keys[`${setPfx}hcp_away_${-hcp}`] = c;
        } else if (id === '204' && setnr && total != null && isHalfLine(total)) { // Set N total
          if (ocId === '12') keys[`${setPfx}over_${total}`] = c;
          else if (ocId === '13') keys[`${setPfx}under_${total}`] = c;
        } else if (id === '314' && total != null) { // Total sets 2.5
          if (ocId === '12') keys[`total_sets_over_${total}`] = c;
          else if (ocId === '13') keys[`total_sets_under_${total}`] = c;
        }
      }
    }
    bullet(`${m.home} vs ${m.away} [${m.league}]`, keys);
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 5) BETMOMO — dict mapping applique (11 marches)
// ═══════════════════════════════════════════════════════════════
header('BETMOMO — dict tennis mapping applique');
try {
  const { swarmSession } = await import('../src/bookmakers/betmomo/api.js');
  await swarmSession(async (send) => {
    const now = Math.floor(Date.now() / 1000);
    const to = now + 72 * 3600;
    const listData = await send(
      { sport: ['id'], region: ['name'], competition: ['name'], game: ['id', 'team1_name', 'team2_name', 'start_ts'] },
      { sport: { id: 4 }, game: { start_ts: { '@gt': now, '@lt': to }, is_live: 0 } },
    );
    const games = [];
    for (const s of Object.values(listData?.sport || {})) {
      for (const r of Object.values(s.region || {})) for (const c of Object.values(r.competition || {}))
        for (const g of Object.values(c.game || {})) games.push({ ...g, league: c.name });
    }
    // Prendre 2 matchs avec des markets
    let sample = [];
    for (const g of games) {
      if (sample.length >= 2) break;
      const oddsData = await send(
        { game: ['id'], market: ['name', 'type', 'group_name'], event: ['name', 'price', 'base', 'type_1', 'type'] },
        { game: { id: g.id } },
      );
      const withOdds = oddsData?.game?.[g.id];
      const markets = withOdds ? Object.values(withOdds.market || {}) : [];
      if (markets.length > 5) sample.push({ ...g, markets });
    }
    for (const g of sample) {
      const keys = {};
      for (const mk of g.markets) {
        const t = String(mk.type || '');
        const name = String(mk.name || '');
        for (const e of Object.values(mk.event || {})) {
          const price = Number(e.price);
          if (!isFinite(price) || price <= 1) continue;
          const et = String(e.type || '');
          const base = e.base != null && e.base !== '' ? Number(e.base) : null;
          // Mapping dict BetMomo tennis
          if (t === 'P1P2' && name === 'Match Winner') {
            if (et === 'P1') keys.match_1 = price;
            else if (et === 'P2') keys.match_2 = price;
          } else if (t === 'Handicap' && name === 'Games Handicap' && base != null && isHalfLine(base)) {
            if (et === 'Home') keys[`hcp_home_${base}`] = price;
            else if (et === 'Away') keys[`hcp_away_${base}`] = price;
          } else if (t === 'TotalGamesOver/Under' && name === 'Total Games' && base != null && isHalfLine(base)) {
            if (et === 'Over') keys[`match_over_${base}`] = price;
            else if (et === 'Under') keys[`match_under_${base}`] = price;
          } else if (t === "Player1:Player'sTotalofWonGames" && base != null && isHalfLine(base)) {
            if (et === 'Over') keys[`tt_home_over_${base}`] = price;
            else if (et === 'Under') keys[`tt_home_under_${base}`] = price;
          } else if (t === "Player2:Player'sTotalofWonGames" && base != null && isHalfLine(base)) {
            if (et === 'Over') keys[`tt_away_over_${base}`] = price;
            else if (et === 'Under') keys[`tt_away_under_${base}`] = price;
          } else if (t === 'SetHandicap' && name === '1st Set Games Handicap' && base != null && isHalfLine(base)) {
            if (et === 'Home') keys[`s1_hcp_home_${base}`] = price;
            else if (et === 'Away') keys[`s1_hcp_away_${base}`] = price;
          } else if (t === 'SetOverUnder' && name === '1st Set Total Games' && base != null && isHalfLine(base)) {
            if (et === 'Over') keys[`s1_over_${base}`] = price;
            else if (et === 'Under') keys[`s1_under_${base}`] = price;
          } else if (t === 'Sets Handicap' && base != null) {
            if (et === 'Home') keys[`hcp_sets_home_${base}`] = price;
            else if (et === 'Away') keys[`hcp_sets_away_${base}`] = price;
          } else if (t === 'TotalGamesOddorEven') {
            if (et === 'Odd') keys.odd = price;
            else if (et === 'Even') keys.even = price;
          } else if (t === 'SetWinner' && name === '1st Set Winner') {
            if (et === 'Home') keys.s1_match_1 = price;
            else if (et === 'Away') keys.s1_match_2 = price;
          } else if (t === 'TotalofSets' && base != null) {
            if (et === 'Over') keys[`total_sets_over_${base}`] = price;
            else if (et === 'Under') keys[`total_sets_under_${base}`] = price;
          }
        }
      }
      bullet(`${g.team1_name} vs ${g.team2_name} [${g.league}]`, keys);
    }
  });
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 6) PREMIERBET (guineegames) — dict mapping applique (6 marches)
// ═══════════════════════════════════════════════════════════════
header('PREMIERBET (guineegames sportId=5) — dict tennis mapping applique');
try {
  const HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.guineegames.com/',
  };
  const params = 'country=GN&group=g6&platform=desktop&locale=fr';
  const date = new Date().toISOString().slice(0, 10);
  const list = await fetchJson(`https://sports-api.guineegames.com/v1/events/upcoming?${params}&sportId=5&timeOffset=-60&date=${date}`, { headers: HDR, timeoutMs: 20000 });
  const events = [];
  for (const c of (list?.data?.categories || [])) for (const comp of (c.competitions || c.tournaments || [])) for (const e of (comp.events || [])) events.push({ ...e, catName: c.name, compName: comp.name });
  const sample = events.filter(e => (e.marketCount || 0) > 5).slice(0, 2);
  for (const ev of sample) {
    const names = ev.competitors?.map(x => x.name) || ev.eventNames || [];
    const home = names[0] || '?', away = names[1] || '?';
    const evt = await fetchJson(`https://sports-api.guineegames.com/v1/events/${ev.id}?${params}`, { headers: HDR, timeoutMs: 15000 });
    const event = evt?.data || evt;
    const marketGroups = event?.marketGroups || [];
    const keys = {};
    const seenMarketIds = new Set();
    for (const g of marketGroups) {
      for (const mk of (g.markets || [])) {
        const id = String(mk.id || '');
        if (seenMarketIds.has(id + '|' + JSON.stringify(mk.outcomes?.map(o => o.handicap)))) continue;
        seenMarketIds.add(id + '|' + JSON.stringify(mk.outcomes?.map(o => o.handicap)));
        for (const o of (mk.outcomes || [])) {
          const c = parseFloat(o.value);
          if (isNaN(c) || c <= 1) continue;
          const nm = (o.name || '').toLowerCase().trim();
          const h = o.handicap != null ? parseFloat(String(o.handicap).replace(/^\+/, '')) : null;
          // Mapping dict PremierBet tennis
          if (id === '4') { // Gagnant Du Match
            if (nm === '1') keys.match_1 = c;
            else if (nm === '2') keys.match_2 = c;
          } else if (id === '33') { // Gagnant 1er Set
            if (nm === '1') keys.s1_match_1 = c;
            else if (nm === '2') keys.s1_match_2 = c;
          } else if (id === '23' && h != null && isHalfLine(h)) { // Jeux Handicap
            if (nm === '1') keys[`hcp_home_${h}`] = c;
            else if (nm === '2') keys[`hcp_away_${-h}`] = c;
          } else if (id === '64' && h != null && isHalfLine(h)) { // Total games
            if (/plus|over/.test(nm)) keys[`match_over_${h}`] = c;
            else if (/moins|under/.test(nm)) keys[`match_under_${h}`] = c;
          } else if (id === '339' && h != null && isHalfLine(h)) { // Handicap 1er Set
            if (nm === '1') keys[`s1_hcp_home_${h}`] = c;
            else if (nm === '2') keys[`s1_hcp_away_${-h}`] = c;
          } else if (id === '340' && h != null && isHalfLine(h)) { // Total 1er Set
            if (/plus|over/.test(nm)) keys[`s1_over_${h}`] = c;
            else if (/moins|under/.test(nm)) keys[`s1_under_${h}`] = c;
          }
        }
      }
    }
    bullet(`${home} vs ${away} [${ev.catName} / ${ev.compName}]`, keys);
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

console.log('\n═══ FIN VERIF FULL ═══');
