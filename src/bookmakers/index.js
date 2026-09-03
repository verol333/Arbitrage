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
// casongo (Velisports/VeliGroup, foot uniquement) : JWT Bearer token capture via
// F12 utilisateur (2026-08-10) et stocke en GH secret CASONGO_TOKEN. Le token
// dure ~30j — rotation manuelle mensuelle par le user via F12 fresh dump.
// Backend prod-api.velisports.com passe par Scrape.do super=true (Cloudflare
// bloque les IPs cloud sans residentialisation).
import casongo from './casongo/index.js';
// maxibet (skin BetConstruct, site_id 1870852) : cotes uniquement via le
// WebSocket Swarm, ce qui contourne Cloudflare et le geo-blocage. Foot
// pre-match seulement pour l'instant.
import maxibet from './maxibet/index.js';
// betika (api-cd.betika.com) : API JSON publique, sans authentification ni
// Cloudflare, joignable en direct depuis les runners GitHub. Foot pre-match et
// live ; les cotes completes se lisent match par match (/v1/uo/match).
import betika from './betika/index.js';

export const bookmakers = [xbet, onewin, congobet, yellowbet, apollo, betmomo, premierbet, betpawa, sportybet, casongo, maxibet, betika];
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
