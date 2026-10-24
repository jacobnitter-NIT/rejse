import {readBookingIdentities,chooseIdentity,validPNR} from './booking-identities.mjs';
import {normalizeTravellers} from './portal-plan.mjs';
const flightCarrier=e=>String(e.flightNumber||'').trim().slice(0,2).toUpperCase();
const job='phuket-booking-identities-20261024';
export async function repairPhuketIdentities(db,env){
 await db.prepare('CREATE TABLE IF NOT EXISTS holiday_identity_repairs (job TEXT NOT NULL,document_id TEXT NOT NULL,state TEXT NOT NULL,backup_json TEXT NOT NULL,result_json TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(job,document_id))').run();
 const yearRepair=await db.prepare('SELECT holiday_id FROM holiday_year_repairs WHERE id=?').bind('phuket-year-2027-20261024').first();if(!yearRepair)return{state:'target-not-found'};
 const holidayId=yearRepair.holiday_id;
 const docs=(await db.prepare('SELECT id,type FROM holiday_documents WHERE holiday_id=? ORDER BY created').bind(holidayId).all()).results.filter(d=>d.type==='application/pdf');
 const processed=(await db.prepare('SELECT document_id,state,result_json FROM holiday_identity_repairs WHERE job=?').bind(job).all()).results;
 const next=docs.find(d=>!processed.some(p=>p.document_id===d.id));
 if(!next){const totals=processed.reduce((a,p)=>{const r=JSON.parse(p.result_json);a.references+=r.references||0;a.names+=r.names||0;a.unresolved+=r.unresolved||0;a.failed+=p.state==='failed'?1:0;return a},{references:0,names:0,unresolved:0,failed:0});const current=(await db.prepare('SELECT data FROM holiday_events WHERE holiday_id=?').bind(holidayId).all()).results.map(r=>JSON.parse(r.data)).filter(e=>e.type==='flight');const verification={flights:current.length,missingPNR:current.filter(e=>!validPNR(e.reference)).length,missingNames:current.filter(e=>!normalizeTravellers(e.travellers).length).length,wrongYear:current.filter(e=>!e.start.startsWith('2027-')||e.end&&!e.end.startsWith('2027-')).length,carriers:[...new Set(current.map(e=>flightCarrier(e)))].map(carrier=>({carrier,flights:current.filter(e=>flightCarrier(e)===carrier).length,missingPNR:current.filter(e=>flightCarrier(e)===carrier&&!validPNR(e.reference)).length,missingNames:current.filter(e=>flightCarrier(e)===carrier&&!normalizeTravellers(e.travellers).length).length}))};return{state:verification.missingPNR||verification.missingNames||totals.failed?'needs-review':'complete',done:processed.length,total:docs.length,...totals,verification}}
 if(!env.AI?.run||!env.AI?.toMarkdown||!env.BUCKET)return{state:'bindings-unavailable'};
 let outcome={references:0,names:0,unresolved:0},backup=[];
 try{
  const file=await env.BUCKET.get(`holiday-documents/${holidayId}/${next.id}`);if(!file)throw Error('source-unavailable');
  const identities=await readBookingIdentities(env,new Blob([await new Response(file.body).arrayBuffer()],{type:'application/pdf'}));
  const links=(await db.prepare('SELECT event_id FROM holiday_event_documents WHERE holiday_id=? AND document_id=?').bind(holidayId,next.id).all()).results.map(r=>r.event_id);
  const legacy=await db.prepare('SELECT event_id FROM holiday_documents WHERE id=? AND holiday_id=?').bind(next.id,holidayId).first();if(legacy?.event_id)links.push(legacy.event_id);
  const all=(await db.prepare('SELECT id,data,version FROM holiday_events WHERE holiday_id=?').bind(holidayId).all()).results;
  const candidates=links.length?all.filter(r=>links.includes(r.id)):all;
  const statements=[];
  for(const row of candidates){const event=JSON.parse(row.data);if(!['flight','hotel','activity'].includes(event.type))continue;const identity=chooseIdentity(event,identities);if(!identity){if(links.includes(row.id)&&event.type==='flight'&&(!validPNR(event.reference)||!normalizeTravellers(event.travellers).length))outcome.unresolved++;continue}
   const oldNames=normalizeTravellers(event.travellers),names=oldNames.length?oldNames:identity.travellers;
   const reference=event.type==='flight'&&identity.pnr?identity.pnr:event.reference||'';
   const updateReference=reference!==event.reference,updateNames=!oldNames.length&&names.length>0;
   if(event.type==='flight'&&!validPNR(reference)||!names.length)outcome.unresolved++;
   if(!updateReference&&!updateNames)continue;
   backup.push(row);
   // Change only the identity fields, guarded by the version used to match the
   // source. Dates (including the 2027 repair) and all other data are retained.
   statements.push(db.prepare("UPDATE holiday_events SET data=json_set(data,'$.reference',?,'$.travellers',json(?)),version=version+1,updated=? WHERE id=? AND holiday_id=? AND version=?").bind(reference,JSON.stringify(names),Date.now(),row.id,holidayId,row.version));
   outcome.references+=updateReference?1:0;outcome.names+=updateNames?1:0;
  }
  statements.push(db.prepare('INSERT INTO holiday_identity_repairs(job,document_id,state,backup_json,result_json,created) VALUES(?,?,?,?,?,?)').bind(job,next.id,'complete',JSON.stringify(backup),JSON.stringify(outcome),Date.now()));
  const results=await db.batch(statements);
  if(results.slice(0,-1).some(r=>!r.meta?.changes))return{state:'concurrent-edit-review-required'};
 }catch(error){await db.prepare('INSERT OR IGNORE INTO holiday_identity_repairs(job,document_id,state,backup_json,result_json,created) VALUES(?,?,?,?,?,?)').bind(job,next.id,'failed',JSON.stringify(backup),JSON.stringify({unresolved:1,error:'source-or-extraction-failed'}),Date.now()).run();return{state:'running',done:processed.length+1,total:docs.length,failed:true}}
 return{state:'running',done:processed.length+1,total:docs.length,...outcome};
}
