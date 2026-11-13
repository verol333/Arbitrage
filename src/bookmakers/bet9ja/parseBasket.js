import { isHalfLine } from '../../core/markets.js';

// Bet9ja basketball: regulation 3-way B_1X2 and B_OURT must NEVER be
// compared to the full-match incl-OT markets used by the basket scanner.
// Q4 / second-half / DNB / combos stay unmapped pending settlement review.
const WINNERS = { B_12: ['', {1:'1',2:'2'}], B_1X21T: ['h1_', {'1HT':'1','XHT':'X','2HT':'2'}], B_1Q1X2: ['q1_', {1:'1',X:'X',2:'2'}], B_2Q1X2: ['q2_', {1:'1',X:'X',2:'2'}], B_3Q1X2: ['q3_', {1:'1',X:'X',2:'2'}] };
const TOTALS = { B_OUN:'match_', B_OUH:'tt_home_', B_OUA:'tt_away_', B_1HOU:'h1_', B_OUH11:'h1_tt_home_', B_OUA11:'h1_tt_away_', B_1QOU:'q1_', B_2QOU:'q2_', B_3QOU:'q3_' };
const HANDICAPS = { B_H:'', B_1HH:'h1_', B_1QH:'q1_', B_2QH:'q2_', B_3QH:'q3_' };
const PARITY = { B_OE1T:['h1_', {OD:'odd',EV:'even'}], B_OE1P:['q1_', {OD:'odd',EV:'even'}], B_2QOEP:['q2_', {O:'odd',E:'even'}], B_3QOEP:['q3_', {O:'odd',E:'even'}] };

export function b9BasketKey(sid, def) {
  const tail = sid.slice(def.ID.length);
  const cut = tail.lastIndexOf('_');
  if (cut < 0) return null;
  const sign = tail.slice(cut + 1);
  if (!Array.isArray(def.SGNK) || !def.SGNK.map(String).includes(sign)) return null;
  const winner = WINNERS[def.ID];
  if (winner && !tail.startsWith('@')) return winner[1][sign] ? winner[0]+'match_'+winner[1][sign] : null;
  const parity = PARITY[def.ID];
  if (parity && !tail.startsWith('@')) return parity[1][sign] ? parity[0]+parity[1][sign] : null;
  if (!tail.startsWith('@')) return null;
  const line = Number(tail.slice(1, cut).replace(',', '.'));
  if (!isHalfLine(line)) return null;
  if (TOTALS[def.ID] != null && line >= 0 && (sign === 'O' || sign === 'U')) return TOTALS[def.ID]+(sign === 'O' ? 'over_' : 'under_')+line;
  if (HANDICAPS[def.ID] != null && (sign === '1' || sign === '2')) return HANDICAPS[def.ID]+(sign === '1' ? 'hcp_home_' : 'hcp_away_')+(sign === '1' ? line : -line);
  return null;
}

export function parseB9Basket(D) {
  if (Number(D?.SID) !== 2 && D?.S !== 'Basketball') return { odds:{}, mappedMarkets:[], ignored:0 };
  const defs = (D.MK || []).filter(m=>m?.ID).sort((a,b)=>b.ID.length-a.ID.length);
  const odds = { _ids:{} }, used = new Set();
  let ignored = 0;
  for (const [sid, raw] of Object.entries(D.O || {})) {
    const odd = Number(raw), def = defs.find(m=>sid.startsWith(m.ID+'_') || sid.startsWith(m.ID+'@'));
    const key = def && odd > 1 && Number.isFinite(odd) ? b9BasketKey(sid,def) : null;
    if (!key) { ignored++; continue; }
    if (odds[key] != null) throw new Error('bet9ja_ambiguous_key:'+key);
    odds[key]=odd;
    odds._ids[key]={eventId:Number(D.ID),sid,eventName:D.DS,leagueName:D.GN,startdate:D.STARTDATE,region:D.SG,sport:D.S,market_name_native:def.DS || def.NAME,selection_name_native:def.SGN?.[def.SGNK.map(String).indexOf(sid.slice(sid.lastIndexOf('_')+1))],market_path_native:def.GCAT};
    used.add(def.ID);
  }
  return { odds, mappedMarkets:[...used], ignored };
}
