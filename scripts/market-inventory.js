#!/usr/bin/env node
// INVENTAIRE DES MARCHES — etape 1 avant tout nouveau solveur.
//
// But : sur un match populaire couvert par plusieurs books, recuperer TOUS les
// marches proposes, avec leur libelle natif exact et toutes leurs issues, puis
// separer ce que nous exploitons deja de ce qui reste INEXPLOITE.
// Aucune opportunite n'est calculee ici : on cartographie d'abord.
import { bookmakersByKey } from '../src/bookmakers/index.js';
import { alignCatalogs } from '../src/core/matching.js';
import { bpFetchEvent } from '../src/bookmakers/betpawa/api.js';
import { congoJson, CONGO_API } from '../src/bookmakers/congobet/api.js';
import { dumpXbetMarkets } from '../src/bookmakers/xbet/dictionary.js';
import { fetchOddsWS } from '../src/bookmakers/onewin/ws.js';

const BOOKS = (process.env.INV_BOOKS || '1xbet,congobet,betpawa,1win').split(',').map(s => s.trim());
const MATCHES = parseInt(process.env.INV_MATCHES || '1', 10);
const MIN_BOOKS = parseInt(process.env.INV_MIN_BOOKS || '2', 10);

// ─── Familles DEJA exploitees par nos lecteurs actuels ──────────────────────
// Tout libelle qui ne tombe dans aucune de ces familles est signale NOUVEAU.
const EXPLOITE = [
  [/^(1x2|resultat|match result|full time result|winner|vainqueur)/i, '1X2'],
  [/double chance/i, 'Double chance'],
  [/(both teams? to score|les deux equipes marquent|btts|gg\/ng)/i, 'BTTS'],
  [/(total (de )?buts?|nombre de buts|over\/under|total goals|plus\/moins)/i, 'Total buts'],
  [/(total (equipe|team)|team total|but equipe)/i, 'Total equipe'],
  [/(handicap)/i, 'Handicap'],
  [/(score exact|correct score)/i, 'Score exact'],
  [/(pair|impair|odd\/even|odd or even)/i, 'Pair/Impair'],
  [/(draw no bet|remboursi|resultat sans (match )?nul)/i, 'Draw no bet'],
  [/(multi ?goals?|intervalle de buts|goal range)/i, 'Multigoals'],
  [/(corner|carton|card|foul|faute|hors-?jeu|offside|tir|shot|throw|degagement)/i, 'Marche statistique'],
  [/(1(ere|re|st) mi-?temps|2(e|nd) mi-?temps|first half|second half|half ?time|mi-?temps)$/i, 'Mi-temps simple'],
];
function classify(label) {
  for (const [re, fam] of EXPLOITE) if (re.test(label)) return fam;
  return null;
}

// ─── Recuperation brute + mise a plat en { market, selections[] } ───────────
async function dump_congobet(id) {
  const raw = await congoJson(`${CONGO_API}events/${id}`);
  return (raw?.eventBetTypes || []).map(bt => ({
    market: String(bt.name || '?'),
    selections: (bt.eventBetTypeItems || [])
      .filter(it => parseFloat(it.odds) > 1)
      .map(it => ({ name: String(it.shortName || it.name || '?'), odds: parseFloat(it.odds) })),
  }));
}
async function dump_betpawa(id) {
  const raw = await bpFetchEvent(id, 15000);
  const out = [];
  for (const mk of raw?.markets || []) {
    const base = mk.marketType?.name || mk.name || `m${mk.id}`;
    for (const row of (mk.row || [])) {
      const sp = row?.specifier || {};
      const suffix = sp.total ? ` [${sp.total}]` : (sp.hcp ? ` [${sp.hcp}]` : '');
      out.push({
        market: `${base}${suffix}`,
        selections: (row.prices || []).filter(p => parseFloat(p.odds) > 1)
          .map(p => ({ name: String(p.name || p.displayName || '?'), odds: parseFloat(p.odds) })),
      });
    }
  }
  return out;
}
async function dump_1win(id) {
  const raw = await fetchOddsWS([id], { timeoutMs: 20000, quietMs: 3000 });
  const r = raw.get(id) || raw.get(String(id)) || {};
  return Object.entries(r).map(([market, list]) => ({
    market: String(market),
    selections: (list || []).filter(o => o?.status === 1 && Number(o.cf) > 1)
      .map(o => ({ name: String(o.name || o.outcome || '?'), odds: Number(o.cf) })),
  }));
}
// 1xBet : API mobile v3 — marches principaux + sous-marches NOMMES (Corners,
// Cartons jaunes, 1ere/2eme mi-temps...), libelles issus du dictionnaire releve
// sur l'app, jamais devines.
async function dump_1xbet(id) {
  const res = await dumpXbetMarkets(id);
  if (!res.ok) throw new Error(res.reason || 'dump_failed');
  return res.markets.map(m => ({
    market: m.market,
    selections: m.selections.map(s => ({
      name: `${s.name}${s.line != null ? ' [' + s.line + ']' : ''}`,
      odds: s.odds,
    })),
  }));
}
const DUMPERS = { congobet: dump_congobet, betpawa: dump_betpawa, '1win': dump_1win, '1xbet': dump_1xbet };

// ─── Selection des matchs ──────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════');
console.log('  INVENTAIRE DES MARCHES — recherche de familles inexploitees');
console.log(`  Books : ${BOOKS.join(', ')}   •   ${MATCHES} match(s)`);
console.log('══════════════════════════════════════════════════════════════\n');

const catalogs = new Map();
await Promise.all(BOOKS.map(async key => {
  const book = bookmakersByKey[key];
  if (!book) return;
  try {
    const ms = await book.listMatches({ live: false, sport: 'football', horizonHours: 30 });
    catalogs.set(key, ms);
    console.log(`[${key}] ${ms.length} matchs listes`);
  } catch (e) { console.log(`[${key}] KO ${e.message}`); }
}));

const entries = alignCatalogs(catalogs, { minBooks: MIN_BOOKS, horizonMs: Date.now() + 48 * 3600 * 1000 });
entries.sort((a, b) => Object.keys(b.matches).length - Object.keys(a.matches).length);
const top = entries.slice(0, MATCHES);
if (!top.length) { console.log('\nAucun match commun trouve.'); process.exit(0); }

// ─── Inventaire par match ──────────────────────────────────────────────────
for (const entry of top) {
  console.log(`\n\n████ ${entry.ref.home} vs ${entry.ref.away}  —  ${Object.keys(entry.matches).length} books\n`);

  const perBook = await Promise.all(
    Object.entries(entry.matches).filter(([b]) => DUMPERS[b]).map(async ([book, m]) => {
      try { return { book, markets: await DUMPERS[book](m.id) }; }
      catch (e) { return { book, markets: [], err: e.message }; }
    })
  );

  const nouveauxParLibelle = new Map(); // libelle -> Set(books)

  for (const { book, markets, err } of perBook) {
    if (err) { console.log(`── ${book} : lecture impossible (${err})\n`); continue; }
    const opaques = markets.filter(m => m.opaque);
    const nommes = markets.filter(m => !m.opaque);
    const nouveaux = nommes.filter(m => !classify(m.market));
    const connus = nommes.filter(m => classify(m.market));

    console.log(`── ${book} : ${markets.length} marches (${connus.length} deja exploites, ${nouveaux.length} inexploites${opaques.length ? `, ${opaques.length} sans libelle` : ''})`);

    for (const m of nouveaux) {
      console.log(`   ▸ ${m.market}   (${m.selections.length} issues)`);
      console.log(`       ${m.selections.map(s => `${s.name} @ ${s.odds.toFixed(2)}`).join('  |  ')}`);
      const key = m.market.replace(/\s*\[[^\]]*\]\s*$/, '').trim().toLowerCase();
      if (!nouveauxParLibelle.has(key)) nouveauxParLibelle.set(key, new Set());
      nouveauxParLibelle.get(key).add(book);
    }
    if (opaques.length) {
      console.log(`   (1xBet ne fournit aucun libelle : ${opaques.length} groupes numeriques, ${opaques.reduce((n, m) => n + m.selections.length, 0)} issues — ids ${opaques.slice(0, 40).map(m => m.market.replace('groupe #','')).join(',')})`);
    }
    console.log('');
  }

  const multi = [...nouveauxParLibelle.entries()].filter(([, s]) => s.size >= 2);
  console.log(`── Familles inexploitees presentes chez PLUSIEURS books (${multi.length}) :`);
  if (!multi.length) console.log('   aucune');
  for (const [label, books] of multi.sort((a, b) => b[1].size - a[1].size)) {
    console.log(`   • ${label}  →  ${[...books].join(', ')}`);
  }
}
console.log('\nFin de l inventaire.');
