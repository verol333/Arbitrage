// BetPawa : les cotes sont déjà pré-parsées dans __raw.odds = [h, x, a] par
// le Cloudflare Worker. On les convertit vers les clés standard du système.
export function betpawaFlatOdds(match) {
  const odds = {};
  const raw = match?.__raw?.odds;
  if (!Array.isArray(raw) || raw.length !== 3) return odds;
  const [home, draw, away] = raw.map(Number);
  if (Number.isFinite(home) && home > 1) odds.match_1 = home;
  if (Number.isFinite(draw) && draw > 1) odds.match_X = draw;
  if (Number.isFinite(away) && away > 1) odds.match_2 = away;
  return odds;
}
