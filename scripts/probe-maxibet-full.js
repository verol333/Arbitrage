#!/usr/bin/env node
// PROBE MAXIBET FULL — dump complet marches sur pages detail match reelles.
// Etapes validees v2 :
//   * /fr/sports/prematch/Soccer (sans tiret) → 41KB (listing complet)
//   * /fr/sports/event/{id}                  → 50KB (page detail)
//   * /fr/sports/match/{id}                  → 50KB (idem)
// Ici on prend les vrais IDs foot depuis le listing puis on dump 2 pages detail.

async function jina(url, { format = 'text', timeoutMs = 45_000 } = {}) {
  const headers = { Accept: '*/*', 'X-Return-Format': format };
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

console.log('▶ MAXIBET FULL PROBE\n');

// ═══ 1. Listing complet /fr/sports/prematch/Soccer ═══
console.log('══ 1. LISTING /fr/sports/prematch/Soccer (text) ══');
const listText = await jina('https://m.maxibet.bet/fr/sports/prematch/Soccer', { format: 'text' });
console.log(`  status=${listText.status} len=${listText.body?.length || 0}`);
if (listText.body) {
  // Compte tokens "vs" ou lignes "V1"/"V2" pour estimer nb matchs
  const v1Count = (listText.body.match(/^V1\s*$/gm) || []).length;
  const dateCount = (listText.body.match(/\d{1,2}\s+(?:jan|fév|mar|avr|mai|juin|juil|août|sep|oct|nov|déc)/gi) || []).length;
  console.log(`  Compteurs : "V1" markers=${v1Count} | "date" markers=${dateCount}`);
  console.log(`\n  Sample first 3000 chars:\n${listText.body.slice(0, 3000)}`);
}

// ═══ 2. Meme URL en markdown pour extraire liens ═══
console.log('\n══ 2. LISTING (markdown pour hrefs) ══');
const listMd = await jina('https://m.maxibet.bet/fr/sports/prematch/Soccer', { format: 'markdown' });
console.log(`  status=${listMd.status} len=${listMd.body?.length || 0}`);
const matchUrls = new Set();
if (listMd.body) {
  // Cherche liens vers /fr/sports/event/{id} ou similaire
  for (const m of listMd.body.matchAll(/https?:\/\/m\.maxibet\.bet\/fr\/sports\/(?:event|match|pre-match\/event-view)\/(\d{6,15})/g)) {
    matchUrls.add(m[0]);
  }
  for (const m of listMd.body.matchAll(/\]\((\/fr\/sports\/(?:event|match|pre-match\/event-view)\/\d{6,15})/g)) {
    matchUrls.add('https://m.maxibet.bet' + m[1]);
  }
  console.log(`  URLs matchs trouvees : ${matchUrls.size}`);
  [...matchUrls].slice(0, 10).forEach((u) => console.log(`    - ${u}`));
}

// ═══ 3. Fetch 2 pages detail (vrais IDs foot) ═══
if (matchUrls.size >= 1) {
  console.log('\n══ 3. PAGES DETAIL MATCH — DUMP COMPLET MARCHES ══');
  const sample = [...matchUrls].slice(0, 2);
  for (const url of sample) {
    console.log(`\n───────── ${url} ─────────`);
    const detail = await jina(url, { format: 'text' });
    console.log(`  status=${detail.status} len=${detail.body?.length || 0}`);
    if (detail.body) {
      console.log(`\n${detail.body.slice(0, 8000)}`);
      if (detail.body.length > 8000) console.log(`\n[... +${detail.body.length - 8000} chars omis]`);
    }
  }
}

// ═══ 4. Backup : test event/id avec un ID que je devine haut foot ═══
if (!matchUrls.size) {
  console.log('\n══ 4. FALLBACK : dump detail page structure ══');
  const testUrl = 'https://m.maxibet.bet/fr/sports/event/1';
  const r = await jina(testUrl, { format: 'text' });
  console.log(`  status=${r.status} len=${r.body?.length || 0}`);
  if (r.body) console.log(r.body.slice(0, 3000));
}

console.log('\n▶ Fin.');
process.exit(0);
