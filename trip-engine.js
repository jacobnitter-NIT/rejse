/* Integer minor-unit accounting. Runs in browser and Node tests. */
(function(root){
  const digits=c=>new Intl.NumberFormat('en',{style:'currency',currency:c}).resolvedOptions().maximumFractionDigits;
  const units=(n,c='DKK')=>Math.round(Number(String(n).replace(',','.'))*10**digits(c));
  function allocate(total,values){
    if(!Number.isSafeInteger(total)||total<0)throw Error('Beløbet er ugyldigt');
    const sum=values.reduce((a,b)=>a+b,0);
    if(!values.length||values.some(v=>!Number.isFinite(v)||v<0)||sum<=0)throw Error('Vælg mindst én deltager med en positiv andel');
    const raw=values.map(v=>total*v/sum),out=raw.map(Math.floor);
    const order=raw.map((v,i)=>({i,r:v-out[i]})).sort((a,b)=>b.r-a.r||a.i-b.i);
    for(let i=0,left=total-out.reduce((a,b)=>a+b,0);i<left;i++)out[order[i%order.length].i]++;
    return out;
  }
  function shares(total,mode,rows,currency){
    if(!rows.length||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Vælg forskellige deltagere');
    const values=rows.map(r=>Number(String(r.value??1).replace(',','.')));
    if(values.some(v=>!Number.isFinite(v)||v<0))throw Error('Fordelingen skal være positive tal');
    let amounts;
    if(mode==='amount'){
      amounts=rows.map(r=>units(r.value,currency));
      if(amounts.reduce((a,b)=>a+b,0)!==total)throw Error('De faste beløb skal tilsammen svare til udgiften');
    }else{
      if(mode==='percent'&&Math.abs(values.reduce((a,b)=>a+b,0)-100)>.000001)throw Error('Procenterne skal tilsammen give 100 %');
      if(!['equal','percent','weight'].includes(mode))throw Error('Ukendt fordeling');
      amounts=allocate(total,mode==='equal'?values.map(()=>1):values);
    }
    return rows.map((r,i)=>({id:r.id,units:amounts[i]}));
  }
  function balances(trip){
    const balance=Object.fromEntries(trip.people.map(p=>[p.id,0]));
    for(const e of trip.expenses){
      for(const p of e.paid){if(!(p.id in balance))throw Error('Ukendt betaler');balance[p.id]+=p.units}
      for(const p of e.shares){if(!(p.id in balance))throw Error('Ukendt deltager');balance[p.id]-=p.units}
    }
    for(const s of trip.settlements){balance[s.from]+=s.units;balance[s.to]-=s.units}
    if(Object.values(balance).reduce((a,b)=>a+b,0)!==0)throw Error('Regnskabet stemmer ikke');
    return balance;
  }
  function transfers(trip){
    const b=balances(trip),credit=Object.entries(b).filter(([,n])=>n>0).map(([id,n])=>({id,n})).sort((a,b)=>b.n-a.n),debit=Object.entries(b).filter(([,n])=>n<0).map(([id,n])=>({id,n:-n})).sort((a,b)=>b.n-a.n),out=[];
    let i=0,j=0;
    while(i<debit.length&&j<credit.length){const n=Math.min(debit[i].n,credit[j].n);out.push({from:debit[i].id,to:credit[j].id,units:n});debit[i].n-=n;credit[j].n-=n;if(!debit[i].n)i++;if(!credit[j].n)j++}
    return out;
  }
  function validateTrip(t){
    const id=s=>typeof s==='string'&&/^[-\w]{8,64}$/.test(s),amount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e12;
    if(!t||!id(t.id)||typeof t.name!=='string'||!t.name.trim()||t.name.length>120||!Number.isFinite(t.updated)||!Array.isArray(t.people)||!t.people.length||t.people.length>60||!Array.isArray(t.expenses)||!Array.isArray(t.settlements)||t.expenses.length>5000||t.settlements.length>5000||!/^[A-Z]{3}$/.test(t.currency)||t.digits!==digits(t.currency)||t.token&&!/^[a-f0-9]{64}$/.test(t.token))throw Error('Ugyldige rejsedata');
    const ids=new Set();for(const p of t.people){if(!id(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>80)throw Error('Ugyldig rejsefælle');ids.add(p.id)}
    const records=new Set(),check=e=>{if(!id(e.id)||records.has(e.id))throw Error('Ugyldig post');records.add(e.id)};
    for(const e of t.expenses){check(e);if(typeof e.title!=='string'||!e.title.trim()||e.title.length>200||typeof e.date!=='string'||!amount(e.units)||e.units===0||!Array.isArray(e.paid)||!Array.isArray(e.shares)||!e.paid.length||!e.shares.length)throw Error('Ugyldigt udlæg');for(const rows of [e.paid,e.shares]){const seen=new Set();let sum=0;for(const r of rows){if(!ids.has(r.id)||seen.has(r.id)||!amount(r.units))throw Error('Ugyldig fordeling');seen.add(r.id);sum+=r.units}if(sum!==e.units)throw Error('Udlæg stemmer ikke')}}
    for(const s of t.settlements){check(s);if(!ids.has(s.from)||!ids.has(s.to)||s.from===s.to||!amount(s.units)||!s.units)throw Error('Ugyldig tilbagebetaling')}
    return t;
  }
  const api={digits,units,allocate,shares,balances,transfers,validateTrip};
  if(typeof module!=='undefined')module.exports=api;else root.TripEngine=api;
})(globalThis);
