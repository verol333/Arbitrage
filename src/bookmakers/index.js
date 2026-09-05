// Registre central des bookmakers. Ajouter un book = créer un dossier
// src/bookmakers/<nom>/index.js exportant l'interface commune et l'importer ici.
// Ordre = ordre de log (aucune dépendance métier).
import xbet from './xbet/index.js';
import onewin from './onewin/index.js';
import congobet from './congobet/index.js';
import yellowbet from './yellowbet/index.js';
import apollo from './apollo/index.js';
import betmomo from './betmomo/index.js';
import premierbet from './premierbet/index.js';
import betpawa from './betpawa/index.js';
import sportybet from './sportybet/index.js';
// casongo (Velisports/VeliGroup) : RETIRE le 2026-09-05. Le backend
// prod-api.velisports.com est derriere Cloudflare qui refuse toute IP serveur
// (403 sur les runners GitHub), et la seule voie restante exigeait un token
// capture a la main tous les 30 jours. Aucun match n'etait jamais lu.
// maxibet (skin BetConstruct, site_id 1870852) : cotes uniquement via le
// WebSocket Swarm, ce qui contourne Cloudflare et le geo-blocage. Foot
// pre-match seulement pour l'instant.
import maxibet from './maxibet/index.js';
// betika (api-cd.betika.com) : API JSON publique, sans authentification ni
// Cloudflare, joignable en direct depuis les runners GitHub. Foot pre-match et
// live ; les cotes completes se lisent match par match (/v1/uo/match).
import betika from './betika/index.js';
// betclic : backend gRPC-web public (offering.begmedia.com), regulation CI, sans
// authentification. Le site betclic.ci bloque les IP cloud, ce backend non.
// Foot pre-match ; l'indicateur "live" du flux est trompeur (cf. list.js).
import betclic from './betclic/index.js';
// mozzart (www.mozzartbet.co.ke) : API JSON publique du site, sans
// authentification ni Cloudflare. Foot pre-match uniquement ; les cotes se
// lisent par LOT de matchs (/getBettingOdds). Pas de flux in-play exploitable.
import mozzart from './mozzart/index.js';

export const bookmakers = [xbet, onewin, congobet, yellowbet, apollo, betmomo, premierbet, betpawa, sportybet, maxibet, betika, betclic, mozzart];
export const bookmakersByKey = Object.fromEntries(bookmakers.map((b) => [b.key, b]));

// Chaque bookmaker DOIT exporter cette forme :
//   {
//     key: string,               // identifiant unique interne
//     label: string,             // nom d'affichage (logs, UI)
//     supports: { prematch: bool, live: bool },
//     listMatches({ sport, live, horizonHours }) →
//       Promise<Array<{ id, home, away, league, start, __raw? }>>
//     getOdds(match, { sport, live }) → Promise<{ [marketKey]: odd }>
//     // Optionnel : lecture par lot pour les APIs batchables (1win WebSocket)
//     getOddsBatch?(matches, { sport, live }) → Promise<Map<id, { [marketKey]: odd }>>
//   }
