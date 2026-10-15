const R=Deno.env.get("YB_RELAY_URL")!,S=Deno.env.get("YB_RELAY_SECRET")||"";
const relay=async(paths:string[])=>{const t=Date.now();const r=await fetch(R,{method:"POST",headers:{"content-type":"application/json","x-relay-secret":S},body:JSON.stringify({requests:paths.map(path=>({path,method:"GET"}))}),signal:AbortSignal.timeout(25000)}).then(x=>x.json()).catch(e=>({e:String(e)}));
const res=(r.results||[]).map((x:any)=>{let j:any;try{j=JSON.parse(x.text)}catch{};const d=j?.data||[];return {st:x.status,kb:Math.round((x.text||"").length/1024),n:d.length,liveFoot:d.filter((e:any)=>e.lv&&e.sid===31).length}});return {ms:Date.now()-t,res,err:r.e};};
const P="/services/evapi/event/GetEvents?take=300&skip=0";
const V:Record<string,string[]>={
 actuel_5pages:[0,300,600,900,1200].map(s=>"/services/evapi/event/GetEvents?take=300&eventTypeId=0&skip="+s+"&betTypeIds=-1"),
 live_type1_mk:[P+"&eventTypeId=1&betTypeIds=-1"],
 live_type1:[P+"&eventTypeId=1"],
 live_type1_sport:[P+"&eventTypeId=1&sportId=31"],
 live_type1_bt0:[P+"&eventTypeId=1&betTypeIds=0"],
 type0_nomk:[P+"&eventTypeId=0"],
};
for(const [k,p] of Object.entries(V)){const a=[];for(let i=0;i<3;i++)a.push(await relay(p));console.log("VAR",k,JSON.stringify(a.map(x=>({ms:x.ms,res:x.res,err:x.err}))));}
for(const u of ["https://yellowbet.cg"+P+"&eventTypeId=1","https://www.yellowbet.cg"+P+"&eventTypeId=1"]){const t=Date.now();const r=await fetch(u,{headers:{accept:"application/json","user-agent":"Mozilla/5.0 Chrome/124"}}).catch(()=>null);console.log("DIRECT",u.slice(8,24),r?.status,Date.now()-t);}
const l=await relay([P+"&eventTypeId=1"]);
