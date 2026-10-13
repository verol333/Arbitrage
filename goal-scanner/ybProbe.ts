import { ybList, ybSnap } from "./base44/shared/yellowbetLive.ts";
const t=Date.now();const l=await ybList();console.log("YBLIST",l.length,Date.now()-t,"ms",JSON.stringify(l.slice(0,3)));
if(l[0]){const t2=Date.now();const s=await ybSnap(l[0].id);console.log("YBSNAP",Date.now()-t2,"ms",JSON.stringify(s?{score:s.score,keys:Object.keys(s.mk).slice(0,12),locked:s.locked.size}:null));}
const r=await fetch("https://yellowbet.cg/services/evapi/event/GetEvents?take=1&eventTypeId=0&skip=0");console.log("DIRECT",r.status);