// Scan prématch football — orchestrateur haut niveau.
import { runScan, log } from './collect.js';
import { state, commitScan } from './state.js';
import { persistOpportunities } from '../store/base44.js';
import { config } from '../config.js';

export async function runPrematchScan(opts = {}) {
  if (state.runningPrematch) { log('⏭️  scan prématch déjà en cours — ignoré'); return { skipped: true }; }
  state.runningPrematch = true;
  try {
    const result = await runScan({
      live: false,
      horizonHours: opts.horizonHours ?? config.scan.horizonHours,
      minProfit: opts.minProfit ?? config.scan.minProfitPrematch,
      maxMatches: opts.maxMatches ?? config.scan.maxMatches,
    });
    commitScan('prematch', result);
    await persistOpportunities(result.opportunities, { live: false });
    return result;
  } catch (e) {
    log(`❌ scan prématch: ${e.message || e}`);
    throw e;
  } finally {
    state.runningPrematch = false;
  }
}
