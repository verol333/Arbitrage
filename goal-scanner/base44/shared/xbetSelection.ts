// ═══════════════════════════════════════════════════════════════════
// SÉLECTION 1xBet — validation puis génération du code coupon.
//
// PAYLOAD DE RÉFÉRENCE (capturé en F12 sur 1xbet.cg, marché corners) :
//   { Events:[{GameId, Type, Coef, Param, PV:null, PlayerId:0, Kind:3,
//              InstrumentId:0, PlayersDuel:[], Seconds:0, Price:0, Expired:0}],
//     Vid:0, partner:1, Lng:"fr", CfView:0, CalcSystemsMin:false,
//     Country:93, Currency:26, SaleBetId:0, IsPowerBet:false, WithLobby:false }
// Aucun champ CheckCf / Summ / UserId — les ajouter produisait des codes que le
// site refusait ensuite (« code incorrect »), surtout sur les marchés secondaires.
//
// SaveCoupon ne valide RIEN côté serveur (un GameId inventé renvoie Success:true).
// La sélection est donc re-vérifiée dans le flux 1xbet.cg AVANT génération, et le
// code est créé avec la cote fraîche lue à cet instant.
// ═══════════════════════════════════════════════════════════════════

const HOST = "https://1xbet.cg";
const PARTNER = 1;

const HEADERS = {
  accept: "application/json, text/plain, */*",
  "content-type": "application/json",
  origin: HOST,
  referer: `${HOST}/fr/line`,
  "x-requested-with": "XMLHttpRequest",
  "x-app-n": "__BETTING_APP__",
  "x-svc-source": "__BETTING_APP__",
  "x-mobile-project-id": "0",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
};

const num = (v) => (v == null ? 0 : Number(v));

/** Corps SaveCoupon strictement identique à celui du site 1xbet.cg. */
export function buildXbetCouponBody(sel, coef) {
  return {
    Events: [{
      GameId: Number(sel.gameId),
      Type: Number(sel.betType),
      Coef: Number(coef),
      Param: num(sel.param),
      PV: null,
      PlayerId: 0,
      Kind: Number(sel.kind) || 3,
      InstrumentId: 0,
      PlayersDuel: [],
      Seconds: 0,
      Price: 0,
      Expired: 0,
    }],
    Vid: 0,
    partner: PARTNER,
    Lng: "fr",
    CfView: 0,
    CalcSystemsMin: false,
    SaleBetId: 0,
    IsPowerBet: false,
    WithLobby: false,
    Country: 93,
    Currency: 26,
  };
}

/**
 * Vérifie que la sélection existe RÉELLEMENT chez 1xBet et renvoie sa cote.
 * La recherche couvre le match et ses sous-jeux (corners, cartons, mi-temps…),
 * et renvoie le GameId qui porte vraiment la sélection.
 */
export async function validateSelection(sel) {
  const gameId = Number(sel?.gameId);
  const betType = Number(sel?.betType);
  if (!gameId || !betType) return { ok: false, reason: "missing_ids" };
  const wanted = num(sel.param);

  // Un match LIVE n'existe QUE dans LiveFeed, un prématch QUE dans LineFeed.
  // On interroge donc le flux correspondant au Kind, puis l'autre en repli
  // (un match peut basculer prématch → live entre la détection et la génération).
  const isLive = Number(sel.kind) === 1;
  const feeds = isLive ? ["LiveFeed", "LineFeed"] : ["LineFeed", "LiveFeed"];

  let root = null;
  for (const feed of feeds) {
    // ⚠️ countevents=800 TRONQUAIT le flux : un match de football live sert plus
    // de 800 cotes, et les marchés coupés étaient déclarés « sélection retirée »
    // alors qu'ils existaient — des opportunités perdues pour rien.
    const url = `${HOST}/service-api/${feed}/GetGameZip?id=${gameId}&lng=fr&isSubGames=true&GroupEvents=true&countevents=3000&grMode=4&country=93&partner=${PARTNER}&marketType=1`;
    const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!r?.ok) continue;
    const data = await r.json().catch(() => null);
    if (data?.Value?.I) { root = data.Value; break; }
  }
  if (!root) return { ok: false, reason: "game_not_found" };

  // ⚠️ GARDE-FOU : on ne cherche la sélection QUE dans le jeu demandé quand il
  // figure dans la réponse. Sans ça, un marché de sous-jeu (corners, cartons,
  // mi-temps…) dont le Type est identique à celui du 1X2 était retrouvé sur le
  // MATCH COMPLET, et le code coupon posait « Victoire 2 » au lieu de
  // « Corners vainqueur » — pari différent de celui affiché.
  const all = [root, ...(Array.isArray(root.SG) ? root.SG : [])];
  const exact = all.find((g) => Number(g?.I) === gameId);
  const games = exact ? [exact] : all;
  for (const game of games) {
    for (const g of game.GE || []) {
      for (const s of g.E || []) {
        for (const it of Array.isArray(s) ? s : [s]) {
          if (Number(it.T) !== betType || num(it.P) !== wanted) continue;
          const coef = parseFloat(it.C);
          if (!isFinite(coef)) return { ok: false, reason: "no_price" };
          // On renvoie aussi le CONTEXTE de la sélection (groupe de marché, nom du
          // sous-jeu « Corners », période « 1ère mi-temps », noms des équipes) :
          // c'est ce qui permet au contrôle de conformité de vérifier que les
          // identifiants désignent bien la jambe affichée. Sans ça, le contrôle
          // était aveugle sur 1xBet.
          return {
            ok: true, coef, gameId: Number(game.I) || gameId,
            group: Number(g.G) || 0,
            subName: String(game.TG || ""),
            period: String(game.PN || ""),
            o1: String(root.O1 || ""),
            o2: String(root.O2 || ""),
          };
        }
      }
    }
  }
  return { ok: false, reason: "selection_gone" };
}

/** Crée le code coupon sur la sélection, à la cote fraîche du flux. */
export async function createCoupon(sel, coef) {
  const r = await fetch(`${HOST}/service-api/LiveBet/Open/SaveCoupon`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(buildXbetCouponBody(sel, coef)),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  const json = await r?.json().catch(() => null);
  return json?.Success && json?.Value ? String(json.Value) : null;
}

/** Valide puis génère : { code, coef } ou { code: null, reason }. */
export async function safeCoupon(sel) {
  const check = await validateSelection(sel);
  if (!check.ok) return { code: null, reason: check.reason };
  const resolved = { ...sel, gameId: check.gameId };
  const code = await createCoupon(resolved, check.coef);
  return code ? { code, coef: check.coef, gameId: check.gameId } : { code: null, reason: "save_failed" };
}