// REGLEMENT D'UN MARCHE SUR UN SCENARIO.
// settler(market, selection, ctx) renvoie une fonction sc -> 'W' | 'L' | 'V'
// (gagne / perd / rembourse), ou null si le libelle n'est pas reconnu avec
// certitude. Regle de fer : on ne devine jamais. Un marche non reconnu est
// simplement ignore par le solveur, il ne peut donc pas fabriquer de faux
// positif.
import { strip } from './families.js';
import { goals } from './scenarios.js';

// Marches hors de l'espace des scenarios (statistiques, joueurs, prolongations).
const OUT_OF_SPACE = /(booking|reservation|corner|carton|card|tir|shot|faute|foul|hors jeu|offside|touche|throw|remise|degagement|penalt|joueur|player|buteur|scorer|prolongation|extra time|tirs au but|minute|intervalle|interval|temps additionnel|arret|save|possession|passe|pass|substitut|remplacement|var|coup franc|free kick|serie|sequence)/;

const dec = (s) => {
  const m = String(s).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

function scopeOf(mkt, sel) {
  const s = strip(mkt) + ' ' + strip(sel);
  if (/(2e|2eme|2nd|second|deuxieme)\s*(mi.?temps|half|periode|period)/.test(s)) return 'H2';
  if (/(1re|1ere|1er|1st|first|premiere|premier)\s*(mi.?temps|half|periode|period)/.test(s)) return 'H1';
  // Betpawa suffixe simplement "- 1H" / "- 2H" : sans ces deux motifs, un
  // total de mi-temps etait regle sur le score final (source de faux surebets).
  if (/(^|[^a-z0-9])2h([^a-z0-9]|$)/.test(s)) return 'H2';
  if (/(^|[^a-z0-9])1h([^a-z0-9]|$)/.test(s)) return 'H1';
  if (/\bmi.?temps\b|\bhalf.?time\b|\bht\b/.test(s)) return 'H1';
  return 'FT';
}

// 1 / X / 2 a partir d'un mot, en tenant compte des noms d'equipes (1win).
function side(word, ctx) {
  const w = strip(word);
  if (!w) return null;
  if (ctx?.home && w === strip(ctx.home)) return '1';
  if (ctx?.away && w === strip(ctx.away)) return '2';
  if (/^(1|v1|w1|p1|home|dom|domicile|hote)$/.test(w)) return '1';
  if (/^(x|0|nul|draw|match nul|egalite|tie)$/.test(w)) return 'X';
  if (/^(2|v2|w2|p2|away|ext|exterieur|visiteur)$/.test(w)) return '2';
  return null;
}

// Mots attendus dans le libelle d'un marche de totaux de buts. Tout mot
// supplementaire (nom d'equipe, statistique) rend le rattachement douteux.
const TOTAL_VOCAB = new Set(('total totaux buts but goals goal score scores match du de la le les des over under plus moins ' +
  'exact nombre multigoals multiscores ft ht 1h 2h mi temps periode period half team equipe general ' +
  'and et o u tot pts nb').split(' '));

function hasForeignWord(mkt) {
  return strip(mkt).split(/[^a-z0-9]+/).filter((w) => w && w.length > 1 && !/^\d+$/.test(w) && !TOTAL_VOCAB.has(w)).length > 0;
}

// Cote d'un libelle : 1 si un mot significatif de l'equipe a domicile y figure,
// 2 pour l'exterieur, null si aucun ou les deux.
function teamByName(text, ctx) {
  const toks = (n) => strip(n || '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const words = new Set(strip(text).split(/[^a-z0-9]+/).filter(Boolean));
  const hit = (n) => toks(n).some((w) => words.has(w));
  const h = ctx.home && hit(ctx.home);
  const a = ctx.away && hit(ctx.away);
  if (h && !a) return '1';
  if (a && !h) return '2';
  return null;
}

const res = (gh, ga) => (gh > ga ? '1' : gh < ga ? '2' : 'X');
const scoresIn = (txt) => {
  const out = [];
  const re = /(\d+)\s*[:\-]\s*(\d+)/g;
  let m;
  while ((m = re.exec(String(txt)))) out.push([Number(m[1]), Number(m[2])]);
  return out;
};

function settleSimple(market, selection, ctx = {}) {
  const mkt = strip(market);
  const sel = strip(selection);
  const both = mkt + ' | ' + sel;
  if (!sel || OUT_OF_SPACE.test(both)) return null;

  // Marche non nomme par le book (1xbet renvoie des identifiants numeriques) :
  // impossible de savoir ce qu'on regle, on refuse. C'est ce trou qui faisait
  // passer des selections "1"/"2" de marches inconnus pour du 1X2.
  if (!mkt || /^[\d\s]+$/.test(mkt) || /(market|bettype|groupe|group)[- ]?\d+|^xbet|inconnu|unknown/.test(mkt)) return null;

  // Marches disjonctifs ("... gagne ou les deux equipes marquent") : deux
  // conditions liees par un OU, non decodables par les branches ci-dessous.
  // On refuse plutot que de n'en regler qu'une (source de faux profits).
  if (/\bou\b|\bor\b/.test(mkt)) return null;

  const sp = ctx.forceScope || scopeOf(market, selection);
  const g = (sc) => goals(sc, sp);

  // --- "les deux equipes marquent lors des deux mi-temps" : deux conditions,
  // une par periode. Avant, seule la 1re moitie du libelle etait lue et le
  // marche etait regle comme un simple BTTS de 1re mi-temps.
  if (/(deux|2) mi.?temps|both halves/.test(mkt) && /(deux equipes marquent|both teams to score|btts)/.test(mkt)) {
    const parts = sel.split(/[\/|]+|\bet\b|\band\b/).map((p) => p.trim()).filter(Boolean);
    const yn = (p) => (/^(oui|yes|o)$/.test(p) ? true : /^(non|no|n)$/.test(p) ? false : null);
    if (parts.length !== 2) return null;
    const a = yn(parts[0]);
    const b = yn(parts[1]);
    if (a === null || b === null) return null;
    return (sc) => {
      const h1 = sc.hh > 0 && sc.ha > 0;
      const h2 = sc.h - sc.hh > 0 && sc.a - sc.ha > 0;
      return h1 === a && h2 === b ? 'W' : 'L';
    };
  }

  // --- HT/FT : deux resultats successifs ---
  if (/(mi.?temps.*fin|ht.?ft|half.?time.*full.?time|1re.*2e|resultat des 2)/.test(mkt) && !/score exact|correct score/.test(mkt)) {
    const parts = sel.split(/[\/:>]+|\band\b|\bpuis\b/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      const a = side(parts[0], ctx);
      const b = side(parts[1], ctx);
      if (a && b) return (sc) => (res(sc.hh, sc.ha) === a && res(sc.h, sc.a) === b ? 'W' : 'L');
    }
    return null;
  }

  // --- score exact / multiscores : liste de scores explicites ---
  const isScoreMarket = /score exact|correct score|multiscore|score final|resultat exact/.test(mkt);
  const list = scoresIn(sel);
  if (isScoreMarket && list.length) {
    if (sp !== 'FT') return null;
    return (sc) => (list.some(([x, y]) => sc.h === x && sc.a === y) ? 'W' : 'L');
  }

  // --- "autre score victoire domicile/exterieur" : residu de la famille ---
  if (/autre|other|any other/.test(sel) && isScoreMarket) {
    const excl = ctx.siblingScores;
    if (!excl || !excl.size) return null; // sans les cases voisines, indecidable
    const w = /(domicile|home|1)/.test(sel) ? '1' : /(exterieur|away|2)/.test(sel) ? '2' : /(nul|draw)/.test(sel) ? 'X' : null;
    if (!w) return null;
    return (sc) => (res(sc.h, sc.a) === w && !excl.has(sc.h + ':' + sc.a) ? 'W' : 'L');
  }

  // --- handicap (asiatique ou europeen) ---
  if (/handicap|hcp|\bah\b/.test(mkt)) {
    const ln = dec(selection) ?? dec(ctx.line);
    if (ln == null) return null;
    const head = sel.replace(/-?\d+(?:\.\d+)?/g, ' ').replace(/handicap|hcp|ah/g, ' ').trim();
    const s = side(head, ctx);
    if (s !== '1' && s !== '2') return null;
    return (sc) => {
      const [gh, ga] = g(sc);
      const m = s === '1' ? gh - ga + ln : ga - gh + ln;
      return m > 0.0001 ? 'W' : m < -0.0001 ? 'L' : 'V';
    };
  }

  // --- totaux (match ou par equipe) ---
  if (/(total|plus.moins|over.under|buts|goals|o\/u)/.test(both) && /(over|under|plus de|moins de|\+|\-)/.test(sel)) {
    // "4+" = 4 buts ou plus, donc seuil a 3.5. Sans ca on perdait exactement
    // un but sur toute la famille Multigoals.
    const plusN = sel.match(/^(\d+)\s*\+$/);
    const ln = plusN ? Number(plusN[1]) - 0.5 : (dec(selection) ?? dec(ctx.line));
    if (ln == null) return null;
    const over = plusN ? true : /(over|plus|sup|\+|>|au dessus)/.test(sel);
    const under = plusN ? false : /(under|moins|inf|<|au dessous)/.test(sel);
    if (over === under) return null;
    // "Athletic Bilbao total" est un total d'EQUIPE. La comparaison de noms se
    // fait par mots significatifs : les books ecrivent "Al Tadamon SC" quand la
    // reference dit "Al Tadamun".
    const named = teamByName(both, ctx);
    const team = named
      || (/(domicile|home|equipe 1|team 1|\bt1\b)/.test(both) ? '1'
      : /(exterieur|away|equipe 2|team 2|\bt2\b)/.test(both) ? '2' : null);
    // Dernier verrou : si le libelle contient un mot inconnu du vocabulaire des
    // totaux, c'est probablement un total d'equipe ou de statistique mal
    // rattache. On refuse au lieu de le compter comme total du match.
    if (!team && hasForeignWord(mkt)) return null;
    return (sc) => {
      const [gh, ga] = g(sc);
      const v = team === '1' ? gh : team === '2' ? ga : gh + ga;
      if (Math.abs(v - ln) < 0.0001) return 'V';
      return (over ? v > ln : v < ln) ? 'W' : 'L';
    };
  }

  // --- pair / impair ---
  if (/(pair|impair|odd|even)/.test(both)) {
    const odd = /(impair|\bodd\b)/.test(sel);
    const even = /(^|\b)(pair|even)(\b|$)/.test(sel) && !odd;
    if (odd === even) return null;
    return (sc) => {
      const [gh, ga] = g(sc);
      const isOdd = (gh + ga) % 2 === 1;
      return (odd ? isOdd : !isOdd) ? 'W' : 'L';
    };
  }

  // --- les deux equipes marquent ---
  if (/(deux equipes marquent|both teams to score|\bbtts\b|gg\/ng)/.test(both)) {
    // "... dans les deux mi-temps" est un autre marche : on refuse plutot que
    // de le regler comme un BTTS simple.
    if (/(deux mi.?temps|both halves|in both)/.test(both)) return null;
    const yes = /(oui|yes|\bgg\b|\bsi\b)/.test(sel);
    const no = /(non|\bno\b|\bng\b)/.test(sel);
    if (yes === no) return null;
    return (sc) => {
      const [gh, ga] = g(sc);
      const b = gh > 0 && ga > 0;
      return (yes ? b : !b) ? 'W' : 'L';
    };
  }

  // --- marque dans les deux mi-temps ---
  if (/(deux mi.?temps|both halves)/.test(mkt) && /(marque|score)/.test(mkt)) {
    const team = /(domicile|home)/.test(both) ? '1' : /(exterieur|away)/.test(both) ? '2' : null;
    if (!team) return null;
    const yes = /(oui|yes)/.test(sel);
    const no = /(non|\bno\b)/.test(sel);
    if (yes === no) return null;
    return (sc) => {
      const f = team === '1' ? [sc.hh, sc.h - sc.hh] : [sc.ha, sc.a - sc.ha];
      const b = f[0] > 0 && f[1] > 0;
      return (yes ? b : !b) ? 'W' : 'L';
    };
  }

  // --- clean sheet / gagne sans encaisser ---
  if (/(clean sheet|sans encaisser|to nil|blanchissage)/.test(mkt)) {
    const team = /(domicile|home)/.test(both) ? '1' : /(exterieur|away)/.test(both) ? '2' : null;
    if (!team) return null;
    const win = /(gagne|win|victoire)/.test(mkt);
    const yes = /(oui|yes)/.test(sel);
    const no = /(non|\bno\b)/.test(sel);
    if (yes === no) return null;
    return (sc) => {
      const [gh, ga] = g(sc);
      const ok = team === '1' ? ga === 0 && (!win || gh > ga) : gh === 0 && (!win || ga > gh);
      return (yes ? ok : !ok) ? 'W' : 'L';
    };
  }

  // --- double chance ---
  if (/(double chance|\bdc\b)/.test(mkt)) {
    const k = sel.replace(/\s/g, '');
    const set = k === '1x' ? ['1', 'X'] : k === '12' ? ['1', '2'] : k === 'x2' || k === '2x' ? ['X', '2'] : null;
    if (!set) return null;
    return (sc) => {
      const [gh, ga] = g(sc);
      return set.includes(res(gh, ga)) ? 'W' : 'L';
    };
  }

  // --- remboursement si nul (draw no bet) ---
  if (/(draw no bet|\bdnb\b|rembourse si nul)/.test(both)) {
    const s = side(sel, ctx);
    if (s !== '1' && s !== '2') return null;
    return (sc) => {
      const [gh, ga] = g(sc);
      const r = res(gh, ga);
      return r === 'X' ? 'V' : r === s ? 'W' : 'L';
    };
  }

  // --- 1X2 simple (y compris 2UP, traite au pire cas) ---
  // Uniquement si le marche s'annonce comme un resultat de match : sinon une
  // selection "1" appartenant a un tout autre marche serait reglee comme 1X2.
  const isResultMarket = /^(1x2|1 x 2)|1x2|resultat|result|vainqueur|winner|moneyline|issue du match|match winner|gagnant/.test(mkt);
  const s1 = isResultMarket ? side(sel, ctx) : null;
  if (s1) {
    return (sc) => {
      const [gh, ga] = g(sc);
      return res(gh, ga) === s1 ? 'W' : 'L';
    };
  }

  return null;
}

// Un marche 2UP paie des que l'equipe mene de 2 buts, meme si le score final
// change. On le regle au pire cas (comme un 1X2 simple) : le gain reel ne peut
// donc qu'etre superieur a ce que le solveur annonce.
export const isEarlyPayout = (market, selection) => /2up|paiement anticipe|early payout/.test(strip(market) + ' ' + strip(selection));

// ---- marches combines : "1X2 and Totals", "Resultat du match et les deux
// equipes marquent", "Result and total"... Une seule des deux conditions ne
// suffit pas : la jambe ne gagne que si LES DEUX sont vraies. C'est ce trou qui
// faisait apparaitre des profits a 3 chiffres. Si l'une des deux moities n'est
// pas decodable avec certitude, la jambe entiere est refusee.
const COMBO_MKT = /\s(?:and|et|&)\s/i;

export function settler(market, selection, ctx = {}) {
  const mkt = String(market || '');
  const sel = String(selection || '');
  const mParts = mkt.split(COMBO_MKT);
  if (mParts.length === 2) {
    const sParts = sel.split(/\s*(?:\/|\||\s-\s|\band\b|\bet\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    if (sParts.length !== 2) return null;
    const sp = scopeOf(mkt, sel);
    const f1 = settleSimple(mParts[0], sParts[0], { ...ctx, forceScope: sp });
    const f2 = settleSimple(mParts[1], sParts[1], { ...ctx, forceScope: sp });
    if (!f1 || !f2) return null;
    return (sc) => {
      const a = f1(sc);
      const b = f2(sc);
      if (a === 'L' || b === 'L') return 'L';
      if (a === 'V' || b === 'V') return 'V';
      return 'W';
    };
  }
  return settleSimple(mkt, sel, ctx);
}
