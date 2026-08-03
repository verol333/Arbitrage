#!/usr/bin/env node
// Verifie le mapping tennis propose en l'appliquant en dry-run sur un match par book
// et en imprimant les cles + valeurs extraites pour validation manuelle.
import { fetchJson } from '../src/net/fetcher.js';

const header = (t) => console.log(`\n${'═'.repeat(20)} ${t} ${'═'.repeat(20)}`);
const bullet = (m, keys) => {
  console.log(`\n  Match : ${m}`);
  console.log(`  Cles extraites (${Object.keys(keys).length}) :`);
  for (const [k, v] of Object.entries(keys).sort()) {
    console.log(`    ${k.padEnd(30)} = ${v}`);
  }
};

// ═══════════════════════════════════════════════════════════════
// 1) APOLLO — mapping propose applique
// ═══════════════════════════════════════════════════════════════
header('APOLLO — verification mapping (Berrettini vs Navone)');
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
      for (const od of (o.Odds || [])) {
        const c = parseFloat(od.Odd);
        if (isNaN(c)) continue;
        const t = String(od.Type || '');
        // Mapping propose
        if (k === '20') { // Match Winner 2-way
          if (t === '1') keys.match_1 = c;
          else if (t === '2') keys.match_2 = c;
        } else if (k === '910' && sbv) { // Game Handicap
          const line = parseFloat(sbv);
          if (t === '1') keys[`hcp_home_${line}`] = c;
          else if (t === '2') keys[`hcp_away_${-line}`] = c;
        } else if (k === '911' && sbv) { // Total Games — 1=Over(hi)/Under(lo) ambigu — a valider
          const line = parseFloat(sbv);
          // Convention foot : t=1 → over, t=2 → under (verifier)
          if (t === '1') keys[`match_over_${line}`] = c;
          else if (t === '2') keys[`match_under_${line}`] = c;
        } else if (k === '841' && sbv) { // Home Total Games — od.Name a "Under"/"Over"
          const line = parseFloat(sbv);
          const nm = (od.Name || '').toLowerCase();
          if (nm.includes('over')) keys[`tt_home_over_${line}`] = c;
          else if (nm.includes('under')) keys[`tt_home_under_${line}`] = c;
        } else if (k === '842' && sbv) { // Away Total Games
          const line = parseFloat(sbv);
          const nm = (od.Name || '').toLowerCase();
          if (nm.includes('over')) keys[`tt_away_over_${line}`] = c;
          else if (nm.includes('under')) keys[`tt_away_under_${line}`] = c;
        }
      }
    }
    bullet(`${m.home} vs ${m.away} [${m.league}]`, keys);
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 2) 1WIN — mapping propose applique
// ═══════════════════════════════════════════════════════════════
header('1WIN — verification mapping');
try {
  const { listPrematch } = await import('../src/bookmakers/onewin/list.js');
  const { fetchOddsWS } = await import('../src/bookmakers/onewin/ws.js');
  const matches = await listPrematch('tennis');
  const sample = matches.slice(0, 2);
  const rawMap = await fetchOddsWS(sample.map(m => m.id));
  for (const m of sample) {
    const groups = rawMap.get(m.id) || rawMap.get(String(m.id)) || {};
    const keys = {};
    for (const [gname, glist] of Object.entries(groups)) {
      const low = gname.toLowerCase().trim();
      const active = (glist || []).filter(o => o?.status === 1 && Number(o.cf) > 1);
      if (low === 'winner') {
        for (const o of active) {
          const n = (o.name || '').toLowerCase();
          if (n === m.home.toLowerCase()) keys.match_1 = Number(o.cf);
          else if (n === m.away.toLowerCase()) keys.match_2 = Number(o.cf);
        }
      } else if (low === 'total') {
        for (const o of active) {
          const mo = (o.name || '').match(/over\s*([\d.]+)/i);
          const mu = (o.name || '').match(/under\s*([\d.]+)/i);
          if (mo) keys[`match_over_${parseFloat(mo[1])}`] = Number(o.cf);
          if (mu) keys[`match_under_${parseFloat(mu[1])}`] = Number(o.cf);
        }
      } else if (low === 'odd/even') {
        for (const o of active) {
          const n = (o.name || '').toLowerCase();
          if (n === 'odd') keys.odd = Number(o.cf);
          else if (n === 'even') keys.even = Number(o.cf);
        }
      }
      // Nth set. Winner/Total/Handicap
      const setMatch = low.match(/^(\d)(?:st|nd|rd|th) set\. (winner|total|handicap|odd\/even)$/);
      if (setMatch) {
        const setN = setMatch[1];
        const kind = setMatch[2];
        const pfx = `s${setN}_`;
        if (kind === 'winner') {
          for (const o of active) {
            const n = (o.name || '').toLowerCase();
            if (n === m.home.toLowerCase()) keys[`${pfx}match_1`] = Number(o.cf);
            else if (n === m.away.toLowerCase()) keys[`${pfx}match_2`] = Number(o.cf);
          }
        } else if (kind === 'total') {
          for (const o of active) {
            const mo = (o.name || '').match(/over\s*([\d.]+)/i);
            const mu = (o.name || '').match(/under\s*([\d.]+)/i);
            if (mo) keys[`${pfx}over_${parseFloat(mo[1])}`] = Number(o.cf);
            if (mu) keys[`${pfx}under_${parseFloat(mu[1])}`] = Number(o.cf);
          }
        } else if (kind === 'handicap') {
          for (const o of active) {
            const mm = (o.name || '').match(/^(.+?)\s+([-+]?[\d.]+)$/);
            if (!mm) continue;
            const player = mm[1].toLowerCase();
            const line = parseFloat(mm[2]);
            if (player === m.home.toLowerCase()) keys[`${pfx}hcp_home_${line}`] = Number(o.cf);
            else if (player === m.away.toLowerCase()) keys[`${pfx}hcp_away_${line}`] = Number(o.cf);
          }
        } else if (kind === 'odd/even') {
          for (const o of active) {
            const n = (o.name || '').toLowerCase();
            if (n === 'odd') keys[`${pfx}odd`] = Number(o.cf);
            else if (n === 'even') keys[`${pfx}even`] = Number(o.cf);
          }
        }
      }
    }
    bullet(`${m.home} vs ${m.away} [${m.league}]`, keys);
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 3) SPORTYBET — mapping propose applique
// ═══════════════════════════════════════════════════════════════
header('SPORTYBET — verification mapping');
try {
  const { listPrematch } = await import('../src/bookmakers/sportybet/list.js');
  const matches = await listPrematch({ sport: 'tennis' });
  const sample = matches.slice(0, 2);
  for (const m of sample) {
    const markets = m.__raw?.markets || [];
    const keys = {};
    for (const mk of markets) {
      const id = String(mk.id || '');
      const specifier = mk.specifier || '';
      // Parse specifier "hcp=-5.5" ou "total=19.5"
      const specVal = specifier.split('=')[1];
      const line = specVal != null ? parseFloat(specVal) : null;
      for (const oc of (mk.outcomes || [])) {
        const c = parseFloat(oc.odds);
        if (isNaN(c) || c <= 1) continue;
        const desc = (oc.desc || oc.description || '').toLowerCase();
        if (id === '186') { // Winner
          if (desc === 'home') keys.match_1 = c;
          else if (desc === 'away') keys.match_2 = c;
        } else if (id === '187' && !isNaN(line)) { // Game handicap
          if (desc.startsWith('home')) keys[`hcp_home_${line}`] = c;
          else if (desc.startsWith('away')) keys[`hcp_away_${-line}`] = c;
        } else if (id === '189' && !isNaN(line)) { // Total games
          if (desc.startsWith('over')) keys[`match_over_${line}`] = c;
          else if (desc.startsWith('under')) keys[`match_under_${line}`] = c;
        } else if (id === '190' && !isNaN(line)) { // Player total games — nom joueur dans mk.desc
          const mkDesc = String(mk.desc || mk.description || '').toLowerCase();
          const isHome = mkDesc.includes(m.home.toLowerCase().split(',')[0]);
          const side = isHome ? 'home' : 'away';
          if (desc.startsWith('over')) keys[`tt_${side}_over_${line}`] = c;
          else if (desc.startsWith('under')) keys[`tt_${side}_under_${line}`] = c;
        }
      }
    }
    bullet(`${m.home} vs ${m.away} [${m.league}]`, keys);
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 4) BETMOMO — mapping propose applique (types P1P2/Handicap/TotalGames)
// ═══════════════════════════════════════════════════════════════
header('BETMOMO — verification mapping');
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
    // Prendre matchs qui ont des markets (skip les 0-markets)
    let sample = [];
    for (const g of games) {
      if (sample.length >= 2) break;
      const oddsData = await send(
        { game: ['id'], market: ['name', 'type', 'group_name'], event: ['name', 'price', 'base', 'type_1', 'type'] },
        { game: { id: g.id } },
      );
      const withOdds = oddsData?.game?.[g.id];
      const markets = withOdds ? Object.values(withOdds.market || {}) : [];
      if (markets.length > 0) sample.push({ ...g, markets });
    }
    for (const g of sample) {
      const keys = {};
      for (const mk of g.markets) {
        const t = String(mk.type || '');
        for (const e of Object.values(mk.event || {})) {
          const price = Number(e.price);
          if (!isFinite(price) || price <= 1) continue;
          const et = String(e.type || e.type_1 || '');
          const base = e.base != null ? Number(e.base) : null;
          if (t === 'P1P2' && mk.name === 'Match Winner') {
            if (et === 'P1' || et === 'W1' || et === '1') keys.match_1 = price;
            else if (et === 'P2' || et === 'W2' || et === '2') keys.match_2 = price;
          } else if (t === 'Handicap' && mk.name === 'Games Handicap' && base != null) {
            // Home base > 0 (favori positive line), Away base < 0
            if (et === 'Home') keys[`hcp_home_${base}`] = price;
            else if (et === 'Away') keys[`hcp_away_${base}`] = price;
          } else if (t === 'TotalGamesOver/Under' && base != null) {
            if (et === 'Over') keys[`match_over_${base}`] = price;
            else if (et === 'Under') keys[`match_under_${base}`] = price;
          } else if (t.startsWith("Player1:Player") && base != null) {
            if (et === 'Over') keys[`tt_home_over_${base}`] = price;
            else if (et === 'Under') keys[`tt_home_under_${base}`] = price;
          } else if (t.startsWith("Player2:Player") && base != null) {
            if (et === 'Over') keys[`tt_away_over_${base}`] = price;
            else if (et === 'Under') keys[`tt_away_under_${base}`] = price;
          }
        }
      }
      bullet(`${g.team1_name} vs ${g.team2_name} [${g.league}]`, keys);
    }
  });
} catch (e) { console.log(`  ERR ${e.message}`); }

// ═══════════════════════════════════════════════════════════════
// 5) PREMIERBET (guineegames sportId=5) — mapping propose applique
// ═══════════════════════════════════════════════════════════════
header('PREMIERBET (guineegames sportId=5) — verification mapping');
try {
  const HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://www.guineegames.com/',
  };
  const params = 'country=GN&group=g6&platform=desktop&locale=fr';
  const date = new Date().toISOString().slice(0, 10);
  const listUrl = `https://sports-api.guineegames.com/v1/events/upcoming?${params}&sportId=5&timeOffset=-60&date=${date}`;
  const listJ = await fetchJson(listUrl, { headers: HDR, timeoutMs: 20000 });
  const events = [];
  for (const c of (listJ?.data?.categories || [])) {
    for (const comp of (c.competitions || c.tournaments || [])) {
      for (const e of (comp.events || [])) events.push({ ...e, catName: c.name, compName: comp.name });
    }
  }
  const sample = events.slice(0, 2);
  for (const ev of sample) {
    const names = ev.competitors?.map(x => x.name) || ev.eventNames || [];
    const home = names[0] || '?', away = names[1] || '?';
    const evtUrl = `https://sports-api.guineegames.com/v1/events/${ev.id}?${params}`;
    const evtJ = await fetchJson(evtUrl, { headers: HDR, timeoutMs: 15000 });
    const event = evtJ?.data || evtJ;
    const marketGroups = event?.marketGroups || [];
    const keys = {};
    // Ne prendre QUE le groupe "Principal" pour eviter doublons
    const principal = marketGroups.find(g => g.name === 'Principal') || marketGroups[0];
    const totalsGroup = marketGroups.find(g => g.name === 'Totals') || { markets: [] };
    const setGroup = marketGroups.find(g => g.name === 'Set') || { markets: [] };
    for (const g of [principal, totalsGroup, setGroup]) {
      for (const mk of (g?.markets || [])) {
        const id = String(mk.id || '');
        for (const o of (mk.outcomes || [])) {
          const c = parseFloat(o.value);
          if (isNaN(c) || c <= 1) continue;
          const nm = (o.name || '').toLowerCase().trim();
          const handicap = o.handicap != null ? parseFloat(String(o.handicap).replace(/^\+/, '')) : null;
          if (id === '4') { // Winner
            if (nm === '1') keys.match_1 = c;
            else if (nm === '2') keys.match_2 = c;
          } else if (id === '33') { // 1st Set Winner
            if (nm === '1') keys.s1_match_1 = c;
            else if (nm === '2') keys.s1_match_2 = c;
          } else if (id === '64' && handicap != null) { // Total games
            if (/plus|over/.test(nm)) keys[`match_over_${handicap}`] = c;
            else if (/moins|under/.test(nm)) keys[`match_under_${handicap}`] = c;
          } else if (id === '23' && handicap != null) { // Handicap
            if (nm === '1') keys[`hcp_home_${handicap}`] = c;
            else if (nm === '2') keys[`hcp_away_${handicap}`] = c;
          } else if (id === '340' && handicap != null) { // 1st Set Total
            if (/plus|over/.test(nm)) keys[`s1_over_${handicap}`] = c;
            else if (/moins|under/.test(nm)) keys[`s1_under_${handicap}`] = c;
          }
        }
      }
    }
    bullet(`${home} vs ${away} [${ev.catName} / ${ev.compName}]`, keys);
  }
} catch (e) { console.log(`  ERR ${e.message}`); }

console.log('\n═══════════════ FIN VERIFICATION ═══════════════');
