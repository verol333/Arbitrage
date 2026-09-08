// Acces au flux "direct-feed" de LNB Pari (Benin, lnbpari.com).
// Service BetLab.Sport.DirectFeed, expose en SignalR sur
// wss://lnbpari.com/direct-feed/feed. Aucune authentification de compte : seule
// la cle de service du site (X-Api-Key) + la marque BENIN sont exigees. Sans
// elles le serveur ferme la session des la poignee de main.
//
// Le protocole ne repond PAS a une requete/reponse classique : chaque appel est
// un ABONNEMENT (trame type 4) qui emet d'abord un lot initial
// (isInitialBatch = true) puis des mises a jour. On ne garde que le lot initial
// et on ferme : chaque cycle de scan relit tout, a la cote la plus fraiche.
//
// Une SEULE session peut porter plusieurs abonnements en parallele (un
// invocationId par appel) : c'est ce qui rend la lecture de 242 competitions
// tenable dans un creneau de 5 minutes.
import WebSocket from 'ws';

export const API_KEY = '9ba6608f-c15b-4d37-83e8-bb89aa22d2e7';
export const FEED_URL = `wss://lnbpari.com/direct-feed/feed?brand=BENIN&X-Api-Key=${API_KEY}`;

// Codes sport du flux (releves via GetSportsByStage). Chaque sport est decode
// par son propre mapping, verifie sur donnees reelles (marge du book positive
// dans toutes les familles).
export const SPORT_CODE = {
  football: 'F', tennis: 'T', basket: 'B',
  table_tennis: 'TT', hockey: 'H', volleyball: 'VB',
};
// stage : 1 = pre-match, 2 = direct.
export const STAGE_PREMATCH = 1;
export const STAGE_LIVE = 2;

const SEP = String.fromCharCode(30); // separateur de trames SignalR

// Lance plusieurs abonnements sur une seule session et rend, par appel, le lot
// initial recu. Retour : Map<index de l'appel, tableau d'entrees {key, value}>.
export function feedInvoke(calls, { timeoutMs = 45_000, quietMs = 1_800 } = {}) {
  return new Promise((resolve) => {
    const out = new Map();
    if (!calls.length) return resolve(out);
    let ws; let settled = false; let quiet;
    const finish = () => {
      if (settled) return; settled = true;
      clearTimeout(hard); clearTimeout(quiet);
      try { ws.close(); } catch { /* deja ferme */ }
      resolve(out);
    };
    const hard = setTimeout(finish, timeoutMs);
    // Le flux n'annonce pas la fin d'un lot : on ferme apres un silence.
    const bump = () => { clearTimeout(quiet); quiet = setTimeout(finish, quietMs); };
    try {
      ws = new WebSocket(FEED_URL, { headers: { origin: 'https://lnbpari.com' } });
    } catch { clearTimeout(hard); return resolve(out); }

    let started = false;
    ws.on('open', () => ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + SEP));
    ws.on('message', (raw) => {
      for (const frame of String(raw.toString('utf8')).split(SEP)) {
        if (!frame) continue;
        // Premiere trame = reponse de poignee de main : les abonnements ne
        // partent qu'apres, sinon le serveur coupe sans rien dire.
        if (!started) {
          started = true;
          calls.forEach((c, i) => ws.send(JSON.stringify({
            type: 4, invocationId: String(i), target: c.target, arguments: c.args,
          }) + SEP));
          bump();
          continue;
        }
        let msg;
        try { msg = JSON.parse(frame); } catch { continue; }
        if (msg.type === 2 && msg.item && msg.item.isInitialBatch) {
          const k = Number(msg.invocationId);
          out.set(k, (out.get(k) || []).concat(msg.item.data || []));
          bump();
        } else if (msg.type === 3) {
          bump();
        }
      }
    });
    ws.on('error', finish);
    ws.on('close', finish);
  });
}

// Un seul abonnement (raccourci).
export async function feedOne(target, args, opts) {
  const r = await feedInvoke([{ target, args }], opts);
  return r.get(0) || [];
}
