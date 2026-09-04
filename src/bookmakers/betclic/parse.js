// Traduction des marches Betclic (libelles francais) vers le vocabulaire
// standard de core/markets.js.
//
// Betclic ne renvoie AUCUN code technique de marche : tout se lit dans les
// libelles francais. La lecture est donc pilotee par la FORME des selections
// ("+ de 2,5", "Pair", "Oui", "Lens ne perd pas"...) et le nom du marche ne
// sert qu'a determiner la periode (match / 1re / 2e mi-temps), le domaine
// (buts ou corners) et l'equipe concernee.
import { isHalfLine } from '../../core/markets.js';

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}
function numFR(s) {
  const m = String(s || '').match(/(-?\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(',', '.')) : null;
}
function line(n) { return isHalfLine(n) ? String(n) : null; }

// Periode : prefixe de cle. '' = temps reglementaire.
function scopeOf(name) {
  if (/(1ere|1re|premiere) mi-temps/.test(name)) return 'ht_';
  if (/(2eme|2e|seconde|deuxieme) mi-temps/.test(name)) return 'h2_';
  return '';
}

// Equipe citee dans le libelle du marche (totaux individuels, cage inviolee).
function sideIn(name, home, away) {
  const h = norm(home), a = norm(away);
  if (h && name.includes(h)) return 'home';
  if (a && name.includes(a)) return 'away';
  return null;
}
// Equipe portee par la selection elle-meme (handicaps, 1X2).
function sideOfSel(sel, home, away) {
  const s = norm(sel), h = norm(home), a = norm(away);
  if (h && s.startsWith(h)) return 'home';
  if (a && s.startsWith(a)) return 'away';
  return null;
}

/**
 * Handicap Betclic, exprime en phrases :
 *   "X gagne de 2 buts ou +"                     -> handicap -1.5
 *   "X ne perd pas ou perd de 1 but exactement"  -> handicap +1.5
 *   "X ne perd pas ou perd de 2 buts ou -"       -> handicap +2.5
 *   "X ne perd pas"                              -> handicap +0.5
 * "X gagne de 3 buts exactement" est un ecart EXACT : rejete (non arbitrable).
 */
function handicapLine(sel) {
  const s = norm(sel);
  let m = s.match(/gagne de (\d+)(?: buts?)? ou \+/);
  if (m) return -(Number(m[1]) - 0.5);
  m = s.match(/ne perd pas ou perd de (\d+)(?: buts?)?(?: ou -| exactement)/);
  if (m) return Number(m[1]) + 0.5;
  if (/ne perd pas$/.test(s)) return 0.5;
  return null;
}

/**
 * Aplatit les marches d'un match Betclic en { cle: cote }.
 * Les marches et selections suspendus sont ignores (impossibles a poser).
 */
export function betclicFlatOdds(markets, { home, away } = {}) {
  const odds = {}; const ids = {};
  const put = (key, sel, mk) => {
    if (!key || odds[key] != null) return;
    odds[key] = sel.odd;
    ids[key] = { market_id: mk.id, market_name: mk.name, selection_id: sel.id, selection_name: sel.name };
  };

  for (const mk of markets || []) {
    if (!mk || mk.suspended || !Array.isArray(mk.selections) || mk.selections.length < 2) continue;
    const name = norm(mk.name);
    const sc = scopeOf(name);
    const corners = /corner/.test(name);
    const dom = corners ? 'cor_' + sc : sc;          // cor_ / cor_ht_ / ht_ / ''
    // Marches STATISTIQUES : "1ere mi-temps - Plus grand nombre de cartons" a
    // exactement la meme forme qu'un 1X2 (equipe / egalite / equipe). Sans ce
    // garde-fou il etait lu comme un resultat de mi-temps et produisait des
    // centaines de faux surebets a +3% face aux vrais 1X2 des autres books.
    // Seuls les buts et les corners ont un equivalent chez les autres books.
    if (!corners && /carton|\btirs?\b|faute|hors-jeu|touche|passe|penalty|arret|remplacement|coup de pied/.test(name)) continue;
    // Marches COMBINES : "Les 2 equipes marquent OU + de 2,5 buts" a les memes
    // selections Oui/Non qu'un vrai BTTS et etait lu comme tel — une cote de
    // combine (plus courte) opposee a un vrai BTTS fabrique un faux surebet.
    // Un " ou " dans le NOM du marche signe toujours un combine chez Betclic
    // (la double chance, elle, porte le "ou" dans ses SELECTIONS, pas son nom).
    if (/ (ou|et) /.test(name) && !/rembourse/.test(name)) continue;
    const teamSide = sideIn(name, home, away);
    const sels = mk.selections;
    const labels = sels.map((s) => norm(s.name));

    // ── Totaux : "+ de 2,5" / "- de 2,5" ─────────────────────────────────
    if (labels.some((l) => /^[+-] de /.test(l))) {
      for (const s of sels) {
        const l = norm(s.name);
        const over = l.startsWith('+');
        if (!over && !l.startsWith('-')) continue;
        const L = line(numFR(l));
        if (!L) continue;
        const side = over ? 'over_' : 'under_';
        if (teamSide) put(dom + 'tt_' + teamSide + '_' + side + L, s, mk);
        else if (corners) put(dom + side + L, s, mk);
        else put(sc ? sc + side + L : 'match_' + side + L, s, mk);
      }
      continue;
    }

    // ── Pair / Impair ────────────────────────────────────────────────────
    if (labels.some((l) => l === 'pair' || l === 'impair')) {
      if (teamSide) continue; // pair/impair par equipe : sans equivalent ailleurs
      for (const s of sels) {
        const l = norm(s.name);
        if (l === 'impair') put(dom + 'odd', s, mk);
        else if (l === 'pair') put(dom + 'even', s, mk);
      }
      continue;
    }

    // ── Les 2 equipes marquent ───────────────────────────────────────────
    if (/les (2|deux) equipes marquent/.test(name)) {
      for (const s of sels) {
        const l = norm(s.name);
        if (l === 'oui') put(sc + 'btts_yes', s, mk);
        else if (l === 'non') put(sc + 'btts_no', s, mk);
      }
      continue;
    }

    // ── Handicaps / ecarts ───────────────────────────────────────────────
    if (/ecart|handicap/.test(name)) {
      for (const s of sels) {
        const side = sideOfSel(s.name, home, away);
        const L = handicapLine(s.name);
        if (!side || L === null || !isHalfLine(L)) continue;
        put(dom + 'hcp_' + side + '_' + (L > 0 ? '+' : '') + L, s, mk);
      }
      continue;
    }

    // ── Double chance : "A ou Nul", "A ou B", "Nul ou B" ─────────────────
    if (labels.every((l) => l.includes(' ou '))) {
      for (const s of sels) {
        const parts = norm(s.name).split(' ou ').map((p) => p.trim());
        const codes = parts.map((p) => {
          if (p === 'nul' || p === 'match nul') return 'X';
          if (norm(home) && p.startsWith(norm(home))) return '1';
          if (norm(away) && p.startsWith(norm(away))) return '2';
          return null;
        });
        if (codes.includes(null) || codes.length !== 2) continue;
        // Ordre canonique 1 / X / 2 : un tri alphabetique donnerait "2X" et
        // ferait perdre la double chance X2.
        const has = (c) => codes.includes(c);
        const key = has('1') && has('X') ? 'dc_1X' : has('1') && has('2') ? 'dc_12' : has('X') && has('2') ? 'dc_X2' : null;
        if (key) put(sc + key, s, mk);
      }
      continue;
    }

    // ── Resultat sec 1X2 (3 issues) ──────────────────────────────────────
    if (sels.length === 3 && labels.some((l) => l === 'nul' || l === 'match nul')) {
      const base = corners ? 'cor_' + sc + 'match_' : sc ? sc + 'match_' : 'match_';
      for (const s of sels) {
        const l = norm(s.name);
        if (l === 'nul' || l === 'match nul') put(base + 'X', s, mk);
        else {
          const side = sideOfSel(s.name, home, away);
          if (side) put(base + (side === 'home' ? '1' : '2'), s, mk);
        }
      }
      continue;
    }

    // ── Resultat rembourse si match nul (Draw No Bet) ─────────────────────
    if (/rembourse/.test(name) && sels.length === 2) {
      for (const s of sels) {
        const side = sideOfSel(s.name, home, away);
        if (side) put(sc + 'dnb_' + (side === 'home' ? '1' : '2'), s, mk);
      }
      continue;
    }
  }

  if (Object.keys(ids).length) odds._ids = ids;
  return odds;
}
