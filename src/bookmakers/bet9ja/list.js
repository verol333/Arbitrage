import { b9Palette, feedD, B9_VERSION } from './api.js';

// Identifiants de sports Bet9ja (palette publique, vérifiée 2026-11-13).
const SPORT_IDS = {
  football: '1', basket: '2', hockey: '4', tennis: '5',
  volleyball: '23', table_tennis: '20', handball: '6',
};

// Les matchs « Players » / « Zoom » (sports 301, 303) sont des jeux virtuels :
// on ne lit que les sports réels listés ci-dessus.

// Bet9ja mélange le foot réel et des championnats SIMULÉS (Simulated Reality
// League, e-soccer). On ne garde que le foot réel.
const VIRTUAL = /simulated|\bSRL\b|e-?soccer|cyber|virtual|esport/i;

const PAL_TTL_MS = 4 * 60_000;
let palCache = { at: 0, data: null };

async function palette() {
  if (palCache.data && Date.now() - palCache.at < PAL_TTL_MS) return palCache.data;
  const data = await b9Palette();
  palCache = { at: Date.now(), data };
  return data;
}

const isoToMs = (s) => {
  const t = Date.parse(String(s || ''));
  return Number.isFinite(t) ? t : null;
};

// Tous les matchs à venir d'un sport, sur l'horizon demandé.
// Bet9ja n'expose pas de flux « matchs du jour » unique : on part des
// compétitions (palette) dont la PROCHAINE rencontre tombe dans l'horizon,
// puis on lit les rencontres de chaque compétition.
export async function listPrematch(sport = 'football', { horizonHours = 72, concurrency = 6 } = {}) {
  const sportId = SPORT_IDS[sport];
  if (!sportId) return [];
  const pal = await palette();
  const node = pal[sportId];
  if (!node) return [];

  const now = Date.now();
  const until = now + horizonHours * 3600_000;
  const groups = [];
  for (const sg of Object.values(node.SG || {})) {
    for (const [groupId, g] of Object.entries((sg && sg.G) || {})) {
      const next = isoToMs(String(g.D || '').replace(' ', 'T') + 'Z');
      if (next == null || next > until) continue;
      if (VIRTUAL.test((sg.SG_DESC || '') + ' ' + (g.G_DESC || ''))) continue;
      groups.push({ groupId, league: (g.G_DESC || '').trim(), region: (sg.SG_DESC || '').trim() });
    }
  }

  const out = [];
  const seen = new Set();
  let cursor = 0;

  const readGroup = async () => {
    while (cursor < groups.length) {
      const group = groups[cursor];
      cursor += 1;
      let D;
      try {
        D = await feedD('GetEventsInGroupV2?GROUPID=' + encodeURIComponent(group.groupId) + '&DISP=0&GROUPMARKETID=1&matches=true&v_cache_version=' + B9_VERSION);
      } catch {
        continue;
      }
      for (const e of Array.isArray(D.E) ? D.E : []) {
        const start = isoToMs(e.STARTDATEUTC);
        if (start == null || start < now - 300_000 || start > until) continue;
        const id = Number(e.ID);
        if (!id || seen.has(id)) continue;
        const label = String(e.DS || '');
        const parts = label.split(/\s+-\s+/);
        if (parts.length < 2) continue;
        seen.add(id);
        out.push({
          id,
          home: parts[0].trim(),
          away: parts.slice(1).join(' - ').trim(),
          league: group.region ? group.region + ' · ' + group.league : group.league,
          start,
          __raw: { groupId: group.groupId, markets: Number(e.MKNUM) || 0 },
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, groups.length) }, readGroup));
  return out.sort((a, b) => a.start - b.start);
}
