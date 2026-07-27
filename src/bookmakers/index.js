// Registre central des bookmakers. Ajouter un book = créer un dossier
// src/bookmakers/<nom>/index.js exportant l'interface commune et l'importer ici.
// Ordre = ordre de log (aucune dépendance métier).
import xbet from './xbet/index.js';
import onewin from './onewin/index.js';
import congobet from './congobet/index.js';
import yellowbet from './yellowbet/index.js';
import apollo from './apollo/index.js';
import betmomo from './betmomo/index.js';
import sportcash from './sportcash/index.js';
// PremierBet retire du registre : l'API mobile est bloquee par CF sur les
// IPs datacenter GH Actions (403 "Sorry, you have been blocked" — audit du
// 27/07). Le connecteur reste dans le dossier premierbet/ pour re-activation
// future si un proxy residentiel est branche. Ne PAS re-importer sans setup
// proxy prealable.

export const bookmakers = [xbet, onewin, congobet, yellowbet, apollo, betmomo, sportcash];
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
