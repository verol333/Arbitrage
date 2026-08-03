#!/usr/bin/env node
// Dict Apollo v2 : utiliser IncludeBetTypeNames=true pour recuperer les vrais noms
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

const now = new Date().toISOString();
const dateTo = '2046-01-01T00:00:00.000Z';
const list = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=200&DateFrom=${now}&DateTo=${dateTo}&SportIds=389`);
const allMatches = [];
for (const s of list?.Response || []) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) {
  if (!m.Id || !m.TeamHome || !m.TeamAway) continue;
  allMatches.push({ id: m.Id, home: m.TeamHome, away: m.TeamAway, league: `${c.Name} / ${l.Name}` });
}
console.log(`${allMatches.length} matchs tennis dispos`);

// Fetch 3 matchs avec IncludeBetTypeNames pour voir la structure complete
const sample = allMatches.slice(0, 3);
for (const m of sample) {
  console.log(`\n═══════════ MATCH : ${m.home} vs ${m.away} (${m.league}) ═══════════`);
  const raw = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}&IncludeBetTypeNames=true`);
  if (!raw) { console.log('  ERR pas de reponse'); continue; }

  console.log(`\n  Top-level keys: ${Object.keys(raw).join(', ')}`);
  console.log(`  Description: ${raw.Description}`);
  console.log(`  AdditionalMatchData: ${raw.AdditionalMatchData}`);

  // Chercher tous les champs qui pourraient contenir des noms de BetTypes
  const offers = raw.Offers || (raw.BasicOffer ? [raw.BasicOffer] : []);
  console.log(`\n  ${offers.length} Offers :`);
  // Voir les keys de la 1re offer pour découvrir si BetTypeName est présent
  if (offers[0]) console.log(`  Keys de offer[0]: ${Object.keys(offers[0]).join(', ')}`);

  for (const o of offers) {
    const key = o.BetTypeKey ?? '?';
    // Tester plusieurs field names possibles pour le nom
    const name = o.BetTypeName ?? o.betTypeName ?? o.Name ?? o.name ?? o.BetType?.Name ?? o.BetType?.name ?? '?';
    const sbv = o.Sbv ?? '';
    const outs = (o.Odds || []).slice(0, 3).map(od => `${od.Type}"${od.Name}"=${od.Odd}`).join(' | ');
    console.log(`    BetTypeKey=${key} name="${name}" Sbv=${sbv} → ${outs}`);
  }

  // Chercher aussi les autres champs top-level qui pourraient donner le dict
  for (const k of Object.keys(raw)) {
    if (Array.isArray(raw[k]) && k !== 'Offers') {
      console.log(`\n  Top-level array "${k}" (${raw[k].length} items) :`);
      for (const item of raw[k].slice(0, 3)) console.log(`    ${JSON.stringify(item).slice(0, 250)}`);
    } else if (typeof raw[k] === 'object' && raw[k] !== null && k !== 'BasicOffer') {
      console.log(`\n  Top-level object "${k}" keys: ${Object.keys(raw[k]).slice(0, 8).join(', ')}`);
      // Si BetTypes/Markets, iterer
      if (/BetType|Market|Bettype/.test(k)) {
        console.log(`    Full: ${JSON.stringify(raw[k]).slice(0, 500)}`);
      }
    }
  }
}
