#!/usr/bin/env node
// TRIAGE : classe les marches brut en 3 categories :
//  1. FOOT-SCORE : exploitables via bitmask de scores (arb combinatoire)
//  2. NON-EXPLOITABLE : joueurs, cartons, corners, tirs, HT-only, prolongations, qualification
//  3. INCONNU : ne matche aucune categorie (nom obscur, surtout 1xbet Gxxxx)
import { readFileSync, writeFileSync } from 'node:fs';

const inv = JSON.parse(readFileSync('docs/market-inventory.json', 'utf8'));

// Patterns de RECHUTE (NON-exploitable)
const REJECT = [
  // Joueurs
  /player|joueur|1st.*goalscorer|last.*goalscorer|buteur|butter/i,
  /^goalnr$|xth goal|goal by/i,
  // Cartons
  /card|carton|yellow|red card|booking|penalty/i,
  // Corners
  /corner|coin/i,
  // Statistiques
  /shot|tir|foul|offside|throw|save|goalkeep|possession/i,
  // HT-only (fin de mi-temps, pas score final)
  /1[eè]re mi[- ]?temps|2[eè]me mi[- ]?temps|1st half|2nd half|- 1h\b|- 2h\b|halftime$|mi-temps$|premi[eè]re|deuxi[eè]me/i,
  /halftime with more|half with most|highest scoring half|mi-temps.*plus.*buts/i,
  // Contexte tournoi
  /qualif|prolong|overtime|extra time|penalty shootout|penalt.*shootout|to lift|trophy|winner overall/i,
  // Meta / bizarre
  /result from \d+ to \d+ minute|from \d+ to \d+/i,
  /multiscores|goal bounds|when.*first goal|quand.*premier/i,
  /result after \d+ minute/i,
];

// Patterns de KEEP (FOOT-SCORE exploitable)
const KEEP = [
  // 1X2 / Match Result
  /^1x2$/i, /^1x2 - ft$/i, /^match result$/i, /^r[eé]sultat du match$/i, /^full time result/i,
  /^match winner$/i, /^basic offer$/i, /^result$/i, /^winner$/i,
  // Double Chance
  /^double chance/i,
  // Draw No Bet
  /^draw no bet/i, /victoire d'une des deux/i,
  // BTTS
  /both teams to score/i, /^btts/i, /les deux [eé]quipes marquent/i, /^gg\/ng/i, /goal\/no goal/i,
  // O/U total match
  /^over\/under/i, /^total goals?/i, /^total$/i, /^nombre de buts$/i, /^total score over\/under - ft$/i,
  // Team totals
  /team [12] total/i, /nombre de buts de\s/i, /total de buts de\s/i, /total score over\/under - ft - (home|away) team/i,
  /nombre exact de buts inscrits par/i,
  // Correct Score
  /correct score/i, /score exact/i,
  // Winning Margin
  /winning margin/i, /marge du vainqueur/i, /ecart entre [eé]quipes/i, /ecart de buts/i,
  // Multigoals
  /multigoals?/i,
  // Exact Goals
  /^exact goals$/i, /^nombre exact de buts$/i, /^exact number of goals$/i,
  // HT/FT (score MT + score FT)
  /^ht.?ft$/i, /halftime\/fulltime/i, /r[eé]sultat mi-temps.*fin de match/i,
  // Handicaps
  /^handicap$/i, /^handicap goals$/i, /^handicap europ/i, /^asian handicap/i, /^handicap 1x2/i,
  // Odd/Even total
  /^odd\s*\/\s*even$/i, /^even\/odd$/i,
  // Clean Sheet / Win to Nil
  /clean sheet/i, /^to win to nil/i, /gagne sans encaisser/i, /n'encaisse pas de but/i,
  // Combined markets utiles
  /^r[eé]sultat du match et nombre de buts$/i, /^double chance et nombre de buts$/i,
  /^matchbet and totals/i, /^1x2 \& over\/under$/i, /^1x2 and totals/i, /^1x2 and both teams to score/i,
  /^double chance \& total$/i, /^double chance and totals/i, /^result and both teams to score/i,
  /^result and total$/i, /^total and both teams to score/i,
  /^les deux [eé]quipes marquent et nombre de buts$/i,
  /^r[eé]sultat du match et les deux [eé]quipes marquent$/i,
  /^double chance et les deux [eé]quipes marquent$/i,
  // Race to N goals
  /^race to \d+ goals?/i,
  // Win both/either half (score-based donc utile)
  /win both halves/i, /win either half/i, /score in both halves/i,
  /gagne les deux mi-temps/i, /gagne au moins une mi-temps/i, /marque [aà] chaque mi-temps/i,
];

function classify(marketName) {
  const m = String(marketName);
  for (const rx of REJECT) if (rx.test(m)) return 'REJECT';
  for (const rx of KEEP) if (rx.test(m)) return 'KEEP';
  return 'UNKNOWN';
}

const result = {};
for (const book of Object.keys(inv)) {
  result[book] = { KEEP: [], REJECT: [], UNKNOWN: [] };
  for (const m of Object.keys(inv[book])) {
    const cat = classify(m);
    result[book][cat].push({ market: m, selections: inv[book][m] });
  }
}

// Markdown
let md = `# Triage automatique des marchés\n\nGénéré le ${new Date().toISOString()}\n\n`;
md += `## Résumé\n\n| Book | ✅ KEEP (foot-score utile) | ❌ REJECT (joueurs/cartes/corners/HT) | ❓ UNKNOWN (à valider) | Total |\n|---|---:|---:|---:|---:|\n`;
for (const b of Object.keys(result)) {
  const r = result[b];
  md += `| ${b} | ${r.KEEP.length} | ${r.REJECT.length} | ${r.UNKNOWN.length} | ${r.KEEP.length + r.REJECT.length + r.UNKNOWN.length} |\n`;
}

for (const b of Object.keys(result)) {
  const r = result[b];

  md += `\n\n---\n\n# ${b}\n\n`;

  md += `## ✅ KEEP — ${r.KEEP.length} marchés à analyser\n\n`;
  md += `| # | Marché brut | Sélections |\n|:-:|---|---|\n`;
  r.KEEP.sort((a, b) => a.market.localeCompare(b.market));
  for (let i = 0; i < r.KEEP.length; i++) {
    const sels = r.KEEP[i].selections.slice(0, 12).map(s => `\`${s.replace(/\|/g, '\\|')}\``).join(' · ');
    const more = r.KEEP[i].selections.length > 12 ? ` … (+${r.KEEP[i].selections.length - 12})` : '';
    md += `| ${i+1} | \`${r.KEEP[i].market.replace(/\|/g, '\\|')}\` | ${sels}${more} |\n`;
  }

  md += `\n## ❓ UNKNOWN — ${r.UNKNOWN.length} marchés à vérifier manuellement\n\n`;
  md += `| # | Marché brut | Sélections |\n|:-:|---|---|\n`;
  r.UNKNOWN.sort((a, b) => a.market.localeCompare(b.market));
  for (let i = 0; i < r.UNKNOWN.length; i++) {
    const sels = r.UNKNOWN[i].selections.slice(0, 8).map(s => `\`${s.replace(/\|/g, '\\|')}\``).join(' · ');
    const more = r.UNKNOWN[i].selections.length > 8 ? ` … (+${r.UNKNOWN[i].selections.length - 8})` : '';
    md += `| ${i+1} | \`${r.UNKNOWN[i].market.replace(/\|/g, '\\|')}\` | ${sels}${more} |\n`;
  }

  md += `\n## ❌ REJECT — ${r.REJECT.length} marchés non exploitables\n\n<details><summary>Voir la liste (repli)</summary>\n\n`;
  md += `| # | Marché brut |\n|:-:|---|\n`;
  r.REJECT.sort((a, b) => a.market.localeCompare(b.market));
  for (let i = 0; i < r.REJECT.length; i++) {
    md += `| ${i+1} | \`${r.REJECT[i].market.replace(/\|/g, '\\|')}\` |\n`;
  }
  md += `\n</details>\n`;
}

writeFileSync('docs/market-triage.md', md);
writeFileSync('docs/market-triage.json', JSON.stringify(result, null, 2));

console.log('=== TRIAGE TERMINE ===');
for (const b of Object.keys(result)) {
  const r = result[b];
  console.log(`${b.padEnd(10)} KEEP=${r.KEEP.length}  UNKNOWN=${r.UNKNOWN.length}  REJECT=${r.REJECT.length}`);
}
console.log('\n docs/market-triage.md');
console.log(' docs/market-triage.json');
