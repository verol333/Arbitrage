// Shared placement orchestration; dependencies are supplied by the server adapter.
// A retry is permitted ONLY after an explicit odds/auth rejection, never pending.
//
// « ACCEPTER LES CHANGEMENTS DE COTE » : 1xBet refuse (code 130) toute mise
// dont la cote a glissé, même de 0,01. On envoie donc l'option d'acceptation
// des changements — et comme accepter N'IMPORTE QUELLE cote reviendrait à
// parier sans marge, la mise n'est envoyée que si la cote reste au-dessus de
// `selection.minOdds`, la COTE PLANCHER en dessous de laquelle l'arbitrage
// devient perdant. Entre cette cote plancher et la cote lue, tout mouvement est
// accepté. Sans cote plancher fournie, l'ancienne exigence stricte s'applique.
//
// ⚠️ INCIDENT DU 24-26/09/2026 — CheckCf=1 = « ACCEPTER TOUT CHANGEMENT ».
// Mesuré sur toutes les poses réelles : 0 et 2 renvoyaient 130 (cote changée),
// puis la variante 1 était ACCEPTÉE à une cote bien plus basse que la cote
// plancher (2,22 → 1,88 ; 1,536 → 1,38 ; 4,485 → 3,4…) : arbitrage perdant
// à chaque fois. La cote plancher ne peut pas protéger ce mode, puisque 1xBet
// fixe lui-même la cote après envoi. La variante 1 est donc INTERDITE : un
// refus 130 persistant = aucune mise (1xBet part en premier, rien n'est engagé).
const CHECK_CF_VARIANTS = [0, 2];

export default async function onexbetPlacement(conn, selection, stake, deps) {
  const reference = Number(selection.coef);
  if (!Number.isFinite(reference) || reference <= 1) return { success: false, error: "1xBet : cote de référence invalide" };
  const floor = Number(selection.minOdds) > 1 ? Number(selection.minOdds) : reference;
  let variant = 0, oddsRetry = false, authRetry = false;
  const attempts = [];
  const finish = result => ({ ...result, attempts });
  const renew = async () => {
    if (authRetry) return false;
    authRetry = true;
    const token = await deps.renew(conn.token) || (conn._renewToken !== conn.token ? await deps.renew(conn._renewToken) : null);
    if (!token) return false;
    conn.token = token;
    return true;
  };
  for (let i = 0; i < 4; i++) {
    const [quote, balance] = await Promise.all([
      deps.readCoef(selection.gameId, selection.betType, Number(selection.param) || 0, !!selection.live),
      deps.readBalance(conn.token, conn.app_guid, conn.user_ip),
    ]);
    if (!balance?.ok) {
      if (balance?.authExpired && await renew()) continue;
      return finish({ success: false, error: `1xBet : contrôle de session avant mise impossible (${balance?.error || "solde illisible"})` });
    }
    const coef = Number(quote?.coef);
    if (!Number.isFinite(coef) || coef <= 1) return finish({ success: false, error: `1xBet : sélection mobile indisponible (${quote?.reason || "cote absente"})` });
    if (coef < floor) return finish({ success: false, errorCode: 130,
      error: `1xBet : cote ${coef} sous la cote plancher ${floor.toFixed(2)} — au-delà le pari devient perdant, aucune mise envoyée` });
    if (balance.balance == null || !Number.isFinite(Number(balance.balance)) || Number(balance.balance) < stake) return finish({ success: false, error: "1xBet : fonds insuffisants ou solde illisible avant mise" });
    conn.balance = Number(balance.balance);
    const checkCf = CHECK_CF_VARIANTS[Math.min(variant, CHECK_CF_VARIANTS.length - 1)];
    const result = await deps.place({ token: conn.token, appGuid: conn.app_guid, userIp: conn.user_ip,
      userId: Number(conn.user_uuid) || deps.userId(conn.token), summ: stake, checkCf,
      events: [{ gameId: selection.gameId, mainGameId: selection.mainGameId || selection.gameId,
        type: selection.betType, coef: String(coef), param: String(selection.param ?? 0), kind: selection.kind }] });
    attempts.push({ attempt: attempts.length + 1, gameId: selection.gameId, requestedOdds: coef, floorOdds: floor,
      checkCf, success: !!result.success, errorCode: result.errorCode ?? null, status: result.status ?? null,
      ambiguous: !!result.ambiguous, error: result.error || null });
    if (result.success || result.ambiguous) return finish(result);
    if (result.authExpired && await renew()) continue;
    if (Number(result.errorCode) === 130) {
      // Refus « les cotes ont changé » : on repasse d'abord par une autre
      // variante d'acceptation des changements, puis une seule relecture.
      if (variant < CHECK_CF_VARIANTS.length - 1) { variant++; continue; }
      if (!oddsRetry) { oddsRetry = true; continue; }
    }
    return finish(result);
  }
  return finish({ success: false, error: "1xBet : refus persistant après actualisation de session/cote" });
}