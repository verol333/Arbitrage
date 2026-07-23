// Routes HTTP publiques et protégées.
import express from 'express';
import { requireApiSecret } from './auth.js';
import { state } from '../scanners/state.js';
import { runPrematchScan } from '../scanners/prematch.js';
import { runLiveScan } from '../scanners/live.js';
import { bookmakers } from '../bookmakers/index.js';

export function createRoutes() {
  const r = express.Router();

  // Public — sert de ping anti-veille Render.
  r.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime_s: Math.round((Date.now() - state.startedAt) / 1000),
      last_prematch_scan: state.prematch.lastAt,
      last_live_scan: state.live.lastAt,
      last_prematch_count: state.prematch.count,
      last_live_count: state.live.count,
      last_prematch_duration_ms: state.prematch.durationMs,
      last_live_duration_ms: state.live.durationMs,
      bookmakers: bookmakers.map((b) => ({ key: b.key, label: b.label, supports: b.supports })),
    });
  });

  r.use(requireApiSecret);

  r.get('/scan/prematch', async (req, res) => {
    try {
      const result = await runPrematchScan({
        horizonHours: req.query.horizon_hours ? Number(req.query.horizon_hours) : undefined,
        minProfit: req.query.min_profit ? Number(req.query.min_profit) : undefined,
        maxMatches: req.query.max_matches ? Number(req.query.max_matches) : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  r.get('/scan/live', async (req, res) => {
    try {
      const result = await runLiveScan({
        minProfit: req.query.min_profit ? Number(req.query.min_profit) : undefined,
        maxMatches: req.query.max_matches ? Number(req.query.max_matches) : undefined,
      });
      res.json({ ok: true, ...result });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  r.get('/opportunities', (req, res) => {
    const kind = req.query.live === '1' ? 'live' : 'prematch';
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json({
      kind,
      last_at: state[kind].lastAt,
      count: state[kind].count,
      opportunities: state[kind].opportunities.slice(0, limit),
    });
  });

  return r;
}
