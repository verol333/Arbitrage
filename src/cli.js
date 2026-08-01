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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sport = 'football';

async function doScan({ live }) {
  const result = await runScan({
    live, sport,
    minProfit: Number(live ? process.env.MIN_PROFIT_LIVE || 0.5 : process.env.MIN_PROFIT_PREMATCH || 0.5),
    horizonHours: Number(process.env.HORIZON_HOURS || 72),
  });
  await persistOpportunities(result.opportunities, { live, sport });
  await notifyWebhook(result, { live, sport });
  return result;
}

if (mode === 'prematch') {
  log(`▶ Scan PRÉMATCH football`);
  const r = await doScan({ live: false });
  log(`✅ Prématch terminé — ${r.opportunities.length} opportunités | ${r.stats.duration_ms}ms`);
} else if (mode === 'live') {
  const duration = parseInt(process.env.SCAN_DURATION_MINUTES || '30', 10);
  const interval = parseInt(process.env.LIVE_INTERVAL_MS || '15000', 10);
  const end = Date.now() + duration * 60 * 1000;
  let cycles = 0, total = 0;
  log(`▶ Scan LIVE football — boucle de ${duration} min, intervalle ${interval / 1000}s`);
  while (Date.now() < end) {
    try {
      const r = await doScan({ live: true });
      total += r.opportunities.length;
      cycles++;
      log(`  cycle ${cycles}: ${r.opportunities.length} opps`);
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
