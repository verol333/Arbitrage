import { runScan, log } from './scanners/collect.js';
import { persistOpportunities } from './store/base44.js';

async function sendWebhook(payload) {
  const url = process.env.WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!url) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': secret || '' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    console.log(`[webhook] ${res.status} — ${payload.count} opportunités envoyées`);
  } catch (e) {
    console.warn(`[webhook] erreur: ${e.message}`);
  } finally { clearTimeout(t); }
}

async function notifyWebhook(result, { live = false, sport = 'football' } = {}) {
  if (result.opportunities?.length) {
    if (live) {
      const first = result.opportunities[0];
      log(`  → live sample: score=${first.live_score ?? 'null'} min=${first.live_minute ?? 'null'} period=${first.live_period ?? 'null'} src=${first.live_score_source ?? 'null'} match=${first.match_label}`);
    }
    await sendWebhook({
      type: 'arbitrage_alert',
      scan_type: live ? 'live' : 'prematch',
      sport,
      timestamp: new Date().toISOString(),
      count: result.opportunities.length,
      opportunities: result.opportunities,
      stats: result.stats,
    });
  }
}

const mode = process.argv[2] || 'prematch';
const sports = (process.env.SCAN_SPORTS || 'football').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function doScan({ live, sport }) {
  const result = await runScan({
    live, sport,
    minProfit: Number(live ? process.env.MIN_PROFIT_LIVE || 0.5 : process.env.MIN_PROFIT_PREMATCH || 0.5),
    maxMatches: Number(process.env.MAX_MATCHES || 600),
    horizonHours: Number(process.env.HORIZON_HOURS || 72),
  });
  await persistOpportunities(result.opportunities, { live, sport });
  await notifyWebhook(result, { live, sport });
  return result;
}

async function doMultiSportScan({ live }) {
  let totalOpps = 0;
  const allStats = [];
  for (const sport of sports) {
    try {
      const r = await doScan({ live, sport });
      totalOpps += r.opportunities.length;
      allStats.push({ sport, opps: r.opportunities.length, ms: r.stats.duration_ms });
    } catch (e) {
      log(`⚠️ ${sport}: ${e.message}`);
    }
  }
  return { totalOpps, allStats };
}

if (mode === 'prematch') {
  log(`▶ Scan PRÉMATCH (${sports.join('+')})`);
  const { totalOpps, allStats } = await doMultiSportScan({ live: false });
  const summary = allStats.map((s) => `${s.sport}:${s.opps}(${s.ms}ms)`).join(' | ');
  log(`✅ Prématch terminé — ${totalOpps} opportunités | ${summary}`);
} else if (mode === 'live') {
  const duration = parseInt(process.env.SCAN_DURATION_MINUTES || '30', 10);
  const interval = parseInt(process.env.LIVE_INTERVAL_MS || '15000', 10);
  const end = Date.now() + duration * 60 * 1000;
  let cycles = 0, total = 0;
  log(`▶ Scan LIVE (${sports.join('+')}) — boucle de ${duration} min, intervalle ${interval / 1000}s`);
  while (Date.now() < end) {
    try {
      const { totalOpps } = await doMultiSportScan({ live: true });
      total += totalOpps;
      cycles++;
      log(`  cycle ${cycles}: ${totalOpps} opps`);
    } catch (e) {
      log(`  cycle ${cycles + 1}: erreur — ${e.message}`);
      cycles++;
    }
    if (end - Date.now() > interval) await sleep(interval);
    else break;
  }
  log(`✅ Live terminé — ${total} opportunités en ${cycles} cycles (${duration} min)`);
} else {
  console.error(`Mode inconnu : ${mode}. Utilisez "prematch" ou "live".`);
  process.exit(1);
}
process.exit(0);
