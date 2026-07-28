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

async function notifyWebhookCombined(opps, { live = false } = {}) {
  if (!opps.length) return;
  // Log detaille de chaque opp (tous sports confondus, tries par profit).
  for (const o of opps) {
    const src = o.sport ? `[${o.sport}] ` : '';
    log(`  📊 ${o.profit_pct}% ${src}| ${o.market_family} | ${o.leg_a_book}:${o.leg_a_label}=${o.leg_a_odd} vs ${o.leg_b_book}:${o.leg_b_label}=${o.leg_b_odd} | ${o.match_label}`);
  }
  // Un seul payload combine tous les sports. Chaque opp porte son 'sport'.
  // sports_included expose la liste des sports presents pour l'app.
  const sportsIn = [...new Set(opps.map((o) => o.sport).filter(Boolean))];
  await sendWebhook({
    type: 'arbitrage_alert',
    scan_type: live ? 'live' : 'prematch',
    sport: sportsIn.length === 1 ? sportsIn[0] : 'multi',
    sports_included: sportsIn,
    timestamp: new Date().toISOString(),
    count: opps.length,
    opportunities: opps,
  });
}

const mode = process.argv[2] || 'prematch';
const sports = (process.env.SCAN_SPORTS || 'football').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Scan un seul sport : runScan + persistence (webhook envoye plus tard,
// AGREGE avec les autres sports pour eviter que l'app ecrase les payloads).
async function doScan({ live, sport }) {
  const result = await runScan({
    live, sport,
    minProfit: Number(live ? process.env.MIN_PROFIT_LIVE || 0.5 : process.env.MIN_PROFIT_PREMATCH || 0.5),
    maxMatches: Number(process.env.MAX_MATCHES || 600),
    horizonHours: Number(process.env.HORIZON_HOURS || 72),
  });
  await persistOpportunities(result.opportunities, { live, sport });
  return result;
}

async function doMultiSportScan({ live }) {
  // Scan tous les sports en PARALLELE (foot + tennis + ...). Chaque sport a
  // sa propre pipeline independante → aucun sport ne bloque un autre.
  const results = await Promise.allSettled(
    sports.map(async (sport) => {
      const r = await doScan({ live, sport });
      return { sport, opps: r.opportunities, ms: r.stats.duration_ms, stats: r.stats };
    }),
  );
  const allOpps = [];
  const allStats = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      allOpps.push(...r.value.opps);
      allStats.push({ sport: r.value.sport, opps: r.value.opps.length, ms: r.value.ms });
    } else {
      log(`⚠️ ${sports[i]}: ${r.reason?.message || r.reason}`);
    }
  }
  // UN SEUL webhook pour TOUS les sports → l'app ne peut pas ecraser un
  // sport par un autre. Chaque opp porte son propre 'sport' dans son objet.
  if (allOpps.length) {
    const trie = allOpps.slice().sort((a, b) => (b.profit_pct || 0) - (a.profit_pct || 0));
    await notifyWebhookCombined(trie, { live });
  }
  return { totalOpps: allOpps.length, allStats };
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
