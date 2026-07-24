// Probe winner.bet : détecter l'endpoint qui expose foot/tennis prématch + live.
import { fetchJson } from '../src/net/fetcher.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

async function tryFetch(url, opts = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) },
      body: opts.body,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const ctype = res.headers.get('content-type') || '';
    const text = await res.text();
    return { status: res.status, ctype, size: text.length, sample: text.slice(0, 800), asJson: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  } catch (e) { return { error: e.message }; }
}

const results = {};

// 1. Home
results.home = await tryFetch('https://winner.bet/fr/');
// Extraire les scripts JS référencés
if (results.home?.sample) {
  const scriptMatches = [...results.home.sample.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).slice(0, 10);
  const apiMatches = [...results.home.sample.matchAll(/https?:\/\/[a-zA-Z0-9.-]+\/(api|rest|feed|sport|betting|events|matches)[^\s"'<>]*/gi)].map((m) => m[0]).slice(0, 20);
  results.home.scripts = scriptMatches;
  results.home.api_hints = apiMatches;
}

// 2. Endpoints courants
const guesses = [
  'https://winner.bet/api/sports',
  'https://winner.bet/api/events',
  'https://winner.bet/api/sportsbook/events',
  'https://winner.bet/rest/sports',
  'https://winner.bet/rest/events',
  'https://api.winner.bet/sports',
  'https://api.winner.bet/events',
  'https://sportsbook.winner.bet/api/events',
  'https://winner.bet/api/v1/sports',
  'https://winner.bet/api/v2/events',
  'https://winner.bet/sports-feeds/api/sports',
  'https://sports.winner.bet/api/events',
];
for (const u of guesses) {
  const r = await tryFetch(u);
  if (r.status && r.status < 500) results[u] = { status: r.status, ctype: r.ctype, size: r.size, sample: r.sample.slice(0, 300), json_keys: r.asJson ? Object.keys(r.asJson).slice(0, 10) : null };
}

console.log('=== WINNER PROBE START ===');
console.log(JSON.stringify(results, null, 2));
console.log('=== WINNER PROBE END ===');
process.exit(0);
