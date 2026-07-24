// Probe Apollo tennis uniquement (pour ne pas dépasser tail_lines).
import { apolloGet } from '../../src/bookmakers/apollo/api.js';

(async () => {
  const out = { book: 'apollo', sport: 389, at: new Date().toISOString() };
  const now = new Date().toISOString();
  const j = await apolloGet(`/sport/offer/v3/sports/offer?Offset=0&Limit=10&DateFrom=${now}&DateTo=2046-04-07T22:59:59.000Z&SportIds=389`);
  const matches = [];
  for (const s of (j?.Response || [])) for (const c of s.Categories || []) for (const l of c.Leagues || []) for (const m of l.Matches || []) {
    matches.push({ id: m.Id, home: m.TeamHome, away: m.TeamAway, league: `${c.Name}/${l.Name}` });
    if (matches.length >= 2) break;
  }
  out.matches = matches;
  out.dumps = [];
  for (const m of matches) {
    const details = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}`);
    const offers = details?.Offers && details.Offers.length ? details.Offers : (details?.BasicOffer ? [details.BasicOffer] : []);
    const simple = offers.map((o) => ({
      BetTypeId: o.BetTypeId, BetTypeName: o.BetTypeName,
      Argument: o.Argument, SpecialValue: o.SpecialValue,
      Odds: (o.Odds || o.SubOffers || []).slice(0, 6).map((x) => ({
        Id: x.Id, Name: x.Name, TipTypeName: x.TipTypeName, Value: x.Value ?? x.Odd,
      })),
    }));
    out.dumps.push({ match: m, offers_count: offers.length, offers: simple });
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
