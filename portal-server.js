import {previewItinerary,itineraryFingerprint} from './itinerary-ai.js';
import {ownerAuthorized} from './server-features.js';

const enc=new TextEncoder(), DAY=86400000, MAX_FILE=20*1024*1024;
const reply=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
function fail(message,status=400){const e=new Error(message);e.status=status;throw e}
const uuid=()=>crypto.randomUUID();
const hex=bytes=>Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const hashToken=async value=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(value))));
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const clean=(value,max,required=false)=>{if(value!=null&&typeof value!=='string')fail('Ugyldig tekst');const s=(value||'').trim();if(s.length>max||required&&!s)fail('Udfyld felterne, og forkort for lange tekster');return s};
const emailAddress=value=>{const email=clean(value,254,true).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Indtast en gyldig e-mail');return email};
export function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value)fail('Ugyldig dato');return value}
function localTime(value){if(!value)return '';if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))fail('Ugyldigt tidspunkt');validDate(value.slice(0,10));return value}
function zone(value){const z=clean(value,80);if(z){try{new Intl.DateTimeFormat('en',{timeZone:z})}catch{fail('Brug en tidszone som Asia/Bangkok eller Europe/Copenhagen')}}return z}
export function validateHoliday(d){
 const start=validDate(d.start),end=validDate(d.end);if(end<start||Date.parse(end)-Date.parse(start)>366*DAY)fail('Vælg en periode på højst ét år med slutdato efter startdato');
 return{name:clean(d.name,120,true),destination:clean(d.destination,200),start,end,notes:clean(d.notes,10000)};
}
export function validateEvent(d){
 const type=clean(d.type,20,true);if(!['flight','hotel','transport','activity','note'].includes(type))fail('Ugyldig plantype');
 const startDateOnly=type!=='flight'&&d.startDateOnly===true,endDateOnly=type!=='flight'&&d.endDateOnly===true;let start=localTime(d.start),end=localTime(d.end);if(startDateOnly&&start)start=start.slice(0,10)+'T00:00';if(endDateOnly&&end)end=end.slice(0,10)+'T00:00';if(!start)fail('Vælg dato og tidspunkt');
 // Local times across time zones are deliberately not compared as UTC instants.
 if(type==='hotel'&&end&&((startDateOnly||endDateOnly)?end.slice(0,10)<start.slice(0,10):end<start))fail('Check-ud skal være efter check-ind');
 const status=d.status||'planned';if(!['planned','confirmed','cancelled'].includes(status))fail('Ugyldig status');
 return{type,title:clean(d.title,200,true),start,end,startDateOnly,endDateOnly,startZone:zone(d.startZone),endZone:zone(d.endZone),from:clean(d.from,200),to:clean(d.to,200),provider:clean(d.provider,160),reference:clean(d.reference,120),flightNumber:clean(d.flightNumber,40),address:clean(d.address,400),notes:clean(d.notes,6000),status};
}
async function readBytes(request,limit){const reader=request.body?.getReader();if(!reader)fail('Tom forespørgsel');const chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail('Filen eller forespørgslen er for stor',413)}chunks.push(value)}const bytes=new Uint8Array(size);let n=0;for(const c of chunks){bytes.set(c,n);n+=c.length}return bytes}
async function body(request,limit=40000){try{const d=JSON.parse(new TextDecoder().decode(await readBytes(request,limit)));if(!d||typeof d!=='object'||Array.isArray(d))fail('Ugyldig forespørgsel');return d}catch(e){if(e.status)throw e;fail('Ugyldig forespørgsel')}}
const ready=new WeakMap();
async function schema(db){
 if(!db)fail('Ferieportal kræver den eksisterende D1-binding DB',503);
 if(!ready.has(db)){const p=db.batch([
  'CREATE TABLE IF NOT EXISTS holiday_accounts (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS holiday_admins (user_id TEXT PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS holiday_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS holidays (id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS holiday_members (holiday_id TEXT NOT NULL,user_id TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(holiday_id,user_id))',
  'CREATE TABLE IF NOT EXISTS holiday_invites (token_hash TEXT PRIMARY KEY,holiday_id TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL,expires INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS holiday_events (id TEXT PRIMARY KEY,holiday_id TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS holiday_documents (id TEXT PRIMARY KEY,holiday_id TEXT NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL,size INTEGER NOT NULL,category TEXT NOT NULL,event_id TEXT NOT NULL DEFAULT \'\',uploader_id TEXT NOT NULL,created INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS holiday_event_documents (holiday_id TEXT NOT NULL,event_id TEXT NOT NULL,document_id TEXT NOT NULL,PRIMARY KEY(holiday_id,event_id,document_id))',
  'CREATE TABLE IF NOT EXISTS holiday_auth_limits (key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,window INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS holiday_session_user ON holiday_sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS holiday_event_parent ON holiday_events(holiday_id)',
  'CREATE INDEX IF NOT EXISTS holiday_doc_parent ON holiday_documents(holiday_id)',
  'CREATE INDEX IF NOT EXISTS holiday_invite_parent ON holiday_invites(holiday_id)'
 ].map(sql=>db.prepare(sql))).catch(e=>{ready.delete(db);throw e});ready.set(db,p)}await ready.get(db);
}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},key,256)))}
function password(value){if(typeof value!=='string'||value.length<12||value.length>128)fail('Adgangskoden skal være mellem 12 og 128 tegn');return value}
function same(a,b){let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0}
function cookieToken(request){return request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-holiday_session=([a-f0-9]{64})(?:;|$)/)?.[1]||''}
async function session(request,db){const token=cookieToken(request);if(!token)return null;return db.prepare('SELECT a.id,a.email,a.name,CASE WHEN adm.user_id IS NULL THEN 0 ELSE 1 END AS admin FROM holiday_sessions s JOIN holiday_accounts a ON a.id=s.user_id LEFT JOIN holiday_admins adm ON adm.user_id=a.id WHERE s.token_hash=? AND s.expires>?').bind(await hashToken(token),Date.now()).first()}
async function issueSession(db,account){const token=random();await db.batch([db.prepare('DELETE FROM holiday_sessions WHERE expires<?').bind(Date.now()),db.prepare('INSERT INTO holiday_sessions(token_hash,user_id,expires) VALUES(?,?,?)').bind(await hashToken(token),account.id,Date.now()+30*DAY)]);const admin=!!await db.prepare('SELECT user_id FROM holiday_admins WHERE user_id=?').bind(account.id).first();return reply({user:{id:account.id,email:account.email,name:account.name,admin}},200,{'Set-Cookie':`__Host-holiday_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`})}
async function throttle(db,request,email){const now=Date.now(),window=Math.floor(now/(10*60*1000)),ip=request.headers.get('CF-Connecting-IP')||'local';for(const raw of ['ip:'+ip,'email:'+email]){const key=await hashToken(raw);await db.prepare('INSERT INTO holiday_auth_limits(key,attempts,window) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END,window=excluded.window').bind(key,window).run();const r=await db.prepare('SELECT attempts FROM holiday_auth_limits WHERE key=?').bind(key).first();if(r.attempts>15)fail('For mange forsøg. Vent ti minutter, og prøv igen.',429)}await db.prepare('DELETE FROM holiday_auth_limits WHERE window<?').bind(window-1).run()}
async function invite(db,token){if(!/^[a-f0-9]{64}$/.test(token||''))fail('Invitationen er ugyldig eller udløbet',404);const row=await db.prepare('SELECT i.*,h.data FROM holiday_invites i JOIN holidays h ON h.id=i.holiday_id WHERE i.token_hash=? AND i.expires>?').bind(await hashToken(token),Date.now()).first();if(!row)fail('Invitationen er ugyldig eller udløbet',404);return row}
async function membership(db,holidayId,user){if(!validId(holidayId))fail('Ferien findes ikke',404);if(user.admin){const row=await db.prepare('SELECT * FROM holidays WHERE id=?').bind(holidayId).first();if(!row)fail('Ferien findes ikke',404);return{...row,role:'admin'}}const row=await db.prepare('SELECT h.*,m.role FROM holidays h JOIN holiday_members m ON h.id=m.holiday_id WHERE h.id=? AND m.user_id=?').bind(holidayId,user.id).first();if(!row)fail('Du har ikke adgang til denne ferie',404);return row}
const editRole=m=>{if(!['owner','editor','admin'].includes(m.role))fail('Du har læseadgang. Kun ejeren og redaktører kan ændre planen.',403)};
const ownerRole=m=>{if(!['owner','admin'].includes(m.role))fail('Kun ferieejeren kan administrere adgang',403)};
function version(request){const n=Number(request.headers.get('If-Match'));if(!Number.isSafeInteger(n)||n<1)fail('Hent den seneste version før du gemmer',409);return n}
function changed(result){if(!result.meta?.changes)fail('Planen er ændret af en rejsefælle. Luk vinduet og hent den nyeste version. Dine indtastninger er ikke gemt.',409)}
const publicHoliday=row=>({id:row.id,...JSON.parse(row.data),version:row.version,updated:row.updated,role:row.role});
async function details(db,row){const id=row.id;const [events,documents,members,links]=await Promise.all([
 db.prepare('SELECT id,data,version,updated FROM holiday_events WHERE holiday_id=? ORDER BY updated').bind(id).all(),
 db.prepare('SELECT id,name,type,size,category,event_id,created FROM holiday_documents WHERE holiday_id=? ORDER BY created DESC').bind(id).all(),
 db.prepare('SELECT a.id,a.name,a.email,m.role FROM holiday_members m JOIN holiday_accounts a ON a.id=m.user_id WHERE m.holiday_id=? ORDER BY a.name').bind(id).all(),
 db.prepare('SELECT event_id,document_id FROM holiday_event_documents WHERE holiday_id=?').bind(id).all()
 ]);return reply({holiday:publicHoliday(row),events:events.results.map(e=>({id:e.id,...JSON.parse(e.data),version:e.version})),documents:documents.results.map(d=>({...d,event_ids:links.results.filter(l=>l.document_id===d.id).map(l=>l.event_id)})),members:members.results})}
const mimeTypes=new Set(['application/pdf','image/jpeg','image/png','image/webp']);
export function validFile(bytes,type){if(!mimeTypes.has(type)||bytes.length<12)return false;const h=String.fromCharCode(...bytes.slice(0,12));return type==='application/pdf'?h.startsWith('%PDF-'):type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:type==='image/png'?bytes[0]===137&&h.slice(1,4)==='PNG':h.startsWith('RIFF')&&h.slice(8,12)==='WEBP'}


async function portal({request,env,params}){
 const path=params.path||[];if(path[0]!=='portal')return null;
 const method=request.method,url=new URL(request.url),db=env.DB;
 if(!['GET','HEAD'].includes(method)&&(request.headers.get('Origin')!==url.origin||request.headers.get('X-Portal-Request')!=='1'))fail('Forespørgslen skal komme fra ferieportalen',403);
 await schema(db);
 const [,kind,id,sub,child]=path;

 if(kind==='auth'){


  if(id==='me'&&method==='GET')return reply({user:await session(request,db)});
  if(id==='logout'&&method==='POST'){const token=cookieToken(request);if(token)await db.prepare('DELETE FROM holiday_sessions WHERE token_hash=?').bind(await hashToken(token)).run();return reply({ok:true},200,{'Set-Cookie':'__Host-holiday_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'})}
  if(['login','register'].includes(id)&&method==='POST'){
   const d=await body(request),email=emailAddress(d.email);await throttle(db,request,email);const pw=password(d.password);
   if(id==='login'){const account=await db.prepare('SELECT * FROM holiday_accounts WHERE email=?').bind(email).first();const actual=await passwordHash(pw,account?.salt||'missing-account-salt');if(!account||!same(actual,account.password_hash))fail('E-mail eller adgangskode er forkert',401);return issueSession(db,account)}
   if(!ownerAuthorized(request,env)&&!(await session(request,db))?.admin){if(!d.invite)fail('Din synkroniseringsnøgle mangler eller er forkert. Indtast den for at oprette din egen konto. Rejsefæller skal bruge deres invitationslink.',401);const invitation=await invite(db,d.invite);if(invitation.email!==email)fail('Brug den e-mailadresse invitationen er oprettet til',403)}
   const name=clean(d.name,100,true);if(await db.prepare('SELECT id FROM holiday_accounts WHERE email=?').bind(email).first())fail('Der findes allerede en konto med denne e-mail. Log ind i stedet.',409);
   const account={id:uuid(),email,name},salt=random(),password_hash=await passwordHash(pw,salt);
   try{await db.prepare('INSERT INTO holiday_accounts(id,email,name,salt,password_hash,created) VALUES(?,?,?,?,?,?)').bind(account.id,email,name,salt,password_hash,Date.now()).run()}catch{fail('Kontoen kunne ikke oprettes. Prøv at logge ind.',409)}
   return issueSession(db,account);
  }
  if(id==='password'&&method==='POST'){const user=await session(request,db);if(!user)fail('Log ind først',401);const d=await body(request);await throttle(db,request,user.email);const account=await db.prepare('SELECT * FROM holiday_accounts WHERE id=?').bind(user.id).first();if(!same(await passwordHash(password(d.currentPassword),account.salt),account.password_hash))fail('Den nuværende adgangskode er forkert',401);const salt=random(),hashed=await passwordHash(password(d.newPassword),salt);await db.batch([db.prepare('UPDATE holiday_accounts SET salt=?,password_hash=? WHERE id=?').bind(salt,hashed,user.id),db.prepare('DELETE FROM holiday_sessions WHERE user_id=?').bind(user.id)]);return issueSession(db,user)}
  fail('Ukendt handling',404);
 }
 if(kind==='invitations'&&id&&method==='GET'){const i=await invite(db,id);return reply({holidayName:JSON.parse(i.data).name,email:i.email,role:i.role,expires:i.expires})}
 const user=await session(request,db);if(!user)fail('Log ind for at åbne ferieportalen',401);
 if(kind==='invitations'&&id&&method==='POST'){
  const i=await invite(db,id);if(i.email!==user.email)fail('Invitationen er til en anden e-mailadresse',403);
  await db.batch([
   db.prepare('INSERT OR IGNORE INTO holiday_members(holiday_id,user_id,role) SELECT holiday_id,?,role FROM holiday_invites WHERE token_hash=? AND email=? AND expires>?').bind(user.id,i.token_hash,user.email,Date.now()),
   db.prepare('DELETE FROM holiday_invites WHERE token_hash=? AND EXISTS(SELECT 1 FROM holiday_members WHERE holiday_id=? AND user_id=?)').bind(i.token_hash,i.holiday_id,user.id)
  ]);
  await membership(db,i.holiday_id,user);return reply({id:i.holiday_id});
 }
 if(kind!=='holidays')fail('Ukendt side',404);
 if(!id&&method==='GET'&&user.admin){const r=await db.prepare('SELECT *,\'admin\' AS role FROM holidays ORDER BY updated DESC').all();return reply({holidays:r.results.map(publicHoliday)})}
 if(!id&&method==='GET'){const r=await db.prepare('SELECT h.*,m.role FROM holidays h JOIN holiday_members m ON h.id=m.holiday_id WHERE m.user_id=? ORDER BY updated DESC').bind(user.id).all();return reply({holidays:r.results.map(publicHoliday)})}
 if(!id&&method==='POST'){const data=validateHoliday(await body(request)),id=uuid();await db.batch([db.prepare('INSERT INTO holidays(id,owner_id,data,version,updated) VALUES(?,?,?,1,?)').bind(id,user.id,JSON.stringify(data),Date.now()),db.prepare('INSERT INTO holiday_members(holiday_id,user_id,role) VALUES(?,?,?)').bind(id,user.id,'owner')]);return reply({id},201)}
 const m=await membership(db,id,user);
 if(!sub&&method==='GET')return details(db,m);
 if(!sub&&method==='PUT'){editRole(m);const data=validateHoliday(await body(request));changed(await db.prepare('UPDATE holidays SET data=?,version=version+1,updated=? WHERE id=? AND version=?').bind(JSON.stringify(data),Date.now(),id,version(request)).run());return details(db,await membership(db,id,user))}
 if(sub==='import-preview'&&method==='POST'){
  editRole(m);const d=await body(request);if(!validId(d.documentId))fail('Vælg en gemt PDF');
  const doc=await db.prepare('SELECT * FROM holiday_documents WHERE id=? AND holiday_id=?').bind(d.documentId,id).first();if(!doc)fail('Dokumentet findes ikke i denne ferie',404);if(doc.type!=='application/pdf')fail('Automatisk rejseimport understøtter PDF-filer');if(!env.BUCKET)fail('Dokumentlageret er ikke tilgængeligt',503);
  const window=Math.floor(Date.now()/600000),key=await hashToken('itinerary-import:'+user.id);
  await db.prepare('INSERT INTO holiday_auth_limits(key,attempts,window) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END,window=excluded.window').bind(key,window).run();
  const usage=await db.prepare('SELECT attempts FROM holiday_auth_limits WHERE key=?').bind(key).first();if(usage.attempts>20)fail('Du har læst mange rejseplaner. Vent ti minutter og prøv igen.',429);
  const file=await env.BUCKET.get(`holiday-documents/${id}/${doc.id}`);if(!file)fail('Dokumentfilen findes ikke',404);
  const bytes=await new Response(file.body).arrayBuffer();const result=await previewItinerary(env,new Blob([bytes],{type:'application/pdf'}));
  const existing=(await db.prepare('SELECT data FROM holiday_events WHERE holiday_id=?').bind(id).all()).results.map(r=>itineraryFingerprint(JSON.parse(r.data)));
  const events=result.events.map(f=>({...f,duplicate:existing.includes(itineraryFingerprint(f))}));return reply({...result,documentId:doc.id,events,flights:events.filter(f=>f.type==='flight')});
 }
 if(['import-flights','import-events'].includes(sub)&&method==='POST'){
  editRole(m);const d=await body(request,240000),items=sub==='import-flights'?d.flights:d.events;if(!validId(d.documentId)||!Array.isArray(items)||!items.length||items.length>30)fail('Vælg mellem 1 og 30 bookinger');
  if(!await db.prepare('SELECT id FROM holiday_documents WHERE id=? AND holiday_id=?').bind(d.documentId,id).first())fail('Dokumentet findes ikke i denne ferie',404);
  const flights=items.map(f=>{if(!['flight','hotel','activity'].includes(f?.type)||sub==='import-flights'&&f.type!=='flight')fail('Ugyldig bookingtype');const value=validateEvent(f);if(value.type==='flight'&&(!value.from||!value.to||!value.end))fail('Udfyld fra, til samt afgangs- og ankomstdato for alle valgte flyvninger');if(value.type==='hotel'&&!value.end)fail('Udfyld check-ind- og check-ud-dato for alle hoteller');return value});
  const current=(await db.prepare('SELECT id,data FROM holiday_events WHERE holiday_id=?').bind(id).all()).results;
  const fingerprints=new Map(current.map(r=>[itineraryFingerprint(JSON.parse(r.data)),r.id]));const statements=[],ids=new Set();
  for(const f of flights){const fp=itineraryFingerprint(f);let eventId=fingerprints.get(fp);
   if(!eventId){const h=await hashToken(id+'|import|'+fp);eventId=h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20,32)}
   if(ids.has(eventId))continue;ids.add(eventId);
   statements.push(db.prepare('INSERT OR IGNORE INTO holiday_events(id,holiday_id,data,version,updated) VALUES(?,?,?,1,?)').bind(eventId,id,JSON.stringify(f),Date.now()));
   statements.push(db.prepare('INSERT OR IGNORE INTO holiday_event_documents(holiday_id,event_id,document_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM holiday_events WHERE id=? AND holiday_id=?)').bind(id,eventId,d.documentId,eventId,id));
  }
  if(current.length+[...ids].filter(eventId=>!current.some(r=>r.id===eventId)).length>1000)fail('Der er for mange planpunkter i ferien');
  const category=flights.every(f=>f.type==='hotel')?'hotel':flights.every(f=>f.type==='flight')?'ticket':flights.every(f=>f.type==='activity')?'tour':'other';
  statements.push(db.prepare('UPDATE holiday_documents SET category=? WHERE id=? AND holiday_id=?').bind(category,d.documentId,id));
  statements.push(db.prepare('UPDATE holidays SET updated=? WHERE id=?').bind(Date.now(),id));
  const results=await db.batch(statements);const added=results.filter((r,i)=>i<results.length-2&&i%2===0).reduce((n,r)=>n+(r.meta?.changes||0),0);
  return reply({added,skipped:flights.length-added});
 }
 if(sub==='events'){
  editRole(m);
  if(method==='POST'&&!child){const d=validateEvent(await body(request)),eventId=uuid();const count=await db.prepare('SELECT COUNT(*) AS n FROM holiday_events WHERE holiday_id=?').bind(id).first();if(count.n>=1000)fail('En ferie kan have højst 1.000 planpunkter');await db.prepare('INSERT INTO holiday_events(id,holiday_id,data,version,updated) VALUES(?,?,?,1,?)').bind(eventId,id,JSON.stringify(d),Date.now()).run();return reply({id:eventId},201)}
  if(child&&validId(child)&&['PUT','DELETE'].includes(method)){
   const expected=version(request);
   if(method==='PUT'){const d=validateEvent(await body(request));changed(await db.prepare('UPDATE holiday_events SET data=?,version=version+1,updated=? WHERE id=? AND holiday_id=? AND version=?').bind(JSON.stringify(d),Date.now(),child,id,expected).run())}
   else{const results=await db.batch([db.prepare('DELETE FROM holiday_event_documents WHERE holiday_id=? AND event_id=? AND EXISTS(SELECT 1 FROM holiday_events WHERE id=? AND holiday_id=? AND version=?)').bind(id,child,child,id,expected),db.prepare('DELETE FROM holiday_events WHERE id=? AND holiday_id=? AND version=?').bind(child,id,expected)]);changed(results[1])}
   return reply({ok:true});
  }
 }
 if(sub==='members'){
  ownerRole(m);
  if(method==='DELETE'&&validId(child)){if(child===m.owner_id)fail('Ejeren kan ikke fjernes');await db.prepare('DELETE FROM holiday_members WHERE holiday_id=? AND user_id=?').bind(id,child).run();return reply({ok:true})}
  if(method==='PUT'&&validId(child)){const d=await body(request);if(!['viewer','editor'].includes(d.role)||child===m.owner_id)fail('Ugyldig rolle');await db.prepare('UPDATE holiday_members SET role=? WHERE holiday_id=? AND user_id=?').bind(d.role,id,child).run();return reply({ok:true})}
 }
 if(sub==='invites'){
  ownerRole(m);
  if(method==='GET'){const r=await db.prepare('SELECT token_hash AS id,email,role,expires FROM holiday_invites WHERE holiday_id=? AND expires>? ORDER BY expires DESC').bind(id,Date.now()).all();return reply({invites:r.results})}
  if(method==='DELETE'&&/^[a-f0-9]{64}$/.test(child||'')){await db.prepare('DELETE FROM holiday_invites WHERE token_hash=? AND holiday_id=?').bind(child,id).run();return reply({ok:true})}
  if(method==='POST'&&!child){const d=await body(request),email=emailAddress(d.email),role=d.role;if(!['viewer','editor'].includes(role))fail('Vælg læseadgang eller redigering');if(email===user.email)fail('Du er allerede ejer');const token=random(),expires=Date.now()+7*DAY;await db.batch([db.prepare('DELETE FROM holiday_invites WHERE holiday_id=? AND email=?').bind(id,email),db.prepare('INSERT INTO holiday_invites(token_hash,holiday_id,email,role,expires) VALUES(?,?,?,?,?)').bind(await hashToken(token),id,email,role,expires)]);return reply({token,expires},201)}
 }
 if(sub==='documents'){
  if(method==='POST'&&!child){editRole(m);if(!env.BUCKET)fail('Dokumenter kræver den eksisterende R2-binding BUCKET',503);const type=request.headers.get('Content-Type')?.split(';')[0];if(!mimeTypes.has(type))fail('Vælg PDF, JPG, PNG eller WebP');const category=clean(url.searchParams.get('category'),30)||'other';if(!['ticket','hotel','tour','insurance','other'].includes(category))fail('Ugyldig dokumentkategori');const eventId=clean(url.searchParams.get('event'),36);if(eventId&&!await db.prepare('SELECT id FROM holiday_events WHERE id=? AND holiday_id=?').bind(eventId,id).first())fail('Planpunktet findes ikke');const count=await db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(size),0) AS total FROM holiday_documents WHERE holiday_id=?').bind(id).first();if(count.n>=100)fail('En ferie kan have højst 100 dokumenter');const bytes=await readBytes(request,MAX_FILE);if(!validFile(bytes,type))fail('Filens indhold matcher ikke en understøttet PDF eller billedfil');if(count.total+bytes.length>1024*1024*1024)fail('Der er plads til højst 1 GB dokumenter pr. ferie');const name=clean(url.searchParams.get('name'),200,true).replace(/[\r\n\u0000-\u001f]/g,''),docId=uuid();await env.BUCKET.put(`holiday-documents/${id}/${docId}`,bytes,{httpMetadata:{contentType:type}});try{await db.prepare('INSERT INTO holiday_documents(id,holiday_id,name,type,size,category,event_id,uploader_id,created) VALUES(?,?,?,?,?,?,?,?,?)').bind(docId,id,name,type,bytes.length,category,eventId,user.id,Date.now()).run()}catch(e){await env.BUCKET.delete(`holiday-documents/${id}/${docId}`);throw e}return reply({id:docId},201)}
  if(validId(child)&&['GET','DELETE'].includes(method)){const doc=await db.prepare('SELECT * FROM holiday_documents WHERE id=? AND holiday_id=?').bind(child,id).first();if(!doc)fail('Dokumentet findes ikke',404);if(!env.BUCKET)fail('Dokumentlageret er ikke tilgængeligt',503);const key=`holiday-documents/${id}/${child}`;
   if(method==='GET'){const file=await env.BUCKET.get(key);if(!file)fail('Dokumentet findes ikke',404);return new Response(file.body,{headers:{'Content-Type':doc.type,'Content-Disposition':`attachment; filename="document.${doc.type==='application/pdf'?'pdf':doc.type.split('/')[1]}"; filename*=UTF-8''${encodeURIComponent(doc.name).replace(/'/g,'%27')}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}})}
   editRole(m);await env.BUCKET.delete(key);await db.batch([db.prepare('DELETE FROM holiday_event_documents WHERE holiday_id=? AND document_id=?').bind(id,child),db.prepare('DELETE FROM holiday_documents WHERE id=? AND holiday_id=?').bind(child,id)]);return reply({ok:true});
  }
 }
 fail('Ukendt handling',404);
}
export async function handlePortal(ctx){try{return await portal(ctx)}catch(e){if(e.status)return reply({error:e.message},e.status);console.error('Holiday portal request failed');return reply({error:'Ferieportalen kunne ikke gennemføre handlingen. Prøv igen.'},500)}}
