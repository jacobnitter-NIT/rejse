// Shared booking and itinerary helpers. No browser or storage dependencies.
export function normalizeTravellers(value){
 const raw=typeof value==='string'?value.split(/[\n,;]+/):value==null?[]:value;
 if(!Array.isArray(raw)||raw.length>10000)throw Error('Angiv højst 60 navne');
 const seen=new Set(),names=[];
 for(const item of raw){if(typeof item!=='string')throw Error('Navne skal være tekst');const name=item.trim().normalize('NFKC');if(!name)continue;if(name.length>100)throw Error('Et navn må højst være 100 tegn');const key=name.toLocaleLowerCase('da-DK');if(!seen.has(key)){seen.add(key);names.push(name);if(names.length>60)throw Error('Angiv højst 60 forskellige navne')}}
 return names;
}
const dateOf=value=>String(value||'').slice(0,10);
export function sortBookings(events){return [...events].sort((a,b)=>String(a.start||'9999').localeCompare(String(b.start||'9999'))||String(a.end||'').localeCompare(String(b.end||''))||String(a.title||'').localeCompare(String(b.title||''))||String(a.id||'').localeCompare(String(b.id||'')))}
const labels={flight:{start:'Afgang',end:'Ankomst'},hotel:{start:'Check-ind',end:'Check-ud'},activity:{start:'Tur / oplevelse',end:'Turen slutter'},transport:{start:'Transport starter',end:'Transport ankommer'},note:{start:'Praktisk info',end:'Slut'}};
export function buildTimeline(events,{day='',query='',traveller='',documentEventIds=null}={}){
 const needle=query.trim().toLocaleLowerCase('da-DK'),points=[];
 const allowed=documentEventIds==null?null:new Set(documentEventIds);
 for(const event of events){
  const people=normalizeTravellers(event.travellers);
  if(allowed&&!allowed.has(event.id))continue;
  if(traveller&&people.length&&!people.some(n=>n.toLocaleLowerCase('da-DK')===traveller.toLocaleLowerCase('da-DK')))continue;
  if(needle&&![event.title,event.from,event.to,event.provider,event.reference,event.notes,event.flightNumber,...people].join(' ').toLocaleLowerCase('da-DK').includes(needle))continue;
  if(!event.start)continue;
  const type=labels[event.type]||labels.note;
  function add(phase,at,dateOnly,label){if(!at||day&&dateOf(at)!==day)return;let sortAt=at;
   // With unspecified time zones a westbound arrival can have an earlier wall
   // time than its departure. Keep that same-day pair in travel order.
   if(phase==='end'&&dateOf(at)===dateOf(event.start)&&at<event.start)sortAt=event.start+'~';
   points.push({id:event.id+':'+phase,eventId:event.id,event,phase,at,day:dateOf(at),dateOnly:!!dateOnly,label,sortAt});
  }
  add('start',event.start,event.startDateOnly,type.start);
  if(event.end&&(event.end!==event.start||['flight','hotel'].includes(event.type)))add('end',event.end,event.endDateOnly,type.end);
  if(day&&event.type==='hotel'&&dateOf(event.start)<day&&dateOf(event.end)>day)add('stay',day+'T00:00',true,'Ophold / overnatning');
 }
 return points.sort((a,b)=>a.day.localeCompare(b.day)||a.sortAt.localeCompare(b.sortAt)||a.eventId.localeCompare(b.eventId)||a.phase.localeCompare(b.phase));
}
export function linkedEventIds(document,events){const existing=new Set(events.map(e=>e.id));return [...new Set([document.event_id,...document.event_ids||[]].filter(id=>id&&existing.has(id)))];}
