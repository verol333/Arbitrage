import assert from 'node:assert/strict';
import { b9Event } from '../src/bookmakers/bet9ja/api.js';
import { parseB9Basket } from '../src/bookmakers/bet9ja/parseBasket.js';
const ids=[820921618,820921107,864799015,864801406];
for (const id of ids) {
 const D=await b9Event(id,{noCache:true});
 assert.equal(Number(D.SID),2);
 const {odds,mappedMarkets,ignored}=parseB9Basket(D);
 assert.equal(odds.match_1,Number(D.O.B_12_1));
 assert.equal(odds.match_2,Number(D.O.B_12_2));
 assert.equal(odds.match_X,undefined);
 let checked=2;
 for (const [sid,value] of Object.entries(D.O)) {
  const m=sid.match(/^B_H@(-?\d+\.5)_([12])$/);
  if(m) { const line=Number(m[1]); const key=m[2]==='1'?'hcp_home_'+line:'hcp_away_'+(-line); assert.equal(odds[key],Number(value)); assert.equal(odds._ids[key].sid,sid); checked++; }
  const t=sid.match(/^B_(OUN|OUH|OUA)@(\d+\.5)_([OU])$/);
  if(t) { const prefix={OUN:'match_',OUH:'tt_home_',OUA:'tt_away_'}[t[1]]; const key=prefix+(t[3]==='O'?'over_':'under_')+Number(t[2]); assert.equal(odds[key],Number(value)); assert.equal(odds._ids[key].sid,sid); checked++; }
 }
 for(const [key,meta] of Object.entries(odds._ids)) { assert.equal(Number(D.O[meta.sid]),odds[key]); assert.ok(!/^B_(1X2|OURT|DNB|2H|4Q|21X2)/.test(meta.sid)); }
 assert.ok(checked>=10);
 assert.equal(parseB9Basket({...D,SID:5,S:'Tennis'}).odds.match_1,undefined);
 console.log(JSON.stringify({event:id,match:D.DS,checked,keys:Object.keys(odds._ids).length,mappedMarkets,ignored,status:'PASS'}));
}
console.log('BET9JA_BASKET_VALIDATED_4_MATCHES');
