// Persistance des opportunités dans l'entité ArbitrageOpportunity de Base44.
// Si BASE44_API_URL / BASE44_SERVICE_KEY sont vides → no-op silencieux
// (les opportunités restent en mémoire, disponibles via /opportunities).
import { config } from '../config.js';

const ENTITY = 'ArbitrageOpportunity';

function base44Configured() {
  return Boolean(config.base44.apiUrl && config.base44.serviceKey);
}

async function base44Fetch(path, init = {}) {
  const url = `${config.base44.apiUrl.replace(/\/$/, '')}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.base44.serviceKey}`,
        ...(init.headers || {}),
      },
    });
    if (!res.ok) throw new Error(`base44 ${res.status} ${res.statusText}`);
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  } finally { clearTimeout(t); }
}

// Marque les anciennes opportunités comme "stale" avant d'insérer les nouvelles.
async function markStale({ live, sport = 'football' }) {
  if (!base44Configured()) return;
  const filter = { status: 'live', sport, is_live: !!live };
  await base44Fetch(`/entities/${ENTITY}/update-many`, {
    method: 'POST',
    body: JSON.stringify({ filter, update: { status: 'stale' } }),
  }).catch(() => { /* silencieux — si l'API refuse, on ne bloque pas le scan */ });
}

async function bulkCreate(opps) {
  if (!base44Configured() || !opps.length) return;
  for (let i = 0; i < opps.length; i += 50) {
    const chunk = opps.slice(i, i + 50);
    await base44Fetch(`/entities/${ENTITY}/bulk-create`, {
      method: 'POST',
      body: JSON.stringify({ items: chunk }),
    }).catch((e) => console.warn(`base44 bulkCreate: ${e.message}`));
  }
}

export async function persistOpportunities(opps, { live = false, sport = 'football' } = {}) {
  if (!base44Configured()) {
    // TODO: brancher un provider alternatif (Postgres/SQLite) si besoin de persistance
    // sans Base44. Les opportunités restent en mémoire dans scanners/state.js.
    return;
  }
  // IMPORTANT : passer sport → markStale filtre {sport} pour ne pas polluer
  // les autres sports. Sans ce fix, un scan tennis marquait les foot comme
  // stale (defaut 'football') et laissait les anciennes tennis 'live' →
  // accumulation ou disparition selon comment l'app filtre.
  await markStale({ live, sport });
  await bulkCreate(opps);
}
