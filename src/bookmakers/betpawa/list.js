// Liste des matchs football BetPawa Congo (prématch + live).
// Appelle le CF Worker qui parse le protobuf de cg.betpawa.com.
import { bpGet, isVirtual } from './api.js';

function buildMatch(raw, { withLive = false } = {}) {
  const home = (raw.home || '').trim();
  const away = (raw.away || '').trim();
  if (!home || !away) return null;
  const label = `${home} ${away} ${raw.league || ''}`;
  if (isVirtual(label)) return null;

  const match = {
    id: String(raw.id),
    home,
    away,
    league: raw.league || '',
    start: raw.startTime || null,
    __raw: { markets: raw.markets || {} },
  };
  if (withLive) {
    match.live = {
      score: raw.score || null,
      minute: raw.minute != null ? Number(raw.minute) : null,
      period: null,
    };
  }
  return match;
}

export async function listPrematch({ horizonHours = 72 } = {}) {
  const data = await bpGet({ action: 'list', type: 'upcoming', cat: '2', take: '300' }, { long: true });
  if (!data?.success || !Array.isArray(data.matches)) return [];

  const nowMs = Date.now();
  const horizonMs = nowMs + horizonHours * 3600 * 1000;
  const seen = new Set();
  const out = [];

  for (const raw of data.matches) {
    if (seen.has(raw.id)) continue;
    const m = buildMatch(raw);
    if (!m) continue;
    if (m.start && (m.start <= nowMs + 60_000 || m.start > horizonMs)) continue;
    seen.add(raw.id);
    out.push(m);
  }
  console.log(`[betpawa] prematch kept=${out.length}`);
  return out;
}

export async function listLive() {
  const data = await bpGet({ action: 'list', type: 'live', cat: '2', take: '200' }, { long: false });
  if (!data?.success || !Array.isArray(data.matches)) return [];

  const out = [];
  for (const raw of data.matches) {
    const m = buildMatch(raw, { withLive: true });
    if (m) out.push(m);
  }
  console.log(`[betpawa] live kept=${out.length}`);
  return out;
}

export async function listMatches({ live = false, horizonHours = 72 } = {}) {
  return live ? listLive() : listPrematch({ horizonHours });
}
