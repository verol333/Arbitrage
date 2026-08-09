#!/usr/bin/env node
// PROBE MAXIBET DEEP — trouve pages detail match + dump tous marches
//
// Etapes :
//   1. Fetch listing Soccer via Jina, extraire URLs matchs individuels
//   2. Deviner patterns URL (event/{id}, match/{id}, /fr/sports/event-view/{id}, ...)
//   3. Fetch 2-3 pages detail via Jina, dumper marches complets
//   4. Test formats Jina : text (defaut), markdown, html

async function jina(url, { format = 'text', timeoutMs = 30_000 } = {}) {
  const headers = { Accept: '*/*' };
  if (format === 'markdown') headers['X-Return-Format'] = 'markdown';
  else if (format === 'html') headers['X-Return-Format'] = 'html';
  else headers['X-Return-Format'] = 'text';
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers,
    });
    if (!res.ok) return { status: res.status, body: null };
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, body: null, err: e.message };
  }
}

console.log('▶ MAXIBET DEEP PROBE\n');

// ═══ 1. Listing Soccer — cherche URLs matchs ═══
console.log('══ 1. LISTING (markdown format pour capturer liens) ══');
const listUrl = 'https://m.maxibet.bet/fr/sports/pre-match/event-view/Soccer';
const listMd = await jina(listUrl, { format: 'markdown' });
console.log(`  markdown status=${listMd.status} len=${listMd.body?.length || 0}`);
if (listMd.body) {
  // Cherche liens
  const links = new Set();
  for (const m of listMd.body.matchAll(/\]\(([^)]+)\)/g)) links.add(m[1]);
  for (const m of listMd.body.matchAll(/https?:\/\/[^\s)\]"']+/g)) links.add(m[0]);
  console.log(`  Liens trouves : ${links.size}`);
  const matchLinks = [...links].filter((u) => /event-view|event\/|match\/|game\//.test(u) && !u.includes('Soccer'));
  console.log(`  Liens ressemblant a match : ${matchLinks.length}`);
  matchLinks.slice(0, 15).forEach((u) => console.log(`    - ${u}`));

  // Sample content
  console.log('\n  Sample first 2500 chars markdown:');
  console.log(listMd.body.slice(0, 2500));
}

// ═══ 2. HTML format — cherche links dans href ═══
console.log('\n══ 2. LISTING (html format) ══');
const listHtml = await jina(listUrl, { format: 'html' });
console.log(`  html status=${listHtml.status} len=${listHtml.body?.length || 0}`);
if (listHtml.body) {
  const hrefs = new Set();
  for (const m of listHtml.body.matchAll(/href=["']([^"']+)["']/g)) hrefs.add(m[1]);
  console.log(`  hrefs trouvees : ${hrefs.size}`);
  const eventHrefs = [...hrefs].filter((h) => /event|match|game/i.test(h) && !h.includes('Soccer') && !h.startsWith('#'));
  console.log(`  hrefs event-like (${eventHrefs.length}) :`);
  eventHrefs.slice(0, 20).forEach((h) => console.log(`    - ${h}`));
}

// ═══ 3. Tenter URLs matchs individuels (patterns supposes) ═══
console.log('\n══ 3. PATTERNS URL MATCH INDIVIDUEL ══');
// Extract event IDs si visible dans listing
const idPatterns = new Set();
if (listMd.body) {
  for (const m of listMd.body.matchAll(/\/(\d{6,12})(?:[/?#]|$)/g)) idPatterns.add(m[1]);
}
console.log(`  IDs candidats extraits du listing : ${idPatterns.size} : ${[...idPatterns].slice(0, 5).join(', ')}`);

// Test patterns URL avec un ID (soit trouve, soit devine)
const testIds = idPatterns.size ? [...idPatterns].slice(0, 2) : ['1'];
for (const id of testIds) {
  const patterns = [
    `https://m.maxibet.bet/fr/sports/pre-match/event-view/${id}`,
    `https://m.maxibet.bet/fr/sports/event/${id}`,
    `https://m.maxibet.bet/fr/sports/match/${id}`,
    `https://m.maxibet.bet/fr/event/${id}`,
    `https://m.maxibet.bet/fr/sports/pre-match/${id}`,
  ];
  for (const u of patterns) {
    const r = await jina(u, { format: 'text' });
    const bodySample = r.body ? r.body.slice(0, 100).replace(/\n/g, ' | ') : '';
    console.log(`    status=${r.status} len=${r.body?.length || 0} ${u.slice(-70)} ${bodySample ? '| ' + bodySample : ''}`);
  }
}

// ═══ 4. Listing par ligue (autre voie) ═══
console.log('\n══ 4. PAGES PAR LIGUE (URL structuree) ══');
const leaguePatterns = [
  'https://m.maxibet.bet/fr/sports/pre-match/Soccer',
  'https://m.maxibet.bet/fr/sports/prematch/Soccer',
  'https://m.maxibet.bet/fr/sports/pre-match/tournament-view/Soccer',
  'https://m.maxibet.bet/fr/sports/pre-match/league-view/Soccer',
];
for (const u of leaguePatterns) {
  const r = await jina(u, { format: 'text' });
  console.log(`  status=${r.status} len=${r.body?.length || 0} ${u.slice(-70)}`);
}

console.log('\n▶ Fin.');
process.exit(0);
