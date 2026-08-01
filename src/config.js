// Lecture centralisée des variables d'environnement (pas de secrets en dur).
const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const config = {
  port: num(process.env.PORT, 10000),
  apiSecretKey: process.env.API_SECRET_KEY || '',

  proxy: {
    mode: (process.env.PROXY_MODE || 'jina').toLowerCase(),
    jinaKey: process.env.JINA_API_KEY || '',
    residentialUrl: process.env.RESIDENTIAL_PROXY_URL || '',
    cfworkerUrl: process.env.CF_WORKER_PROXY_URL || '',
    cacheTtlMs: num(process.env.PROXY_CACHE_TTL_MS, 75_000),
    maxConcurrency: num(process.env.PROXY_MAX_CONCURRENCY, 12),
  },

  base44: {
    apiUrl: process.env.BASE44_API_URL || '',
    serviceKey: process.env.BASE44_SERVICE_KEY || '',
  },

  scan: {
    minProfitPrematch: num(process.env.MIN_PROFIT_PREMATCH, 0.5),
    minProfitLive: num(process.env.MIN_PROFIT_LIVE, 0.5),
    // Cap 15% : les vraies arbs foot prématch dépassent rarement 5-8%. Au-delà
    // c'est presque toujours un fake arb dû à orientation home/away inversée
    // entre books (ex: PremierBet cote 12.5 sur match_2 alors que betmomo cote
    // 1.51 sur match_1 pour le même match). Filet de sécurité universel.
    maxProfitSanity: num(process.env.MAX_PROFIT_SANITY, 15),
    maxMatches: num(process.env.MAX_MATCHES, 400),
    horizonHours: num(process.env.HORIZON_HOURS, 72),
  },

  cron: {
    prematchCron: process.env.CRON_PREMATCH || '*/5 * * * *',
    liveIntervalMs: num(process.env.LIVE_INTERVAL_MS, 15_000),
  },
};
