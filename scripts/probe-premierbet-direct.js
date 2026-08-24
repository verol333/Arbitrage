#!/usr/bin/env node
// Probe PremierBet Congo API DIRECT (sans proxy, sans CF worker).
// Objectif : verifier si on peut remplacer Guinee Games par le vrai
// PremierBet Congo — plus fidele aux cotes reelles.
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const URL_LIVE = 'https://sports-api.premierbet.com/cg/v1/events/live?country=CG&group=g5&platform=mobile&locale=fr&sportId=1&pageId=63fe10b530a2f04c64fbd643&zoomSportId=61';
const URL_PREMATCH = `https://sports-api.premierbet.com/cg/v1/events/upcoming?country=CG&group=g5&platform=mobile&locale=fr&timeOffset=-60&sportId=1&pageId=63fe10b530a2f04c64fbd643&date=${new Date().toISOString().slice(0,10)}`;
const CF_WORKER = 'https://appolo.alexverol02.workers.dev';

const HEADERS = {
  accept: 'application/json',
  'accept-language': 'fr-FR,fr;q=0.9',
  origin: 'https://www.premierbet.com',
  referer: 'https://www.premierbet.com/',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1',
};

function preview(body) {
  if (!body) return '(vide)';
  return body.replace(/\n/g, ' ').replace(/\s+/g, ' ').slice(0, 400) + (body.length > 400 ? '...' : '');
}
function interpret(status, body) {
  const b = (body || '').toLowerCase();
  if (b.includes('cloudflare') || b.includes('attention required')) return '🔴 CF BLOCK';
  if (status === 403) return '🔴 403 forbidden';
  if (status === 200 && body && body.length > 50) {
    if (body.startsWith('{') || body.startsWith('[')) return '🟢 JSON OK';
    return '⚠️ 200 mais pas JSON';
  }
  return `⚠️ ${status}`;
}

console.log('═══ PremierBet direct probe ═══\n');

for (const [label, url] of [['PREMATCH', URL_PREMATCH], ['LIVE', URL_LIVE]]) {
  console.log(`── ${label} ──`);
  console.log(`URL: ${url}\n`);

  // 1. Direct
  console.log('  [1] Direct GitHub Actions IP :');
  try {
    const t0 = Date.now();
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15_000) });
    const body = await r.text();
    console.log(`      Status: ${r.status} (${Date.now()-t0}ms, ${body.length}b) ${interpret(r.status, body)}`);
    if (r.status === 200) {
      // Compte les matchs si JSON
      try {
        const j = JSON.parse(body);
        const totalMatches = countMatches(j);
        console.log(`      ${totalMatches} matches parsés | keys=${Object.keys(j).slice(0,6).join(',')}`);
      } catch {}
      console.log(`      Preview: ${preview(body)}`);
    } else {
      console.log(`      Preview: ${preview(body)}`);
    }
  } catch (e) {
    console.log(`      ❌ ${e.message}`);
  }

  // 2. CF Worker
  console.log('\n  [2] Via CF Worker :');
  try {
    const proxied = `${CF_WORKER}/?url=${encodeURIComponent(url)}`;
    const t0 = Date.now();
    const r = await fetch(proxied, { signal: AbortSignal.timeout(15_000) });
    const body = await r.text();
    console.log(`      Status: ${r.status} (${Date.now()-t0}ms, ${body.length}b) ${interpret(r.status, body)}`);
    if (r.status === 200) {
      try {
        const j = JSON.parse(body);
        const totalMatches = countMatches(j);
        console.log(`      ${totalMatches} matches parsés`);
      } catch {}
    }
  } catch (e) {
    console.log(`      ❌ ${e.message}`);
  }

  // 3. Webshare
  console.log('\n  [3] Via Webshare US :');
  try {
    const dispatcher = new ProxyAgent('http://tymphgod:gzrvplok7kr8@31.56.127.193:7684');
    const t0 = Date.now();
    const r = await undiciFetch(url, { headers: HEADERS, dispatcher, signal: AbortSignal.timeout(12_000) });
    const body = await r.text();
    console.log(`      Status: ${r.status} (${Date.now()-t0}ms, ${body.length}b) ${interpret(r.status, body)}`);
  } catch (e) {
    console.log(`      ❌ ${e.message}`);
  }

  console.log('');
}

// Compte les matchs dans une structure Premierbet
function countMatches(j) {
  let n = 0;
  const stack = [j];
  while (stack.length) {
    const x = stack.pop();
    if (!x || typeof x !== 'object') continue;
    if (Array.isArray(x)) { for (const e of x) stack.push(e); continue; }
    // Un match Premierbet a typiquement id + teams + markets
    if (x.id && (x.teams || x.competitors || x.competition)) n++;
    for (const k of Object.keys(x)) stack.push(x[k]);
  }
  return n;
}

console.log('Fin probe premierbet direct.');
process.exit(0);
