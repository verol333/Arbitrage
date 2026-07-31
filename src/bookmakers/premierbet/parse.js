// Parseur PremierBet mobile API (markets[] → cotes plates standard).
// Format: market.name = "1X2", outcome.name = "1"/"X"/"2", outcome.value = 2.10
import { isHalfLine } from '../../core/markets.js';

export function premierbetFlatOdds(markets) {
  const odds = {};

  const byName = (m) => {
    const map = {};
    for (const o of (m.outcomes || [])) {
      const v = Number(o.value);
      if (Number.isFinite(v) && v > 1) map[String(o.name || '').trim()] = v;
    }
    return map;
  };

  const lineOf = (m) => {
    const raw = m.specifier ?? m.specialValue ?? m.line ?? m.handicap;
    if (raw == null) return NaN;
    const s = String(raw);
    const match = s.match(/([-+]?\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : NaN;
  };

  const put1x2 = (m, pfx) => {
    const p = byName(m);
    if (p['1']) odds[`${pfx}match_1`] = p['1'];
    if (p['X'] || p['x']) odds[`${pfx}match_X`] = p['X'] || p['x'];
    if (p['2']) odds[`${pfx}match_2`] = p['2'];
  };
  const putDC = (m, pfx) => {
    const p = byName(m);
    if (p['1X'] || p['1x']) odds[`${pfx}dc_1X`] = p['1X'] || p['1x'];
    if (p['12']) odds[`${pfx}dc_12`] = p['12'];
    if (p['X2'] || p['x2']) odds[`${pfx}dc_X2`] = p['X2'] || p['x2'];
  };
  const putBtts = (m, pfx) => {
    const p = byName(m);
    const yes = p['Oui'] || p['Yes'] || p['oui'] || p['yes'];
    const no = p['Non'] || p['No'] || p['non'] || p['no'];
    if (yes) odds[`${pfx}btts_yes`] = yes;
    if (no) odds[`${pfx}btts_no`] = no;
  };
  const putTotal = (m, pfx) => {
    const line = lineOf(m);
    if (!isHalfLine(line)) return;
    const p = byName(m);
    const over = p['Plus'] || p['Over'] || p['plus'] || p['over'] || p['+'];
    const under = p['Moins'] || p['Under'] || p['moins'] || p['under'] || p['-'];
    if (over) odds[`${pfx}over_${line}`] = over;
    if (under) odds[`${pfx}under_${line}`] = under;
  };
  const putHcp = (m, pfx) => {
    const line = lineOf(m);
    if (!isHalfLine(line)) return;
    const p = byName(m);
    if (p['1']) odds[`${pfx}hcp_home_${line}`] = p['1'];
    if (p['2']) odds[`${pfx}hcp_away_${-line}`] = p['2'];
  };
  const putDnb = (m, pfx) => {
    const p = byName(m);
    if (p['1']) odds[`${pfx}dnb_1`] = p['1'];
    if (p['2']) odds[`${pfx}dnb_2`] = p['2'];
  };
  const putOddEven = (m, pfx) => {
    const p = byName(m);
    const odd = p['Impair'] || p['Odd'] || p['impair'] || p['odd'];
    const even = p['Pair'] || p['Even'] || p['pair'] || p['even'];
    if (odd) odds[`${pfx}odd`] = odd;
    if (even) odds[`${pfx}even`] = even;
  };
  const putTeamTotal = (m, side, pfx) => {
    const line = lineOf(m);
    if (!isHalfLine(line)) return;
    const p = byName(m);
    const over = p['Plus'] || p['Over'] || p['+'];
    const under = p['Moins'] || p['Under'] || p['-'];
    if (over) odds[`${pfx}tt_${side}_over_${line}`] = over;
    if (under) odds[`${pfx}tt_${side}_under_${line}`] = under;
  };

  for (const m of markets) {
    const n = (m.name || '').toLowerCase().trim();

    // Full time
    if (/^(1x2|résultat( du match)?|match result)$/i.test(n) && !/mi.temps|half|1[eè]re|2[eè]me/i.test(n)) {
      put1x2(m, ''); continue;
    }
    if (/^double chance$/i.test(n) && !/mi.temps|half|1[eè]re|2[eè]me/i.test(n)) {
      putDC(m, ''); continue;
    }
    if (/^(les deux|both teams? to score|btts|les 2)/i.test(n) && !/mi.temps|half|1[eè]re|2[eè]me/i.test(n)) {
      putBtts(m, ''); continue;
    }
    if (/^(total|plus.*moins|over.*under|nombre de buts)/i.test(n) && !/mi.temps|half|1[eè]re|2[eè]me|domicile|ext[ée]rieur|home|away|corner|carte/i.test(n)) {
      putTotal(m, 'match_'); continue;
    }
    if (/^(handicap|asian handicap)/i.test(n) && !/mi.temps|half|1[eè]re|2[eè]me|corner/i.test(n)) {
      putHcp(m, ''); continue;
    }
    if (/^(draw no bet|match nul remboursé|pari sans nul)/i.test(n) && !/mi.temps|half/i.test(n)) {
      putDnb(m, ''); continue;
    }
    if (/^(pair.*impair|odd.*even|impair.*pair|even.*odd)$/i.test(n) && !/mi.temps|half|corner/i.test(n)) {
      putOddEven(m, ''); continue;
    }
    // Home/away total
    if (/domicile|home/i.test(n) && /total|plus.*moins|over.*under/i.test(n) && !/mi.temps|half|corner/i.test(n)) {
      putTeamTotal(m, 'home', ''); continue;
    }
    if (/ext[ée]rieur|away/i.test(n) && /total|plus.*moins|over.*under/i.test(n) && !/mi.temps|half|corner/i.test(n)) {
      putTeamTotal(m, 'away', ''); continue;
    }

    // 1st half
    if (/^(1x2|résultat)/i.test(n) && /(mi.temps|half|1[eè]re)/i.test(n)) {
      put1x2(m, 'ht_'); continue;
    }
    if (/1[eè]re mi.temps/i.test(n) && /1x2|résultat/i.test(n)) {
      put1x2(m, 'ht_'); continue;
    }
    if (/double chance/i.test(n) && /(mi.temps|half|1[eè]re)/i.test(n)) {
      putDC(m, 'ht_'); continue;
    }
    if (/(les deux|both|btts|les 2)/i.test(n) && /(mi.temps|half|1[eè]re)/i.test(n)) {
      putBtts(m, 'ht_'); continue;
    }
    if (/(total|plus.*moins|over.*under|nombre de buts)/i.test(n) && /(1[eè]re|first|1st)/i.test(n) && !/corner|carte|domicile|ext[ée]rieur/i.test(n)) {
      putTotal(m, 'ht_'); continue;
    }
    if (/(handicap)/i.test(n) && /(mi.temps|half|1[eè]re)/i.test(n) && !/corner/i.test(n)) {
      putHcp(m, 'ht_'); continue;
    }
    if (/(draw no bet|pari sans nul)/i.test(n) && /(mi.temps|half|1[eè]re)/i.test(n)) {
      putDnb(m, 'ht_'); continue;
    }
    if (/(pair.*impair|odd.*even)/i.test(n) && /(mi.temps|half|1[eè]re)/i.test(n) && !/corner/i.test(n)) {
      putOddEven(m, 'ht_'); continue;
    }

    // 2nd half
    if (/^(1x2|résultat)/i.test(n) && /(2[eè]me|second|2nd)/i.test(n)) {
      put1x2(m, 'h2_'); continue;
    }
    if (/2[eè]me mi.temps/i.test(n) && /1x2|résultat/i.test(n)) {
      put1x2(m, 'h2_'); continue;
    }
    if (/double chance/i.test(n) && /(2[eè]me|second|2nd)/i.test(n)) {
      putDC(m, 'h2_'); continue;
    }
    if (/(les deux|both|btts|les 2)/i.test(n) && /(2[eè]me|second|2nd)/i.test(n)) {
      putBtts(m, 'h2_'); continue;
    }
    if (/(total|plus.*moins|over.*under)/i.test(n) && /(2[eè]me|second|2nd)/i.test(n) && !/corner|carte|domicile|ext[ée]rieur/i.test(n)) {
      putTotal(m, 'h2_'); continue;
    }
    if (/(handicap)/i.test(n) && /(2[eè]me|second|2nd)/i.test(n) && !/corner/i.test(n)) {
      putHcp(m, 'h2_'); continue;
    }

    // Corners
    if (/corner/i.test(n) && /(total|plus.*moins|over.*under)/i.test(n) && !/(1[eè]re|first|1st)/i.test(n)) {
      putTotal(m, 'cor_'); continue;
    }
    if (/corner/i.test(n) && /(total|plus.*moins|over.*under)/i.test(n) && /(1[eè]re|first|1st)/i.test(n)) {
      putTotal(m, 'cor_ht_'); continue;
    }
    if (/corner/i.test(n) && /(handicap)/i.test(n)) {
      putHcp(m, 'cor_'); continue;
    }
    if (/corner/i.test(n) && /(pair.*impair|odd.*even)/i.test(n)) {
      putOddEven(m, 'cor_'); continue;
    }
  }
  return odds;
}
