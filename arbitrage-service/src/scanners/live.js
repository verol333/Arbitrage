// Scan live football — indépendant du prématch (jamais bloqué par lui, cf. state.runningLive).
import { runScan, log } from './collect.js';
import { state, commitScan } from './state.js';
import { persistOpportunities } from '../store/base44.js';
import { config } from '../config.js';

export async function runLiveScan(opts = {}) {
  if (state.runningLive) { log('⏭️  scan live déjà en cours — ignoré'); return { skipped: true }; }
  state.runningLive = true;
  try {
    const result = await runScan({
      live: true,
      minProfit: opts.minProfit ?? config.scan.minProfitLive,
      maxMatches: opts.maxMatches ?? 100,
    });
    commitScan('live', result);
    await persistOpportunities(result.opportunities, { live: true });
    return result;
  } catch (e) {
    log(`❌ scan live: ${e.message || e}`);
    throw e;
  } finally {
    state.runningLive = false;
  }
}
