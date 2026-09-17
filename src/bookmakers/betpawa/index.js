import { listMatches } from './list.js';
import { bpFetchEvent } from './api.js';
import { betpawaFlatOdds, betpawaTennisFlatOdds, betpawaBasketFlatOdds } from './parse.js';

export default {
  key: 'betpawa',
  label: 'BetPawa',
  supports: { prematch: true, live: true },
  async listMatches({ live = false, horizonHours, sport = 'football' } = {}) {
    if (!['football', 'tennis', 'basket'].includes(sport)) return [];
    return listMatches({ live, horizonHours, sport });
  },
  async getOdds(match, { live = false, noCache = false, sport = 'football' } = {}) {
    // En live ou confirm noCache → bypass cache pour cotes fraîches du moment.
    // En prématch → cache 30s OK (cotes bougent peu, économise des requêtes).
    const eventJson = await bpFetchEvent(match.id, 15_000, { fresh: live || noCache });
    if (!eventJson) return {};
    const flat = sport === 'tennis' ? betpawaTennisFlatOdds
               : sport === 'basket' ? betpawaBasketFlatOdds
               : betpawaFlatOdds;
    const odds = flat(eventJson);
    // ── ON TRANSMET L'IDENTIFIANT DU MATCH AVEC CHAQUE COTE ──────────────
    // Cause racine mesurée le 17/09/2026 : les _ids ne portaient que le
    // priceId (suffisant pour SaveCoupon), donc le moteur de mise devait
    // RETROUVER le match par son nom chez BetPawa. Or BetPawa nomme autrement
    // (paires de double reduites a un joueur, equipes reserves, clubs abreges)
    // et le match etait declare « introuvable » alors qu'il etait bien a
    // l'affiche. On connait deja son id ici : on le joint a chaque cote.
    const eid = match?.id == null ? null : String(match.id);
    if (eid && odds && odds._ids) {
      for (const k of Object.keys(odds._ids)) {
        if (odds._ids[k] && typeof odds._ids[k] === 'object') odds._ids[k].eventId = eid;
      }
    }
    return odds;
  },
};
