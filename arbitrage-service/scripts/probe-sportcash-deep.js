// Dump complet de getWidgetCentrali et getHomeLandingData pour voir toutes les
// collections d'événements disponibles.
import { xget } from '../../src/bookmakers/sportcash/api.js';

function eventCount(o) {
  if (!o) return 0;
  if (Array.isArray(o)) return o.length;
  if (typeof o !== 'object') return 0;
  return Object.keys(o).length;
}

function summarize(node, depth = 0, path = '') {
  if (!node || depth > 3) return null;
  if (Array.isArray(node)) {
    return {
      _path: path,
      _type: 'array',
      length: node.length,
      sample: node.slice(0, 2).map((v, i) => summarize(v, depth + 1, `${path}[${i}]`)),
    };
  }
  if (typeof node !== 'object') return { _path: path, _type: typeof node, value: node };
  const out = { _path: path, _type: 'object', keys: Object.keys(node) };
  if (depth < 2) {
    out.children = {};
    for (const k of Object.keys(node)) {
      out.children[k] = summarize(node[k], depth + 1, path ? `${path}.${k}` : k);
    }
  }
  return out;
}

(async () => {
  const out = { at: new Date().toISOString() };
  process.stderr.write('[probe] getWidgetCentrali\n');
  const wc = await xget('getWidgetCentrali', {}, 15_000);
  out.getWidgetCentrali = summarize(wc);
  process.stderr.write('[probe] getHomeLandingData\n');
  const hl = await xget('getHomeLandingData', { timezone: '1' }, 15_000);
  out.getHomeLandingData = summarize(hl);
  // Total events by collection.
  const totals = {};
  if (wc) {
    for (const k of Object.keys(wc)) {
      const v = wc[k];
      if (Array.isArray(v)) {
        let total = 0;
        for (const item of v) {
          if (item && Array.isArray(item.avs)) total += item.avs.length;
          else if (item && item.p && item.a) total += 1;
        }
        totals[`WC.${k}`] = { direct: v.length, events_est: total };
      }
    }
  }
  if (hl) {
    for (const k of Object.keys(hl)) {
      const v = hl[k];
      if (Array.isArray(v)) {
        let total = 0;
        for (const item of v) {
          if (item && Array.isArray(item.avs)) total += item.avs.length;
          else if (item && item.p && item.a) total += 1;
        }
        totals[`HL.${k}`] = { direct: v.length, events_est: total };
      }
    }
  }
  out.totals = totals;
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
