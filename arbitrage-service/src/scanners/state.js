// État partagé en mémoire des derniers scans (exposé via /health et /opportunities).
export const state = {
  startedAt: Date.now(),
  prematch: { lastAt: null, durationMs: null, count: 0, opportunities: [], stats: null },
  live: { lastAt: null, durationMs: null, count: 0, opportunities: [], stats: null },
  runningPrematch: false,
  runningLive: false,
};

export function commitScan(kind, result) {
  const bucket = state[kind];
  bucket.lastAt = new Date().toISOString();
  bucket.durationMs = result.stats?.duration_ms || null;
  bucket.count = result.opportunities.length;
  bucket.opportunities = result.opportunities.slice(0, 500);
  bucket.stats = result.stats;
}
