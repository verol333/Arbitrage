// Parseur BetPawa : à partir du raw stream (array de strings extraites du
// protobuf) et de l'index où le match commence, cherche les blocs de marché
// (1X2 - FT, Total, BTTS…) et extrait leurs cotes.
// Format observé (Worker CF user) :
//   [id, "Home - Away", "Home", "Away", ..., "1X2 - FT", odd1, oddX, odd2, ...]
// Les marchés du même match sont dans les ~30 chaînes suivant l'id.

// Reconnaît un float style "1.85", "10.00", "2.5".
const FLOAT_RE = /^\d+\.\d+$/;

export function betpawaFlatOdds(match) {
  const odds = {};
  if (!match?.__raw?.strings) return odds;
  const strings = match.__raw.strings;
  const start = match.__raw.matchIndex ?? 0;
  // Fenêtre après le match, avant le prochain match (id 8 chiffres) OU +60 strings.
  const end = findMatchEnd(strings, start);
  const window = strings.slice(start, end);

  // Cherche marchés par nom exact/pattern. Copie de la logique Worker CF
  // mais étendue à d'autres marchés que 1X2.
  for (let j = 0; j < window.length; j++) {
    const s = window[j];
    // 1X2 fulltime : 3 floats suivants = home / draw / away
    if (s === '1X2 - FT' || s === '1X2' || s === 'Résultat du match') {
      const nums = collectFloats(window, j + 1, 12, 3);
      if (nums.length === 3) {
        odds.match_1 = nums[0];
        odds.match_X = nums[1];
        odds.match_2 = nums[2];
      }
    }
    // 1X2 1ère mi-temps
    else if (s === '1X2 - 1H' || s === '1X2 1ère MT' || s === '1ère MT - 1X2' || s === 'Mi-temps') {
      const nums = collectFloats(window, j + 1, 12, 3);
      if (nums.length === 3) {
        odds.ht_match_1 = nums[0];
        odds.ht_match_X = nums[1];
        odds.ht_match_2 = nums[2];
      }
    }
    // Double Chance fulltime
    else if (s === 'Double chance' || s === 'Double Chance - FT' || s === 'DC') {
      const nums = collectFloats(window, j + 1, 12, 3);
      if (nums.length === 3) {
        odds.dc_1X = nums[0];
        odds.dc_12 = nums[1];
        odds.dc_X2 = nums[2];
      }
    }
    // BTTS
    else if (s === 'Les deux équipes marquent' || s === 'BTTS' || s === 'Both Teams To Score') {
      const nums = collectFloats(window, j + 1, 8, 2);
      if (nums.length === 2) {
        odds.btts_yes = nums[0];
        odds.btts_no = nums[1];
      }
    }
    // Total Buts (générique — ligne dans le nom du marché ex: "Total - Plus/Moins 2.5")
    else if (/^Total.*(2\.5|1\.5|3\.5)$/i.test(s) || /^\+\/-\s*\d+\.5$/.test(s)) {
      const lineMatch = s.match(/(\d+\.5)/);
      if (lineMatch) {
        const line = Number(lineMatch[1]);
        const nums = collectFloats(window, j + 1, 8, 2);
        if (nums.length === 2) {
          odds[`match_over_${line}`] = nums[0];
          odds[`match_under_${line}`] = nums[1];
        }
      }
    }
  }
  return odds;
}

function findMatchEnd(strings, start) {
  // Cherche le prochain ID 8-10 chiffres qui NE soit pas un market type.
  const MARKET_TYPES = new Set(['3743', '28000810', '28000850']);
  for (let i = start + 4; i < strings.length && i < start + 80; i++) {
    if (/^\d{7,10}$/.test(strings[i]) && !MARKET_TYPES.has(strings[i])) {
      const next = strings[i + 1] || '';
      if (next.includes(' - ') && !/1X2|UP|LIVE/.test(next)) return i;
    }
  }
  return Math.min(strings.length, start + 80);
}

function collectFloats(window, from, maxLookahead, count) {
  const out = [];
  for (let k = from; k < Math.min(from + maxLookahead, window.length); k++) {
    if (FLOAT_RE.test(window[k])) {
      out.push(Number(window[k]));
      if (out.length === count) return out;
    }
  }
  return out;
}
