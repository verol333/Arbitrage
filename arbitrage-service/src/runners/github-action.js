// Point d'entrée GitHub Actions — remplace Express par un scan one-shot ou une
// boucle live de durée configurable (SCAN_DURATION_MINUTES).
// Usage : node src/runners/github-action.js prematch
//         node src/runners/github-action.js live
import { runScan, log } from '../scanners/collect.js';
import { persistOpportunities } from '../store/base44.js';
import { notifyScan } from '../notify/webhook.js';

const mode = process.argv[2] || 'prematch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scanAndNotify({ live }) {
  const result = await runScan({
    live,
    minProfit: live
      ? Number(process.env.MIN_PROFIT_LIVE || 0.5)
      : Number(process.env.MIN_PROFIT_PREMATCH || 0.5),
    maxMatches: Number(process.env.MAX_MATCHES || 400),
    horizonHours: Number(process.env.HORIZON_HOURS || 72),
  });
  await persistOpportunities(result.opportunities, { live });
  await notifyScan(result, { live });
  return result;
}

if (mode === 'prematch') {
  log('▶ Scan PRÉMATCH (one-shot)');
  const r = await scanAndNotify({ live: false });
  log(`✅ Prématch terminé — ${r.opportunities.length} opportunités, ${r.stats.duration_ms}ms`);

} else if (mode === 'live') {
  const durationMin = parseInt(process.env.SCAN_DURATION_MINUTES || '30', 10);
  const intervalMs = parseInt(process.env.LIVE_INTERVAL_MS || '15000', 10);
  const endTime = Date.now() + durationMin * 60 * 1000;
  let cycles = 0, totalFound = 0;

  log(`▶ Scan LIVE — boucle de ${durationMin} min, intervalle ${intervalMs / 1000}s`);
  while (Date.now() < endTime) {
    try {
      const r = await scanAndNotify({ live: true });
      totalFound += r.opportunities.length;
      cycles++;
      log(`  cycle ${cycles}: ${r.opportunities.length} opps (${r.stats.duration_ms}ms)`);
    } catch (e) {
      log(`  cycle ${cycles + 1}: erreur — ${e.message}`);
      cycles++;
    }
    const remaining = endTime - Date.now();
    if (remaining > intervalMs) await sleep(intervalMs);
    else break;
  }
  log(`✅ Live terminé — ${totalFound} opportunités en ${cycles} cycles (${durationMin} min)`);

} else {
  console.error(`Mode inconnu : ${mode}. Utilisez "prematch" ou "live".`);
  process.exit(1);
}

process.exit(0);
