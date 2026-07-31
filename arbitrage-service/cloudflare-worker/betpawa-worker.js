// Cloudflare Worker — BetPawa scraper (cg.betpawa.com).
// Déployer sur Cloudflare Workers (gratuit, 100k req/jour).
// Endpoints :
//   /?action=list&type=upcoming   → matchs prématch football
//   /?action=list&type=live       → matchs live football
//   /?action=scrape               → alias legacy (= list&type=upcoming)
//
// Le worker appelle l'API BetPawa en protobuf, extrait les chaînes lisibles
// du binaire, et reconstruit les matchs avec tous les marchés détectés.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'list';
    const type = url.searchParams.get('type') || 'upcoming';
    const cat = url.searchParams.get('cat') || '2';
    const take = parseInt(url.searchParams.get('take') || '300', 10);

    const HEADERS = {
      'Accept': 'application/x-protobuf',
      'Accept-Language': 'fr-FR,fr;q=0.7',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'x-pawa-brand': 'betpawa-congobrazzaville',
      'x-pawa-language': 'fr',
      'x-device-fingerprint': '3d76d482c5a3e3a0d1374e637fd811bf',
      'Cookie': 'bp_country=CG',
      'Referer': 'https://cg.betpawa.com/events?categoryId=2',
    };

    try {
      const eventType = (action === 'scrape' || type === 'upcoming') ? 'UPCOMING' : 'LIVE';
      const marketTypes = ['3743', '28000810', '28000850'];
      const query = {
        queries: [{
          query: { eventType, categories: [cat], zones: {}, hasOdds: true },
          view: { marketTypes },
          skip: 0,
          take,
        }],
      };
      const betpawaUrl = `https://cg.betpawa.com/api/sportsbook/v4/events/lists/by-queries?q=${encodeURIComponent(JSON.stringify(query))}`;
      const response = await fetch(betpawaUrl, { headers: HEADERS });
      if (!response.ok) {
        return json({ success: false, error: `BetPawa ${response.status}` }, response.status);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return json({ success: true, format: 'json', raw: data });
      }

      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const strings = extractStrings(bytes);
      const matches = parseMatches(strings, eventType === 'LIVE');

      return json({
        success: true,
        timestamp: new Date().toISOString(),
        type: eventType.toLowerCase(),
        totalMatches: matches.length,
        matchesWithOdds: matches.filter(m => Object.keys(m.markets).length > 0).length,
        matches,
      });
    } catch (error) {
      return json({ success: false, error: error.message }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

function extractStrings(bytes) {
  const out = [];
  let cur = '';
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 32 && bytes[i] <= 126) {
      cur += String.fromCharCode(bytes[i]);
    } else {
      if (cur.length > 1) out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.length > 1) out.push(cur.trim());
  return out.filter(s => s.length > 0);
}

const MARKET_IDS = new Set(['3743', '28000810', '28000850']);
const isOdds = (s) => /^\d+\.\d{1,3}$/.test(s) && parseFloat(s) >= 1.01 && parseFloat(s) <= 200;
const isMatchId = (s) => /^\d{7,9}$/.test(s) && !MARKET_IDS.has(s);
const isMatchName = (s) => s.includes(' - ') && !/(1X2|Over|Under|Handicap|Total|Half|Double|Draw|Score|Goals)/.test(s);

function parseMatches(strings, isLive) {
  const matches = [];
  let i = 0;

  while (i < strings.length) {
    if (isMatchId(strings[i])) {
      const id = strings[i];
      const name = strings[i + 1] || '';
      if (isMatchName(name)) {
        const parts = name.split(' - ');
        const home = parts[0] || '';
        const away = parts.slice(1).join(' - ') || '';

        if (home && away && !/\bsrl\b|simulated|esoccer|e-soccer|cyber|virtual|fifa/i.test(name)) {
          const region = strings.slice(i, Math.min(i + 80, strings.length));
          const markets = parseMarkets(region);
          const startTime = findStartTime(region);
          const league = findLeague(strings, i);

          const match = { id, home, away, fullName: name, league, startTime, markets };
          if (isLive) {
            match.score = findScore(region);
            match.minute = findMinute(region);
          }
          matches.push(match);
          i += 4;
          continue;
        }
      }
    }
    i++;
  }
  return matches;
}

function parseMarkets(region) {
  const markets = {};

  for (let j = 0; j < region.length; j++) {
    const s = region[j];

    // 1X2
    if (s === '1X2 - FT' || s === '1X2' || s === 'Match Result') {
      const odds = findNOdds(region, j + 1, 3, 15);
      if (odds.length === 3) {
        markets['1x2'] = odds;
      }
    }
    // Over/Under (Total Goals)
    if (/^(Over\/Under|O\/U|Total|Plus\/Moins|Total Goals)$/i.test(s)) {
      const pairs = findOverUnderPairs(region, j + 1, 20);
      for (const p of pairs) {
        markets[`ou_${p.line}`] = [p.over, p.under];
      }
    }
    // BTTS (GG/NG)
    if (/^(GG\/NG|BTTS|Both Teams|Les deux)/i.test(s)) {
      const odds = findNOdds(region, j + 1, 2, 10);
      if (odds.length === 2) {
        markets['btts'] = odds;
      }
    }
    // Double Chance
    if (/^Double Chance$/i.test(s)) {
      const odds = findNOdds(region, j + 1, 3, 15);
      if (odds.length === 3) {
        markets['dc'] = odds;
      }
    }
    // Draw No Bet
    if (/^(Draw No Bet|DNB|Pari Rembours)/i.test(s)) {
      const odds = findNOdds(region, j + 1, 2, 10);
      if (odds.length === 2) {
        markets['dnb'] = odds;
      }
    }
    // Handicap
    if (/^(Handicap|Asian Handicap|Spread)$/i.test(s)) {
      const hcps = findHandicapPairs(region, j + 1, 20);
      for (const h of hcps) {
        markets[`hcp_${h.line}`] = [h.home, h.away];
      }
    }
    // Odd/Even
    if (/^(Odd\/Even|Pair\/Impair)$/i.test(s)) {
      const odds = findNOdds(region, j + 1, 2, 10);
      if (odds.length === 2) {
        markets['oe'] = odds;
      }
    }
  }
  return markets;
}

function findNOdds(region, start, count, maxLook) {
  const found = [];
  for (let k = start; k < Math.min(start + maxLook, region.length); k++) {
    if (isOdds(region[k])) {
      found.push(parseFloat(region[k]));
      if (found.length === count) break;
    }
    if (isMatchId(region[k]) && found.length === 0) break;
  }
  return found;
}

function findOverUnderPairs(region, start, maxLook) {
  const pairs = [];
  for (let k = start; k < Math.min(start + maxLook, region.length); k++) {
    const s = region[k];
    const lineMatch = s.match(/^(Over|Plus de|Mehr als|\+)\s*(\d+\.5)$/i);
    if (lineMatch) {
      const line = lineMatch[2];
      const overOdds = findNOdds(region, k, 1, 3);
      const underIdx = region.slice(k, k + 6).findIndex(x => /^(Under|Moins de|Weniger als|-)\s*\d+\.5$/i.test(x));
      if (underIdx >= 0 && overOdds.length) {
        const underOdds = findNOdds(region, k + underIdx, 1, 3);
        if (underOdds.length) {
          pairs.push({ line, over: overOdds[0], under: underOdds[0] });
        }
      }
    }
    if (isMatchId(region[k])) break;
  }

  if (!pairs.length) {
    const odds = findNOdds(region, start, 2, maxLook);
    if (odds.length === 2) {
      pairs.push({ line: '2.5', over: odds[0], under: odds[1] });
    }
  }
  return pairs;
}

function findHandicapPairs(region, start, maxLook) {
  const pairs = [];
  for (let k = start; k < Math.min(start + maxLook, region.length); k++) {
    const m = region[k].match(/^([+-]?\d+\.5)$/);
    if (m) {
      const line = m[1];
      const odds = findNOdds(region, k + 1, 2, 6);
      if (odds.length === 2) {
        pairs.push({ line, home: odds[0], away: odds[1] });
        k += 3;
      }
    }
    if (isMatchId(region[k]) && k > start + 2) break;
  }
  return pairs;
}

function findStartTime(region) {
  for (const s of region) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return new Date(s).getTime();
    const ts = parseInt(s, 10);
    if (ts > 1700000000000 && ts < 2000000000000) return ts;
    if (ts > 1700000000 && ts < 2000000000) return ts * 1000;
  }
  return null;
}

function findLeague(strings, matchIdx) {
  for (let k = Math.max(0, matchIdx - 5); k < matchIdx; k++) {
    const s = strings[k];
    if (s.length > 3 && !isMatchId(s) && !isOdds(s) && !/^\d+$/.test(s) && !isMatchName(s)) {
      return s;
    }
  }
  return '';
}

function findScore(region) {
  for (const s of region) {
    if (/^\d{1,2}:\d{1,2}$/.test(s) || /^\d{1,2}-\d{1,2}$/.test(s)) return s.replace(':', '-');
  }
  return null;
}

function findMinute(region) {
  for (const s of region) {
    const m = s.match(/^(\d{1,3})'$/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}
