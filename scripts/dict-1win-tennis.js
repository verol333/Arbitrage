#!/usr/bin/env node
// Trouve le VRAI sportId tennis chez 1win (sport=24 est table tennis!)
// Enumere sports 1-60, pour chaque check noms de matchs = ATP/WTA players
import { API_BASE, ORIGIN, UA, PLATFORM } from '../src/bookmakers/onewin/api.js';

async function getMany(sportId) {
  const now = Math.floor(Date.now() / 1000);
  const body = { sportId, startAtFrom: now - 3600, startAtTo: now + 3 * 86400, limit: 100, offset: 0, l: 'en-001', p: PLATFORM };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${API_BASE}/matches/get-many`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/`, 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = res.ok ? await res.json() : null;
    return data?.result?.items || [];
  } catch { return []; }
  finally { clearTimeout(t); }
}

// Joueurs ATP/WTA reference (top 100 approx) pour identifier tennis
const ATP_KEYWORDS = /(djokovic|sinner|alcaraz|zverev|medvedev|rublev|hurkacz|dimitrov|ruud|tsitsipas|fritz|shelton|de minaur|paul|khachanov|humbert|rune|berrettini|griekspoor|jarry|struff|kecmanovic|bublik|monfils|tiafoe|nishikori|nakashima|coric|davidovich|arnaldi|van de zandschulp|djere|thompson|munar|carballes|shapovalov|lehecka|djokovic|nadal|federer|murray)/i;
const WTA_KEYWORDS = /(swiatek|sabalenka|gauff|rybakina|jabeur|pegula|paolini|zheng|krejcikova|vondrousova|kasatkina|ostapenko|linette|azarenka|kudermetova|samsonova|garcia|kalinina|kostyuk|pliskova|halep|wozniacki|kerber|kalinina|bondar)/i;

console.log('═══ Scan sport IDs 1-60 pour trouver VRAI tennis (ATP/WTA) ═══\n');
const results = [];
for (const sid of [4, 5, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 40, 45, 50, 55, 60]) {
  const items = await getMany(sid);
  if (items.length === 0) continue;
  // Analyse noms
  let atpCount = 0, wtaCount = 0;
  const samples = [];
  for (const it of items.slice(0, 20)) {
    const home = it.homeTeam?.name || it.team1?.name || '';
    const away = it.awayTeam?.name || it.team2?.name || '';
    const combined = `${home} ${away}`;
    if (ATP_KEYWORDS.test(combined)) atpCount++;
    if (WTA_KEYWORDS.test(combined)) wtaCount++;
    if (samples.length < 3) samples.push(`${home} vs ${away}`);
  }
  const isTennis = atpCount > 0 || wtaCount > 0;
  const marker = isTennis ? ' ★★★ VRAI TENNIS ★★★' : '';
  console.log(`  sport=${sid.toString().padStart(2)}: ${items.length.toString().padStart(3)} matchs | ATP:${atpCount} WTA:${wtaCount}${marker}`);
  console.log(`    ex: ${samples.join(' | ')}`);
  results.push({ sid, count: items.length, atpCount, wtaCount, samples });
}

const tennisCandidates = results.filter(r => r.atpCount > 0 || r.wtaCount > 0);
console.log(`\n═══ RESUME : ${tennisCandidates.length} sportIds identifies comme TENNIS ATP/WTA ═══`);
for (const r of tennisCandidates) {
  console.log(`  sport=${r.sid}: ${r.count} matchs (${r.atpCount} ATP + ${r.wtaCount} WTA reconnus)`);
}
