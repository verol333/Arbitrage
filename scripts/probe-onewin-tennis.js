#!/usr/bin/env node
// Probe 1win tennis : verifier sportIds 12, 4, et autres candidates
import { API_BASE, ORIGIN, UA, PLATFORM } from '../src/bookmakers/onewin/api.js';

async function getMany(sportId) {
  const now = Math.floor(Date.now() / 1000);
  const body = { sportId, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 1000, offset: 0, l: 'en-001', p: PLATFORM };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${API_BASE}/matches/get-many`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = res.ok ? await res.json() : null;
    return data?.result?.items || [];
  } finally { clearTimeout(t); }
}

// Sample lots of sport IDs
const CANDIDATES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35];

console.log('=== Enumerer sportIds 1win ===');
for (const sid of CANDIDATES) {
  const items = await getMany(sid);
  if (items.length > 0) {
    const first = items[0];
    const teams = `${first.homeTeam?.name || first.team1?.name || '?'} vs ${first.awayTeam?.name || first.team2?.name || '?'}`;
    const league = first.tournament?.name || first.league?.name || first.category?.slug || '?';
    console.log(`  sport=${sid}: ${items.length} matchs — ex: "${teams}" (${league})`);
  }
}

console.log('\n=== Chercher sport tennis via category/league keywords ===');
// Fetch tous puis grep
for (const sid of [12, 4, 8, 20, 21]) {
  const items = await getMany(sid);
  const tenMatches = items.filter(m => {
    const s = JSON.stringify(m).toLowerCase();
    return /tennis|atp|wta|itf|challenger|slam/.test(s);
  });
  console.log(`  sport=${sid}: ${items.length} total → ${tenMatches.length} tennis-like`);
  tenMatches.slice(0, 3).forEach(m => {
    const teams = `${m.homeTeam?.name || m.team1?.name || '?'} vs ${m.awayTeam?.name || m.team2?.name || '?'}`;
    console.log(`    ${teams} (${m.tournament?.name || m.league?.name || '?'})`);
  });
}
