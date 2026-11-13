import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betclicFlatOdds } from './parse.js';
import { betclicBasketFlatOdds } from './parseBasket.js';
import { betclicVolleyballFlatOdds } from './parseVolleyball.js';
import { betclicTennisFlatOdds } from './parseTennis.js';
import { betclicHockeyFlatOdds } from './parseHockey.js';
import { betclicTableTennisFlatOdds } from './parseTableTennis.js';
import { periodOf, makePut, ecartLine } from './util.js';
import { compareTwoBooks } from '../../core/arbitrage.js';
const teams = { home: 'Montpellier HB', away: 'Dunkerque' };
const mk = (name, names, extra = {}) => ({ id: 111, name, selections: names.map((name, i) => ({id: 200+i, name, odd: i ? 1.68 : 2})), ...extra });
const keys = odds => Object.keys(odds).filter(k => k !== '_ids');
for (const [name, expected] of [
 ['Écart de buts à la MT','ht_'], ['2ème MT - Total de buts','h2_'],
 ['1ère mi-temps - Total de buts','ht_'], ['2ème mi-temps (seule) - Résultat','h2_'],
 ['Écart de points - 1er quart-temps','unsupported'], ['Écart de points - 2ème set','unsupported'],
 ['Mi-temps / Fin de match','unsupported'], ['Mi-temps la plus prolifique','unsupported'],
 ['Écart de points entre les équipes',''], ['Écart de sets',''],
]) test('Période native : '+name, () => assert.equal(periodOf(name),expected));
for(const [sport,parse] of [['football',betclicFlatOdds],['handball',betclicFlatOdds]]) {
 test(sport+' : Montpellier MT ne devient jamais le handicap du match',()=>{
   const odds=parse([mk('Écart de buts à la MT',['Montpellier HB gagne de 5 ou +','Dunkerque ne perd pas ou perd de 4 ou -'])],teams);
   assert.equal(odds['hcp_home_-4.5'],undefined);
   assert.equal(odds['ht_hcp_home_-4.5'],2);
   assert.equal(odds['ht_hcp_away_4.5'],1.68);
   assert.equal(odds._ids['ht_hcp_home_-4.5'].market_name,'Écart de buts à la MT');
   assert.deepEqual(compareTwoBooks(odds,'betclic',{'hcp_away_4.5':2.84},'1xbet'),[]);
 });
 test(sport+' : Chartres-Limoges MT est séparé du match',()=>{
   const odds=parse([mk('Écart de buts à la MT',['Chartres Métropole HB 28 ne perd pas ou perd de 1 exactement','Limoges gagne de 2 ou +'])],{home:'Chartres Métropole HB 28',away:'Limoges'});
   assert.equal(odds['hcp_away_-1.5'],undefined);assert.equal(odds['ht_hcp_away_-1.5'],1.68);
 });
 test(sport+' : handicap complet conservé',()=>{const o=parse([mk('Écart de buts',['Montpellier HB gagne de 5 ou +','Dunkerque ne perd pas ou perd de 4 ou -'])],teams);assert.equal(o['hcp_home_-4.5'],2);assert.equal(o['hcp_away_4.5'],1.68);});
 test(sport+' : totaux match et deux mi-temps séparés',()=>{const o=parse(['Nombre total de buts','1ère mi-temps - Total de buts','2ème MT - Total de buts'].map(n=>mk(n,['+ de 29,5','- de 29,5'])),teams);for(const p of ['match_','ht_','h2_'])assert.equal(o[p+'over_29.5'],2);});
 test(sport+' : 1X2 et double chance conservés',()=>{const o=parse([mk('Résultat du match (tps rég.)',['Montpellier HB','Nul','Dunkerque']),mk('Double chance',['Montpellier HB ou Nul','Nul ou Dunkerque'])],teams);assert.equal(o.match_1,2);assert.equal(o.match_X,1.68);assert.equal(o.dc_1X,2);assert.equal(o.dc_X2,1.68);});
 test(sport+' : total individuel non mélangé au match',()=>{const o=parse([mk('Nombre de buts - Dunkerque',['+ de 25,5','- de 25,5'])],teams);assert.equal(o['tt_away_over_25.5'],2);assert.equal(o['match_over_25.5'],undefined);});
 test(sport+' : unités et combinés non comparables rejetés',()=>{for(const n of ['Nombre total de sets','Nombre de buts - Joueur inconnu','Mi-temps / Fin de match','Résultat & Nombre total de buts']) assert.deepEqual(keys(parse([mk(n,['+ de 2,5','- de 2,5'])],teams)),[]);});
}
test('Corners double chance ne pollue pas le résultat football',()=>{const o=betclicFlatOdds([mk('Double chance corners',['Montpellier HB ou Nul','Nul ou Dunkerque'])],teams);assert.equal(o.dc_1X,undefined);assert.equal(o.cor_dc_1X,2);});
test('Un écart exact supérieur à un n’est pas un handicap',()=>{assert.equal(ecartLine('Dunkerque ne perd pas ou perd de 2 exactement',teams.home,teams.away),null);const o=betclicFlatOdds([mk('Écart de buts',['Montpellier HB gagne de 3 buts exactement','Dunkerque ne perd pas ou perd de 2 exactement'])],teams);assert.deepEqual(keys(o),[]);});
for(const [sport,parse] of [['basket',betclicBasketFlatOdds],['volleyball',betclicVolleyballFlatOdds]]){
 test(sport+' : vainqueur, total points et handicap conservés',()=>{const o=parse([mk('Vainqueur du match',['Montpellier HB','Dunkerque']),mk('Nombre total de points',['+ de 170,5','- de 170,5']),mk('Écart de points entre les équipes',['Montpellier HB gagne de 5 ou +','Dunkerque ne perd pas ou perd de 4 ou -'])],teams);assert.equal(o.match_1,2);assert.equal(o['match_over_170.5'],2);assert.equal(o['hcp_home_-4.5'],2);});
 test(sport+' : quart, MT, set isolés ne sont pas le match',()=>{for(const n of ['Écart de points à la MT','Écart de points - 1er quart-temps','Écart de points - 2ème set']) assert.deepEqual(keys(parse([mk(n,['Montpellier HB gagne de 5 ou +','Dunkerque ne perd pas ou perd de 4 ou -'])],teams)),[]);});
}
test('Basket : total individuel MT non publié en total match',()=>assert.deepEqual(keys(betclicBasketFlatOdds([mk('Nombre total de points - Dunkerque à la MT',['+ de 45,5','- de 45,5'])],teams)),[]));
test('Tennis : jeux et sets ne partagent pas la même unité',()=>{const o=betclicTennisFlatOdds([mk('Nombre total de jeux',['+ de 20,5','- de 20,5']),mk('Écart de sets',['Montpellier HB gagne de 2 ou +','Dunkerque ne perd pas ou perd de 1 exactement'])],teams);assert.equal(o['match_over_20.5'],2);assert.equal(o['hcp_sets_home_-1.5'],2);assert.equal(o['hcp_home_-1.5'],undefined);});
test('Tennis : vainqueur de set ignoré',()=>assert.deepEqual(keys(betclicTennisFlatOdds([mk('Vainqueur du 1er set',['Montpellier HB','Dunkerque'])],teams)),[]));
test('Hockey : résultat et buts restent temps réglementaire',()=>{const o=betclicHockeyFlatOdds([mk('Résultat du match (tps rég.)',['Montpellier HB','Nul','Dunkerque']),mk('Nombre total de buts (tps rég.)',['+ de 5,5','- de 5,5'])],teams);assert.equal(o.match_1,2);assert.equal(o['match_over_5.5'],2);});
test('Hockey : vainqueur OT et période ne polluent pas le match',()=>{for(const n of ['Vainqueur du match','1ère période - Résultat'])assert.deepEqual(keys(betclicHockeyFlatOdds([mk(n,['Montpellier HB','Dunkerque'])],teams)),[]);});
test('Tennis de table : seul vainqueur à deux issues',()=>{const o=betclicTableTennisFlatOdds([mk('Vainqueur du match',['Montpellier HB','Dunkerque']),mk('Écart de points',['Montpellier HB gagne de 5 ou +','Dunkerque ne perd pas ou perd de 4 ou -']),mk('Nombre total de manches',['+ de 3,5','- de 3,5'])],teams);assert.deepEqual(keys(o),['match_1','match_2']);});
for(const [sport,parse] of [['football',betclicFlatOdds],['handball',betclicFlatOdds],['basket',betclicBasketFlatOdds],['volleyball',betclicVolleyballFlatOdds],['tennis',betclicTennisFlatOdds],['hockey',betclicHockeyFlatOdds],['table_tennis',betclicTableTennisFlatOdds]])test(sport+' : marché suspendu exclu',()=>assert.deepEqual(keys(parse([mk('Vainqueur du match',['Montpellier HB','Dunkerque'],{suspended:true})],teams)),[]));
test('Protection commune : une clé de match ne peut pas porter une MT',()=>{const odds={},ids={};makePut(odds,ids)('hcp_home_-4.5',{id:2,name:'Montpellier HB gagne de 5 ou +',odd:2},mk('Écart de buts à la MT',[]));assert.deepEqual(odds,{});});
