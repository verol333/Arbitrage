// Point d'entrée : monte Express, démarre les planifications, écoute le port Render.
import express from 'express';
import { config } from '../config.js';
import { createRoutes } from './routes.js';
import { startSchedules } from '../cron/schedule.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use('/', createRoutes());

const server = app.listen(config.port, () => {
  console.log(`[arbitrage-service] écoute sur :${config.port} (proxy=${config.proxy.mode})`);
  startSchedules();
});

// Isolation des erreurs process : ne jamais tomber sur une exception dans un book.
process.on('unhandledRejection', (r) => console.warn('unhandledRejection', r?.stack || r));
process.on('uncaughtException', (e) => console.warn('uncaughtException', e?.stack || e));

function shutdown() {
  console.log('[arbitrage-service] arrêt…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
