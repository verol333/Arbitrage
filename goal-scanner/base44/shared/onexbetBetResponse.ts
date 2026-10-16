// A bank balance is not a receipt: only a bookmaker ticket confirms a bet.
export function parseOnexbetBetResponse(json, status = 200) {
  const value = json?.Value;
  const code = Number(json?.ErrorCode) || 0;
  const guid = value?.betGUID || value?.BetGUID || "";
  const ambiguous = (error) => ({ success: false, ambiguous: true, error, status, ticket: json });
  if (status === 401 || Number(json?.status) === 401 || (json?.Success === false && [1, 101, 103, 401].includes(code))) {
    return { success: false, authExpired: true, error: "1xBet : authentification refusée (401)", errorCode: code || 401, status, ticket: json };
  }
  if (!status || status >= 500 || !json || typeof json !== "object") {
    return ambiguous("bet_not_confirmed — réponse 1xBet illisible ou interruption réseau ; vérifier le ticket avant toute reprise");
  }
  const id = value?.Id || json?.Id;
  if (json.Success === true && Number(id) > 0) {
    const odds = Number(value?.Coupon?.Coef ?? value?.Coupon?.Events?.[0]?.Coef);
    const stake = Number(value?.Coupon?.Summ);
    return { success: true, ticketId: String(id), appliedOdds: Number.isFinite(odds) && odds > 1 ? odds : undefined,
      acceptedStake: Number.isFinite(stake) && stake > 0 ? stake : undefined, balance: value?.Balance, ticket: json };
  }
  if (guid) return { ...ambiguous("placement_pending — 1xBet attend une validation définitive ; aucune nouvelle mise avant vérification du ticket"),
    ticket: { pending: true, betGUID: String(guid), waitTime: value?.waitTime ?? null } };
  if (json.Success !== false) return ambiguous("bet_not_confirmed — aucun numéro de ticket 1xBet, résultat indéterminé");
  const messages = { 100: "Mise minimum non respectée", 104: "Sélection/cote plus valide (code 104)",
    130: "1xBet : les cotes ont été modifiées (code 130)", 131: "1xBet n'accepte plus de mise sur cette cote à l'instant" };
  return { success: false, error: messages[code] || json.Error || `1xBet a refusé le pari (code ${code})`, errorCode: code, status, ticket: json };
}

// Keep the exact subgame: identical Type/Param values exist on different periods.
export function mobileSelectionPrice(root, gameId, betType, param = 0) {
  const game = [root, ...(Array.isArray(root?.SG) ? root.SG : [])].find(g => Number(g?.I) === Number(gameId));
  if (!game) return { coef: null, reason: "sous_jeu_mobile_absent" };
  if (game.B === true || game.B === 1) return { coef: null, reason: "marche_mobile_suspendu" };
  for (const group of [{ E: game.E }, ...(game.GE || [])]) {
    for (const row of group.E || []) {
      for (const event of Array.isArray(row) ? row : [row]) {
        if (Number(event?.T) !== Number(betType) || (Number(event?.P) || 0) !== (Number(param) || 0)) continue;
        const coef = Number(event.C);
        if (event.B === true || event.B === 1 || !Number.isFinite(coef) || coef <= 1) return { coef: null, reason: "selection_mobile_suspendue" };
        return { coef };
      }
    }
  }
  return { coef: null, reason: "selection_absente_du_feed_mobile" };
}