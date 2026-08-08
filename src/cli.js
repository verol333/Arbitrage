import { runScan, log } from './scanners/collect.js';

async function sendWebhook(payload) {
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!url) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const bodyStr = JSON.stringify(payload);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret || '' },
      body: bodyStr,
      signal: ctrl.signal,
    });
    let respText = '';
    try { respText = (await res.text()).slice(0, 500); } catch {}
    console.log(`[webhook] sport=${payload.sport} status=${res.status} count=${payload.count} bodySize=${bodyStr.length}B resp="${respText}"`);
  } catch (e) {
    console.warn(`[webhook] sport=${payload.sport} erreur: ${e.message}`);
  } finally { clearTimeout(t); }
}

function logSample(result, { live = false, sport = 'football' } = {}) {
  if (!result.opportunities?.length) return;
  if (live) {
    const first = result.opportunities[0];
    log(`  → live sample: score=${first.live_score ?? 'null'} min=${first.live_minute ?? 'null'} period=${first.live_period ?? 'null'} src=${first.live_score_source ?? 'null'} match=${first.match_label}`);
  }
  const first = result.opportunities[0];
  log(`  → ${sport} sample opp fields: sport=${first.sport} market_family="${first.market_family}" match_label="${first.match_label}" league="${first.league || ''}" status=${first.status} is_live=${first.is_live}`);
}

// Envoi FUSIONNE (foot + tennis dans un seul POST) pour eviter que le 2e
// webhook ecrase les opps du 1er cote backend (bug "un seul sport
// affiche a la fois"). Marker sport="multi" pour que le handler backend
// itere sur opps par .sport individuellement (voir arbitrageWebhook).
async function notifyWebhookMerged(resultsBySport, { live = false } = {}) {
  const merged = [];
  const countsBySport = {};
  for (const [sport, result] of Object.entries(resultsBySport)) {
    const opps = result?.opportunities || [];
    countsBySport[sport] = opps.length;
    if (opps.length) merged.push(...opps);
  }
  if (!merged.length) return;
  // AUDIT distribution : verifie que chaque opp a bien sa cle .sport individuelle.
  // Diagnostic backend : si l'app n'affiche pas basket/tennis, verifier que .sport
  // n'est pas ecrase par root sport='multi' cote insertion Mongo.
  const distribInMerged = {};
  const missingSport = [];
  for (const o of merged) {
    const s = o.sport || 'undefined';
    distribInMerged[s] = (distribInMerged[s] || 0) + 1;
    if (!o.sport) missingSport.push(`${o.leg_a_book}-${o.leg_b_book}:${o.market_family}`);
  }
  const firstBySport = {};
  for (const o of merged) {
    if (o.sport && !firstBySport[o.sport]) {
      firstBySport[o.sport] = `${o.market_family} | ${o.leg_a_book}@${o.leg_a_odd} vs ${o.leg_b_book}@${o.leg_b_odd}`;
    }
  }
  console.log(`[webhook AUDIT] payload count=${merged.length} distrib_in_opportunities=${JSON.stringify(distribInMerged)} counts_by_sport=${JSON.stringify(countsBySport)}`);
  for (const [s, ex] of Object.entries(firstBySport)) console.log(`[webhook AUDIT] first opp sport="${s}": ${ex}`);
  if (missingSport.length) console.log(`[webhook AUDIT] ⚠️ ${missingSport.length} opps sans champ .sport : ${missingSport.slice(0, 3).join(' | ')}`);
  await sendWebhook({
    type: 'arbitrage_alert',
    scan_type: live ? 'live' : 'prematch',
    sport: 'multi',
    sports: Object.keys(countsBySport),
    counts_by_sport: countsBySport,
    timestamp: new Date().toISOString(),
    count: merged.length,
    opportunities: merged,
  });
}

const mode = process.argv[2] || 'prematch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Multi-sport : SCAN_SPORTS="football,tennis" scanne les deux en parallele.
const SPORTS = (process.env.SCAN_SPORTS || 'football').split(',').map(s => s.trim()).filter(Boolean);

async function doScan({ live, sport }) {
  const result = await runScan({
    live, sport,
    minProfit: Number(live ? process.env.MIN_PROFIT_LIVE || 0.5 : process.env.MIN_PROFIT_PREMATCH || 0.5),
    horizonHours: Number(process.env.HORIZON_HOURS || 72),
  });
  logSample(result, { live, sport });
  return result;
}

async function doAllSports({ live }) {
  // Foot + tennis en PARALLELE (pas de priorite : les deux sont equivalents).
  const results = await Promise.allSettled(SPORTS.map(sport => doScan({ live, sport })));
  const totals = {};
  const resultsBySport = {};
  results.forEach((r, i) => {
    const sport = SPORTS[i];
    if (r.status === 'fulfilled') {
      totals[sport] = r.value.opportunities?.length ?? 0;
      resultsBySport[sport] = r.value;
    } else {
      totals[sport] = 'ERR';
      log(`  ⚠️ ${sport} scan erreur: ${r.reason?.message || r.reason}`);
    }
  });
  // UN SEUL webhook fusionne pour eviter que le 2e ecrase le 1er cote backend.
  await notifyWebhookMerged(resultsBySport, { live });
  return totals;
}

if (mode === 'prematch') {
  const durMin = parseInt(process.env.PREMATCH_DURATION_MINUTES || '0', 10);
  if (durMin > 0) {
    const interval = parseInt(process.env.PREMATCH_INTERVAL_MS || '300000', 10);
    const end = Date.now() + durMin * 60 * 1000;
    let cycles = 0;
    log(`▶ Scan PRÉMATCH LOOP sports=[${SPORTS.join(',')}] — boucle ${durMin} min, intervalle ${interval / 1000}s`);
    while (Date.now() < end) {
      try {
        const totals = await doAllSports({ live: false });
        cycles++;
        const summary = Object.entries(totals).map(([s, n]) => `${s}:${n}`).join(' | ');
        log(`  cycle ${cycles}: ${summary}`);
      } catch (e) {
        log(`  cycle ${cycles + 1}: erreur — ${e.message}`);
        cycles++;
      }
      if (end - Date.now() > interval) await sleep(interval);
      else break;
    }
    log(`✅ Prématch loop terminé — ${cycles} cycles (${durMin} min)`);
  } else {
    log(`▶ Scan PRÉMATCH sports=[${SPORTS.join(',')}] (parallele)`);
    const totals = await doAllSports({ live: false });
    const summary = Object.entries(totals).map(([s, n]) => `${s}:${n}`).join(' | ');
    log(`✅ Prématch terminé — ${summary}`);
  }
} else if (mode === 'live') {
  const duration = parseInt(process.env.SCAN_DURATION_MINUTES || '30', 10);
  const interval = parseInt(process.env.LIVE_INTERVAL_MS || '15000', 10);
  const end = Date.now() + duration * 60 * 1000;
  let cycles = 0;
  log(`▶ Scan LIVE sports=[${SPORTS.join(',')}] — boucle ${duration} min, intervalle ${interval / 1000}s`);
  while (Date.now() < end) {
    try {
      const totals = await doAllSports({ live: true });
      cycles++;
      const summary = Object.entries(totals).map(([s, n]) => `${s}:${n}`).join(' | ');
      log(`  cycle ${cycles}: ${summary}`);
    } catch (e) {
      log(`  cycle ${cycles + 1}: erreur — ${e.message}`);
      cycles++;
    }
    if (end - Date.now() > interval) await sleep(interval);
    else break;
  }
  log(`✅ Live terminé — ${cycles} cycles (${duration} min)`);
} else {
  console.error(`Mode inconnu : ${mode}. Utilisez "prematch" ou "live".`);
  process.exit(1);
}
process.exit(0);
