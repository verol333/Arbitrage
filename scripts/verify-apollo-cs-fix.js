// VERIFY — après fix 901/902 → 9980/9979, valide que cs_home/away_yes
// matchent bien les cotes réelles Apollo (Description="Clean Sheet ...").
import apollo from '../src/bookmakers/apollo/index.js';
import { apolloGet } from '../src/bookmakers/apollo/api.js';

const matches = await apollo.listMatches({ sport: 'football', live: false });
console.log(`Total foot Apollo: ${matches.length}`);

let ok = 0, ko = 0, missing = 0;
const sample = matches.slice(0, 12);
for (const m of sample) {
  const parsed = await apollo.getOdds(m, { sport: 'football' });
  const raw = await apolloGet(`/sport/offer/v3/match/offers?MatchId=${m.id}`);
  const offers = raw?.Offers || (raw?.BasicOffer ? [raw.BasicOffer] : []);
  const cs9980 = offers.find((o) => Number(o.BetTypeKey) === 9980);
  const cs9979 = offers.find((o) => Number(o.BetTypeKey) === 9979);
  const csHomeYesReal = cs9980?.Odds?.find((o) => o.Type === '1')?.Odd;
  const csAwayYesReal = cs9979?.Odds?.find((o) => o.Type === '1')?.Odd;
  const csHomeYesParsed = parsed?.cs_home_yes;
  const csAwayYesParsed = parsed?.cs_away_yes;
  const homeMatch = Math.abs(Number(csHomeYesParsed) - Number(csHomeYesReal)) < 0.01;
  const awayMatch = Math.abs(Number(csAwayYesParsed) - Number(csAwayYesReal)) < 0.01;
  if (csHomeYesReal == null && csAwayYesReal == null) { missing++; continue; }
  const status = (homeMatch && awayMatch) ? '✅' : '❌';
  if (homeMatch && awayMatch) ok++; else ko++;
  console.log(`  ${status} ${m.home} vs ${m.away}`);
  console.log(`     home yes: parsed=${csHomeYesParsed ?? '—'} real=${csHomeYesReal ?? '—'} ${homeMatch ? '' : '⚠️'}`);
  console.log(`     away yes: parsed=${csAwayYesParsed ?? '—'} real=${csAwayYesReal ?? '—'} ${awayMatch ? '' : '⚠️'}`);
}
console.log(`\nSummary: ok=${ok} ko=${ko} missing=${missing} (sample=${sample.length})`);
process.exit(ko > 0 ? 1 : 0);
