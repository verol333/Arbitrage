const get=async(p:string)=>{const t=Date.now();const r=await fetch("https://yellowbet.cg"+p,{headers:{accept:"application/json","user-agent":"Mozilla/5.0 Chrome/124"},signal:AbortSignal.timeout(15000)}).catch(()=>null);const x=r?await r.text():"";let j:any;try{j=JSON.parse(x)}catch{};const d=j?.data||[];return {st:r?.status,ms:Date.now()-t,kb:Math.round(x.length/1024),n:d.length,lf:d.filter((e:any)=>e.lv&&e.sid===31).length,bts:d.find((e:any)=>e.lv&&e.sid===31)?.bts?.length,lvKeys:Object.keys(d.find((e:any)=>e.lv)?.lv||{}).join(",")};};
const P="/services/evapi/event/GetEvents?take=300&skip=0";
const V:Record<string,string[]>={
 actuel_5pages:[0,300,600,900,1200].map(s=>"/services/evapi/event/GetEvents?take=300&eventTypeId=0&skip="+s+"&betTypeIds=-1"),
 live1_mk:[P+"&eventTypeId=1&betTypeIds=-1"], live1:[P+"&eventTypeId=1"], live1_sport:[P+"&eventTypeId=1&sportId=31"], live1_sport_mk:[P+"&eventTypeId=1&sportId=31&betTypeIds=-1"], live2:[P+"&eventTypeId=2"], type0:[P+"&eventTypeId=0"],
};
for(const [k,p] of Object.entries(V)){for(let i=0;i<3;i++){const t=Date.now();const a=await Promise.all(p.map(get));console.log("VAR",k,Date.now()-t,JSON.stringify(a));}}
const l=await fetch("https://yellowbet.cg"+P+"&eventTypeId=0&betTypeIds=-1").then(r=>r.json());const ev=(l.data||[]).find((e:any)=>e.lv&&e.sid===31);
if(ev){for(let i=0;i<4;i++){const t=Date.now();const r=await get("/services/evapi/event/GetEvents?take=5&eventTypeId=0&skip=0&eventIds="+ev.id);console.log("SNAP",JSON.stringify(r));}
const t=Date.now();const r=await get("/services/evapi/event/GetEvents?take=5&eventTypeId=0&skip=0&eventIds="+ev.id+"&betTypeIds=-1");console.log("SNAPMK",JSON.stringify(r));}
