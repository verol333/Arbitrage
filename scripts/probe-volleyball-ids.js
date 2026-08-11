#!/usr/bin/env node
// PROBE Volleyball v4 — approches finales par book restant.
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { mget } from '../src/bookmakers/premierbet/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import { API_BASE, ORIGIN, UA, PLATFORM } from '../src/bookmakers/onewin/api.js';

async function probe1winPost() {
  console.log('\n═══ 1win — POST /matches/get-many ═══');
  const now = Math.floor(Date.now() / 1000);
  for (const sid of [5, 6, 7, 12, 22, 25, 27, 34, 36, 78, 100]) {
    try {
      const body = { sportId: sid, startAtFrom: now - 3600, startAtTo: now + 72 * 3600, limit: 20, offset: 0, l: 'en-001', p: PLATFORM };
      const r = await fetch(`${API_BASE}/matches/get-many`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) continue;
      const j = await r.json();
      const items = j?.result?.items || [];
      if (items.length) {
        const leagues = new Set(items.slice(0, 5).map(i => i.tournament?.name || i.league?.name || ''));
        const hasVolley = [...leagues].some(l => /volley/i.test(l));
        const marker = hasVolley ? ' ← VOLLEY!' : '';
        console.log(`  sid=${sid} : ${items.length} matchs — leagues: ${[...leagues].slice(0, 2).join(' | ')}${marker}`);
      }
    } catch (e) {}
  }
}

async function probeApollo397() {
  console.log('\n═══ Apollo sid=397 (docs) ═══');
  const now = new Date().toISOString();
  const to = new Date(Date.now() + 72 * 3600_000).toISOString();
  // Essayer /sport/offer/v3/sports/offer (comme list.js)
  try {
    const path = `/sport/offer/v3/sports/offer?Offset=0&Limit=10&DateFrom=${now}&DateTo=${to}&SportIds=397`;
    const j = await apolloGet(path);
    console.log(`  path=${path.slice(0, 80)}...`);
    console.log(`  Réponse keys: ${Object.keys(j || {}).join(', ')}`);
    const matches = j?.Matches || j?.matches || j?.Data || [];
    console.log(`  ${matches.length} matches`);
    if (matches.length) {
      const first = matches[0];
      console.log(`    sample: "${first?.Home || ''} vs ${first?.Away || ''}" league="${first?.LeagueName || first?.League?.Name || ''}"`);
    }
  } catch (e) { console.log(`  err=${e.message}`); }
  // Tenter aussi le sport list global
  try {
    const j = await apolloGet('/sport/offer/v3/sports');
    if (Array.isArray(j)) {
      const volley = j.filter(s => /volley/i.test(s.Name || ''));
      for (const v of volley) console.log(`  ← FOUND id=${v.Id} name="${v.Name}"`);
      console.log(`  (${j.length} sports total)`);
    }
  } catch (e) {}
}

async function probePremierBetSportsList() {
  console.log('\n═══ PremierBet — decouverte via /sports ═══');
  // Endpoints alternatifs qui listent tous les sports disponibles
  const paths = ['/sports', '/sport/list', '/sport-tree', '/menu/sports'];
  for (const p of paths) {
    try {
      const j = await mget(p, {});
      if (j && (j.data || j.sports || Array.isArray(j))) {
        const arr = j?.data?.sports || j?.data || j?.sports || (Array.isArray(j) ? j : []);
        const norm = Array.isArray(arr) ? arr : Object.values(arr);
        if (norm.length) {
          const volley = norm.filter(s => /volley/i.test(s.name || s.title || ''));
          for (const v of volley) console.log(`  path=${p} ← id=${v.id || v.sportId} name="${v.name || v.title}"`);
          if (!volley.length) console.log(`  path=${p} : ${norm.length} sports, aucun volleyball`);
        }
      }
    } catch (e) {}
  }
  // Fallback : sportIds 100-200
  console.log('  Test range 100-200:');
  for (const sid of [50, 60, 100, 110, 120, 150, 200]) {
    try {
      const j = await mget('/events/highlights', { sportId: sid });
      const catNames = new Set();
      for (const cat of (j?.data?.categories || [])) catNames.add(cat.name || '');
      if (catNames.size) console.log(`    sid=${sid} : cats: ${[...catNames].slice(0, 2).join(', ')}`);
    } catch (e) {}
  }
}

async function probeBetPawaViaSportsAPI() {
  console.log('\n═══ BetPawa — sports API discovery ═══');
  // Essayer les endpoints REST classiques de BetPawa
  const paths = [
    'https://cg.betpawa.com/api/sportsbook/v4/categories',
    'https://cg.betpawa.com/api/sportsbook/v4/sports',
    'https://cg.betpawa.com/api/sportsbook/v4/menu',
    'https://cg.betpawa.com/api/sportsbook/v4/navigation',
    'https://cg.betpawa.com/api/sportsbook/v4/events/categories',
  ];
  const HDR = {
    'x-pawa-brand': 'betpawa-congobrazzaville',
    'x-pawa-language': 'fr',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0',
  };
  for (const url of paths) {
    try {
      const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(10000) });
      console.log(`  ${url.split('v4/')[1]} → ${r.status}`);
      if (r.ok) {
        const j = await r.json();
        const jStr = JSON.stringify(j);
        const volley = jStr.match(/"[a-z0-9_-]*volley[^"]*"/gi);
        if (volley) console.log(`    ← volley matches in body: ${volley.slice(0, 3).join(', ')}`);
        // Chercher un pattern id + volleyball
        const catRegex = /"id"\s*:\s*"?(\d+)"?[^}]{0,150}?"name"\s*:\s*"([^"]*[Vv]olley[^"]*)"/g;
        let m;
        while ((m = catRegex.exec(jStr)) !== null) console.log(`    ← FOUND cat id=${m[1]} name="${m[2]}"`);
      }
    } catch (e) { console.log(`  ${url.split('v4/')[1]} err=${e.message}`); }
  }
}

console.log('▶ PROBE Volleyball v4 (approches finales)\n');
await probe1winPost();
await probeApollo397();
await probePremierBetSportsList();
await probeBetPawaViaSportsAPI();
console.log('\n═══ FIN ═══');
process.exit(0);
