// Probe Apollo tennis avec les bons noms de champs (BetTypeKey/Sbv).
import { apolloGet } from '../../src/bookmakers/apollo/api.js';

(async () => {
  const out = { book: 'apollo', sport: 389, at: new Date().toISOString() };
  const now = new Date().toISOString();
  const j = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=10&DateFrom=${now}&DateTo=2046-04-07T22:59:59.000Z&SportIds=389`);
  const matches = [];
  for (const s of (j?.Response || [])) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) {
    matches.push({ id: m.Id, home: m.TeamHome, away: m.TeamAway, league: `${c.Name}/${l.Name}` });
    if (matches.length >= 1) break; // 1 match seulement pour rentrer dans les logs
  }
  out.matches = matches;
  out.dumps = [];
  for (const m of matches) {
    const details = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}`);
    const offers = details?.Offers && details.Offers.length ? details.Offers : (details?.BasicOffer ? [details.BasicOffer] : []);
    // Group by BetTypeKey — count offers per key + samples
    const byKey = {};
    for (const o of offers) {
      const key = o.BetTypeKey ?? '?';
      if (!byKey[key]) byKey[key] = { BetTypeKey: key, count: 0, Sbv_samples: new Set(), Odds_samples: [] };
      byKey[key].count++;
      if (o.Sbv != null) byKey[key].Sbv_samples.add(o.Sbv);
      if (byKey[key].Odds_samples.length < 4) {
        for (const od of (o.Odds || [])) {
          byKey[key].Odds_samples.push({ Type: od.Type, Name: od.Name, Odd: od.Odd });
          if (byKey[key].Odds_samples.length >= 4) break;
        }
      }
    }
    const flat = Object.values(byKey).map((e) => ({
      BetTypeKey: e.BetTypeKey, count: e.count,
      Sbv_samples: [...e.Sbv_samples].slice(0, 5),
      Odds_samples: e.Odds_samples,
    }));
    out.dumps.push({ match: m, offers_count: offers.length, unique_bettype_keys: flat.length, by_bettype: flat });
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
