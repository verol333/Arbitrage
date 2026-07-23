// Planification : deux boucles indépendantes.
//   • Prématch : node-cron (défaut */5 * * * *).
//   • Live     : setInterval simple à 15s (aucune synchronisation avec le prématch).
import cron from 'node-cron';
import { config } from '../config.js';
import { runPrematchScan } from '../scanners/prematch.js';
import { runLiveScan } from '../scanners/live.js';

export function startSchedules() {
  console.log(`[cron] prématch = "${config.cron.prematchCron}" | live = toutes les ${config.cron.liveIntervalMs}ms`);

  // Prématch (récurrent).
  if (!cron.validate(config.cron.prematchCron)) {
    console.warn(`[cron] expression invalide : ${config.cron.prematchCron}`);
  } else {
    cron.schedule(config.cron.prematchCron, () => {
      runPrematchScan().catch((e) => console.warn(`[cron] prematch: ${e.message}`));
    });
  }
  // Premier scan prématch dès le démarrage (pas d'attente du premier tick).
  runPrematchScan().catch((e) => console.warn(`[cron] boot prematch: ${e.message}`));

  // Live (boucle indépendante — jamais bloquée par le prématch).
  const tick = () => runLiveScan().catch((e) => console.warn(`[cron] live: ${e.message}`));
  setInterval(tick, config.cron.liveIntervalMs).unref();
  tick();
}
