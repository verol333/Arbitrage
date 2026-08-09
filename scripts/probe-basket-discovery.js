#!/usr/bin/env node
// PROBE BASKET DISCOVERY — trouve le sport ID basket sur les 4 books qui ne
// supportent pas encore le basket : YellowBet, CongoBet, Apollo, PremierBet.
//
// Approche : pour chaque book, on tape les endpoints avec plusieurs sport IDs
// candidats et on regarde si le catalogue retourne des matchs. On identifie
// le bon sport ID + on echantillonne 3 matchs pour montrer le format.

import { evapi as ybEvapi, BASE_URL as YB_BASE } from '../src/bookmakers/yellowbet/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';
import { fetchJson } from '../src/net/fetcher.js';

console.log('▶ PROBE BASKET DISCOVERY — 4 books\n');

// ─────────────────────────────────────────────────────────────────────
// 1. YELLOWBET — sport ID 32 documente dans le commentaire du code (probe v3)
// ─────────────────────────────────────────────────────────────────────
async function probeYellowbet() {
  console.log('══ YELLOWBET ══');
  const candidates = [32]; // Documente dans yellowbet/list.js commentaire
  for (const sid of candidates) {
    const url = `${YB_BASE}/event/GetEvents?skip=0&take=200&count=200`;
    const data = await ybEvapi(url).catch((e) => ({ error: e.message }));
    if (data?.error) { console.log(`  ❌ SID=${sid} : ${data.error}`); continue; }
    const events = Array.isArray(data?.data) ? data.data : [];
    const basket = events.filter((ev) => ev?.sid === sid);
    console.log(`  ✅ SID=${sid} : ${basket.length} matchs basket / ${events.length} total`);
    if (basket.length) {
      for (const ev of basket.slice(0, 3)) {
        console.log(`     - ${ev.h} vs ${ev.a} | ${ev.ln || '?'} | gt=${ev.gt} | id=${ev.id}`);
        // Dump bts (bet types) for the first match to see basket market structure
        if (basket.indexOf(ev) === 0) {
          const bts = Array.isArray(ev.bts) ? ev.bts.slice(0, 8) : [];
          console.log(`       bts sample: [${bts.map((b) => `"${b.n}"`).join(', ')}]`);
        }
      }
    }
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────
// 2. CONGOBET — tester eventCategories avec plusieurs sport IDs
// ─────────────────────────────────────────────────────────────────────
async function probeCongobet() {
  console.log('══ CONGOBET ══');
  // Foot=101, tennis=103. Basket probablement 102 ou 104. On teste range.
  const candidates = [102, 104, 105, 106, 107, 108, 110, 111, 112, 113, 114, 115];
  for (const sid of candidates) {
    const data = await congoJson(`${CONGO_API}eventCategories/${sid}?l=fr`).catch(() => null);
    const cats = Array.isArray(data) ? data : (data?.data || []);
    if (!cats.length) { console.log(`  ❌ SID=${sid} : 0 categories`); continue; }
    // On regarde le nom des categories pour identifier basket
    const catNames = cats.slice(0, 3).map((c) => c.name || c.n || '?').join(' | ');
    console.log(`  🔍 SID=${sid} : ${cats.length} categories | sample: ${catNames}`);
    // Si les categories ressemblent a NBA/EuroLeague/basketball, on approfondit
    if (/basket|nba|euroleague|ligue.*basket/i.test(catNames)) {
      console.log(`     ✅ probable basket ! Test premier evenement...`);
      const firstCat = cats[0];
      if (firstCat?.id) {
        const evs = await congoJson(`${CONGO_API}events?categoryId=${firstCat.id}&l=fr`).catch(() => null);
        const events = Array.isArray(evs) ? evs : (evs?.data || []);
        console.log(`     → ${events.length} events dans "${firstCat.name}"`);
        for (const e of events.slice(0, 2)) {
          console.log(`       - ${e.homeTeamName} vs ${e.awayTeamName} | id=${e.id}`);
        }
      }
    }
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────
// 3. APOLLO — tester /sport/offer/v3/sports/offer?SportIds=X avec range
// ─────────────────────────────────────────────────────────────────────
async function probeApollo() {
  console.log('══ APOLLO ══');
  // Foot=388, tennis=389. Basket probablement dans 390-400.
  const candidates = [387, 390, 391, 392, 393, 394, 395, 396, 397, 398, 399, 400];
  for (const sid of candidates) {
    const data = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=20&SportIds=${sid}`).catch(() => null);
    const matches = data?.Matches || data?.matches || [];
    if (!matches.length) { console.log(`  ❌ SID=${sid} : 0 matchs`); continue; }
    console.log(`  ✅ SID=${sid} : ${matches.length} matchs (dump top 3)`);
    for (const m of matches.slice(0, 3)) {
      console.log(`     - ${m.Home || m.HomeTeamName || '?'} vs ${m.Away || m.AwayTeamName || '?'} | ${m.LeagueName || m.League || '?'} | id=${m.MatchId || m.Id}`);
    }
    // On dump les BasicOffers du 1er match pour voir la structure basket
    const firstId = matches[0]?.MatchId || matches[0]?.Id;
    if (firstId) {
      const detail = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${firstId}`).catch(() => null);
      const offers = detail?.BasicOffers || detail?.Offers || [];
      console.log(`     → ${offers.length} offers sur premier match | sample keys: ${offers.slice(0, 6).map((o) => o.BetTypeKey || o.Name).join(', ')}`);
    }
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────
// 4. PREMIERBET — Scrape.do sur sports-api.premierbet.com/events
// ─────────────────────────────────────────────────────────────────────
async function probePremierbet() {
  console.log('══ PREMIERBET ══');
  // Foot=1, tennis=5. Basket typiquement 2 ou 3 dans SportRadar UOF.
  const candidates = [2, 3, 4];
  const SCRAPE_KEY = process.env.SCRAPE_DO_KEY;
  if (!SCRAPE_KEY) { console.log('  ⚠️ SCRAPE_DO_KEY manquant — skip'); return; }
  const today = new Date().toISOString().slice(0, 10);
  for (const sid of candidates) {
    const target = encodeURIComponent(`https://sports-api.premierbet.com/br/api/v3/events/highlights?sportId=${sid}&limit=50&date=${today}`);
    const url = `https://api.scrape.do/?token=${SCRAPE_KEY}&url=${target}&geoCode=us`;
    const res = await fetchJson(url).catch(() => null);
    const events = res?.data || res?.events || (Array.isArray(res) ? res : []);
    if (!events.length) { console.log(`  ❌ SID=${sid} : 0 events`); continue; }
    console.log(`  ✅ SID=${sid} : ${events.length} events`);
    for (const ev of events.slice(0, 3)) {
      const home = ev.competitors?.[0]?.name || ev.homeName || '?';
      const away = ev.competitors?.[1]?.name || ev.awayName || '?';
      console.log(`     - ${home} vs ${away} | ${ev.competition?.name || ev.leagueName || '?'} | id=${ev.id}`);
    }
  }
  console.log('');
}

await probeYellowbet();
await probeCongobet();
await probeApollo();
await probePremierbet();

console.log('▶ Fin du probe.');
process.exit(0);
