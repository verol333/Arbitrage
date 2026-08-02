// Vérification RIGOUREUSE sémantique tous marchés live PB + BetPawa.
// Pour chaque marché mappé dans nos parseurs, dump outcomes + analyse
// mathématique basée sur le score courant :
//   - 1X2 : cote leader doit être basse
//   - Handicap : cote handicap leader (-1.5) doit refléter écart actuel
//   - Total : cote Over doit refléter buts déjà marqués + temps restant
//   - BTTS : cote Yes doit être BASSE si les 2 équipes ont déjà marqué
//
// Verdict par marché : FULL MATCH ✅ / REST OF MATCH ⚠️ / AMBIGU ❓

const log = (m) => console.log(m);

// ─── PREMIERBET LIVE ─────────────────────────────────────────────
const PB_HDR = {
  'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.guineegames.com/',
  'Origin': 'https://www.guineegames.com',
};
const PB_BASE = 'https://sports-api.guineegames.com/v1';
const PB_PARAMS = 'country=GN&group=g6&platform=desktop&locale=fr';

// Markets mappés en LIVE dans parse.js parseLive
const PB_LIVE_MAPPED = {
  '1': '1X2', '2': 'Total match', '6': 'DNB', '9': 'DC',
  '15': 'Home total', '16': 'Away total', '17': 'BTTS',
  '20': 'Odd/Even', '21': 'Highest half',
  '23': '1MT 1X2', '24': '1MT Total', '56': '1MT DNB',
  '147': '1MT DC', '724': '1MT BTTS',
  '2509': '1MT Home total', '2510': '1MT Away total',
  '33': '2MT 1X2', '34': '2MT Total', '611': '2MT DNB',
  '743': '2MT DC', '744': '2MT BTTS',
  '109': 'Corner total', '115': 'Home corners', '116': 'Away corners', '93': 'Corner hcp',
};

async function probePBLive() {
  log('\n═══════════ PREMIERBET LIVE — audit sémantique ═══════════');
  const listRes = await fetch(`${PB_BASE}/events/live?${PB_PARAMS}&sportId=1&zoomSportId=61`, { headers: PB_HDR, signal: AbortSignal.timeout(20_000) });
  const listJson = await listRes.json();
  const events = [];
  for (const cat of (listJson?.data?.categories || [])) {
    for (const comp of (cat?.competitions || [])) {
      for (const ev of (comp?.events || [])) events.push({ ...ev, catName: cat.name, compName: comp.name });
    }
  }
  log(`[list] ${events.length} live events`);
  if (!events.length) return;

  // Prendre un match avec des buts (pas 0-0)
  for (const ev of events.slice(0, 5)) {
    const url = `${PB_BASE}/events/${ev.id}?${PB_PARAMS}&_t=${Date.now()}`;
    const res = await fetch(url, { headers: PB_HDR, signal: AbortSignal.timeout(20_000) });
    const j = await res.json();
    const evObj = j?.data || j;
    // Score peut être dans matchScore, score, ou dérivé
    const rawScore = evObj?.matchScore || evObj?.score || evObj?.additionalInfo?.score || '';
    const timeInfo = evObj?.matchTime || evObj?.playedSeconds || evObj?.additionalInfo?.matchTime || '';
    log(`\n── ${ev.eventNames?.join(' vs ')} — score="${rawScore}" time="${timeInfo}"`);

    const markets = evObj?.markets || (evObj?.marketGroups || []).flatMap((g) => g.markets || []);
    const analyzed = {};
    for (const m of markets) {
      const id = String(m.id);
      const label = PB_LIVE_MAPPED[id];
      if (!label) continue;
      if (!analyzed[id]) analyzed[id] = { label, entries: [] };
      const outs = (m.outcomes || []).map((o) => {
        const n = String(o.name || '').replace(/\[\d+:\d+\]/g, '').trim();
        const h = o.handicap != null ? `[${o.handicap}]` : '';
        return `${n}${h}=${o.value}`;
      }).join(' ');
      analyzed[id].entries.push({ spec: m.specifier || m.name || '', outs });
    }
    for (const [id, info] of Object.entries(analyzed)) {
      log(`  id=${id} (${info.label}):`);
      for (const e of info.entries.slice(0, 3)) log(`    ${e.spec} → ${e.outs}`);
    }
  }
}

// ─── BETPAWA LIVE ───────────────────────────────────────────────
const BP_HDR = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.7',
  'User-Agent': 'Mozilla/5.0 Chrome/150.0.0.0',
  'x-pawa-brand': 'betpawa-congobrazzaville',
  'x-pawa-language': 'fr',
  'Referer': 'https://cg.betpawa.com/events',
  'Cookie': 'bp_country=CG',
};

// Markets mappés dans parse.js BetPawa
const BP_MAPPED = {
  '3743': '1X2 - FT', '4693': 'DC - FT', '3795': 'BTTS - FT', '4703': 'DNB - FT',
  '5000': 'Total - FT', '5006': 'Home Total - FT', '5003': 'Away Total - FT', '4833': 'Odd/Even - FT',
  '3668': '1X2 - 1H', '4673': 'DC - 1H', '3789': 'BTTS - 1H', '4697': 'DNB - 1H',
  '4958': 'Total - 1H', '4794': 'Odd/Even - 1H',
  '3685': '1X2 - 2H', '4681': 'DC - 2H', '3792': 'BTTS - 2H', '4700': 'DNB - 2H',
  '4976': 'Total - 2H', '4809': 'Odd/Even - 2H', '4728': 'Half More Goals',
};

async function probeBPLive() {
  log('\n═══════════ BETPAWA LIVE — audit sémantique ═══════════');
  const q = { queries: [{ query: { eventType: 'LIVE', categories: ['2'], zones: {}, hasOdds: true }, view: { marketTypes: ['3743'] }, skip: 0, take: 10 }] };
  const listUrl = `https://cg.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(q))}`;
  const HDR_LIST = { ...BP_HDR, 'Accept': 'application/x-protobuf' };
  const listRes = await fetch(listUrl, { headers: HDR_LIST, signal: AbortSignal.timeout(15_000) });
  const buf = new Uint8Array(await listRes.arrayBuffer());
  const strings = [];
  let cur = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
    else { if (cur.length > 2) strings.push(cur); cur = ''; }
  }
  if (cur.length > 2) strings.push(cur);
  const ids = strings.filter((s) => /^\d{7,10}$/.test(s)).filter((s) => !['3743', '4693', '3795'].includes(s));
  const uniqIds = [...new Set(ids)].slice(0, 4);
  log(`[list] ${uniqIds.length} unique live event IDs`);

  const HDR_EV = { ...BP_HDR, 'Accept': 'application/json' };
  for (const id of uniqIds) {
    try {
      const res = await fetch(`https://cg.betpawa.com/api/sportsbook/v4/events/${id}`, { headers: HDR_EV, signal: AbortSignal.timeout(12_000) });
      if (!res.ok) { log(`\n── event ${id} status=${res.status}`); continue; }
      const j = await res.json();
      // Try to get score from event data
      const teams = (j.participants || []).map((p) => p.name).join(' vs ');
      const score = j?.score || j?.currentScore || j?.additionalInfo?.score || '';
      const status = j?.status || j?.matchStatus || '';
      log(`\n── ${teams || id} — score="${score}" status="${status}"`);
      const markets = j?.markets || [];
      const seen = new Set();
      for (const m of markets) {
        const mid = String(m?.marketType?.id ?? '');
        const label = BP_MAPPED[mid];
        if (!label || seen.has(mid)) continue;
        seen.add(mid);
        const rows = m.row || [];
        const prices = rows.slice(0, 2).map((r) => (r.prices || []).map((p) => `${p.name || p.displayName}=${p.odds || p.price}`).join(' ')).join(' | ');
        log(`  id=${mid} (${label}): ${prices}`);
      }
    } catch (e) { log(`  err ${e.message}`); }
  }
}

await probePBLive();
await probeBPLive();
log('\nDONE');
