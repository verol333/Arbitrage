import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sportybetFlatOdds } from './parse.js';
const market = (id, name, specifier, a=1.80, b=1.90) => ({id:String(id),name,desc:name,specifier,status:0,outcomes:[{id:'1714',desc:'Home',odds:String(a),isActive:1},{id:'1715',desc:'Away',odds:String(b),isActive:1}]});
const parse = markets => sportybetFlatOdds(markets,{sport:'table_tennis'});
test('TT 187 Game Handicap is SETS, never points (Maxibet MatchPointHandicap)',()=>{
 const o=parse([market(187,'Game Handicap','hcp=1.5',9.25,1.02)]);
 assert.equal(o['hcp_sets_home_1.5'],9.25); assert.equal(o['hcp_home_1.5'],undefined);
 assert.equal(o['hcp_sets_away_-1.5'],1.02);
});
test('TT 237 Point Handicap stays separate, sign is native-home based',()=>{
 const o=parse([market(187,'Game Handicap','hcp=-1.5'),market(237,'Point Handicap','hcp=-6.5',1.9,1.85)]);
 assert.equal(o['hcp_home_-6.5'],1.9); assert.equal(o['hcp_away_6.5'],1.85);
 assert.equal(o._ids['hcp_home_-6.5'].marketId,'237');
 assert.equal(o['hcp_home_-1.5'],undefined);
});
test('TT 246 first-game handicap never becomes full-match points',()=>{
 const o=parse([market(246,'xth game - point handicap','hcp=-2.5|gamenr=1',1.70,1.95)]);
 assert.equal(o['s1_hcp_home_-2.5'],1.70); assert.equal(o['hcp_home_-2.5'],undefined);
});
test('TT totals use point-market 238 and game-market 247 separately',()=>{
 const mk=(id,spec)=>({id,specifier:spec,status:0,outcomes:[{id:'12',odds:'1.75',isActive:1},{id:'13',odds:'2.00',isActive:1}]});
 const o=parse([mk('238','total=73.5'),mk('247','total=18.5|gamenr=1')]);
 assert.equal(o['match_over_73.5'],1.75); assert.equal(o['s1_under_18.5'],2);
 assert.equal(o['match_under_18.5'],undefined);
});
test('TT gamenr must not be misread from an unrelated specifier key',()=>{
 assert.equal(parse([market(246,'point handicap','hcp=-2.5|othergamenr=1')])['s1_hcp_home_-2.5'],undefined);
});
test('TT suspended markets stay excluded',()=>assert.equal(parse([{...market(237,'Point Handicap','hcp=-6.5'),status:1}])['hcp_home_-6.5'],undefined));
test('tennis retains the original 187 GAMES mapping',()=>{
 const o=sportybetFlatOdds([market(187,'Game Handicap','hcp=-1.5')],{sport:'tennis'});
 assert.equal(o['hcp_home_-1.5'],1.8); assert.equal(o['hcp_sets_home_-1.5'],undefined);
});
