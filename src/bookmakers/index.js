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
import premierbet from './premierbet/index.js';
import betpawa from './betpawa/index.js';
// PremierBet REACTIVE via une marque soeur EDITEC : guineegames.com. La chaine
// EDITEC (Malta) opere PremierBet, SBA, R&S Betting, Guinee Games, Mercury Bet
// etc., tous sur la meme plateforme technique BtoBet (backend "sahara.editec-
// online.com"). Les cotes sont IDENTIQUES entre marques (verifie par l'user
// via F12 network inspection sur premierbet.cg vs guineegames.com).
// L'API premierbet.com direct est bloquee par Cloudflare sur les IPs
// datacenter GH Actions, mais guineegames.com est ouverte → on utilise
// sports-api.guineegames.com/v1 avec country=GN&group=g6&platform=desktop.
// On labelle les cotes comme "premierbet" dans l'engine et l'app user.

export const bookmakers = [xbet, onewin, congobet, yellowbet, apollo, betmomo, sportcash, premierbet, betpawa];
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
