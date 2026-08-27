// Generation de codes coupons (booking codes) pour verifier une jambe a la main.
// Meme contrat que shared/couponBooks.ts de l'app : on route sur `book` et on
// consomme les identifiants natifs tels quels.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BOOKS = {
  congobet: {
    url: 'https://hg-betting-api-prod.sporty-tech.net/api/betting/get-my-code',
    headers: { 'content-type': 'application/json', origin: 'https://www.congobet.net', referer: 'https://www.congobet.net/sports' },
    body: (c) => {
      const odds = Number(c.price) || 1;
      return {
        totalOdds: odds, eventBetTypeItemIds: [c.eventBetTypeItemId], betCategory: 'SportsFixedOdds',
        betSystemType: 'Simple', drawGameSelections: [], manualOddsBoostIds: [], oddsBoostIds: [],
        maxPayout: Math.round(odds * 50), stakePerLine: [50], totalStake: 50, hasBetBuilderBetLines: false,
      };
    },
    code: (d) => d?.code ?? d?.myCode ?? d?.couponCode,
  },
  betpawa: {
    url: 'https://cg.betpawa.com/api/sportsbook/v3/booking-number',
    headers: { 'content-type': 'application/json', 'x-pawa-brand': 'betpawa-congobrazzaville', 'x-pawa-language': 'fr' },
    body: (c) => ({ selections: { selections: [{ type: 'COMBO', selections: [Number(c.priceId)] }] } }),
    code: (d) => d?.bookingNumber ?? d?.shareCode ?? d?.code ?? d?.id,
  },
  '1win': {
    url: 'https://api-gateway.top-parser.com/shared-bets/create',
    headers: {
      'content-type': 'application/json', origin: 'https://1win.com', referer: 'https://1win.com/',
      'x-external-partner-id': '44ba10e5-7df2-47ab-a44d-dc93803c7a6e', 'x-lang': 'fr-CI', 'x-user-location': 'cg',
    },
    body: (c) => ({ coupons: [{ oddId: String(c.oddId), matchId: Number(c.matchId), cf: Number(c.price) || undefined }], currencyCode: 'XAF' }),
    code: (d) => d?.result?.code,
  },
  '1xbet': {
    url: 'https://1xbet.cg/service-api/LiveBet/Open/SaveCoupon',
    headers: {
      'content-type': 'application/json', origin: 'https://1xbet.cg', referer: 'https://1xbet.cg/fr/line',
      'x-requested-with': 'XMLHttpRequest', 'x-app-n': '__BETTING_APP__', 'x-svc-source': '__BETTING_APP__',
    },
    body: (c) => ({
      Bets: [{ GameId: Number(c.gameId), Type: Number(c.betType), Param: c.param == null ? null : Number(c.param), Coef: Number(c.price) || 1, Kind: Number(c.kind) || 3 }],
      Summ: '', partner: 1, Lng: 'fr', CheckCf: 1, Vid: 0, Type: 0, oneClickBet: false, betGuid: null,
    }),
    code: (d) => (d?.Success && d?.Value ? d.Value : null),
  },
};

export const CODE_BOOKS = Object.keys(BOOKS);

export async function generateCode(coupon) {
  const book = String(coupon?.book || '').toLowerCase();
  const cfg = BOOKS[book];
  if (!cfg) return { ok: false, book, reason: 'book_non_supporte' };
  let body;
  try { body = JSON.stringify(cfg.body(coupon)); }
  catch { return { ok: false, book, reason: 'identifiants_manquants' }; }
  try {
    const r = await fetch(cfg.url, {
      method: 'POST',
      headers: { ...cfg.headers, 'user-agent': UA, accept: 'application/json, text/plain, */*' },
      body, signal: AbortSignal.timeout(15000),
    });
    const txt = await r.text().catch(() => '');
    let json = null; try { json = JSON.parse(txt); } catch {}
    if (r.status < 200 || r.status >= 300) return { ok: false, book, reason: 'refuse', status: r.status, detail: txt.slice(0, 160) };
    const code = cfg.code(json);
    if (!code) return { ok: false, book, reason: 'aucun_code', detail: txt.slice(0, 160) };
    return { ok: true, book, code: String(code) };
  } catch (e) {
    return { ok: false, book, reason: 'reseau', detail: String(e?.message || e).slice(0, 120) };
  }
}
