const test=require('node:test'),assert=require('node:assert/strict');
const {environment}=require('./support/portal-env.cjs');
const moduleReady=import('../portal-server.js');
const origin='https://example.com',password='a-strong-password-for-tests';
const sample={name:'Thailand 2027',destination:'Bangkok · Chiang Mai',start:'2027-02-01',end:'2027-02-20',notes:'Fælles ferie'};
const flight={type:'flight',title:'Fly til Bangkok',start:'2027-02-01T14:00',end:'2027-02-02T07:30',startZone:'Europe/Copenhagen',endZone:'Asia/Bangkok',from:'CPH',to:'BKK',flightNumber:'TG951',reference:'PNR123',provider:'Thai',notes:'',status:'confirmed'};
async function call(env,path,method='GET',data,cookie='',headers={}){const {handlePortal}=await moduleReady;const isRaw=data instanceof Uint8Array;return handlePortal({env,params:{path:['portal',...path.split('?')[0].split('/').filter(Boolean)]},request:new Request(origin+'/api/portal/'+path,{method,headers:{...(method!=='GET'?{'Origin':origin,'X-Portal-Request':'1'}:{}),...(data&&!isRaw?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},body:data?(isRaw?data:JSON.stringify(data)):undefined})})}
async function expect(response,status){assert.equal(response.status,status,await response.clone().text());return response.json()}
async function register(env,email='owner@example.com',extra={}){const response=await call(env,'auth/register','POST',{email,password,name:email,...extra},'',extra.invite?{}:{Authorization:'Bearer owner-secret'});await expect(response,200);return response.headers.get('Set-Cookie').split(';')[0]}
async function holiday(env,cookie){return(await expect(await call(env,'holidays','POST',sample,cookie),201)).id}
async function invited(env,owner,id,email='companion@example.com',role='viewer'){const invitation=await expect(await call(env,`holidays/${id}/invites`,'POST',{email,role},owner),201);const cookie=await register(env,email,{invite:invitation.token});await expect(await call(env,'invitations/'+invitation.token,'POST',null,cookie),200);return{cookie,token:invitation.token}}
test('account authentication, same-origin enforcement, logout and password rotation',async()=>{
 const env=environment();assert.equal((await call(env,'holidays')).status,401);
 assert.equal((await call(env,'auth/register','POST',{email:'bad@example.com',password,name:'Bad'})).status,401);
 const cookie=await register(env);assert.match(cookie,/__Host-holiday_session=/);
 const me=await expect(await call(env,'auth/me','GET',null,cookie),200);assert.equal(me.user.email,'owner@example.com');assert.equal(me.user.password_hash,undefined);
 assert.equal((await call(env,'holidays','POST',sample,cookie,{Origin:'https://evil.example'})).status,403);
 assert.equal((await call(env,'auth/login','POST',{email:'owner@example.com',password:'wrong-long-password'})).status,401);
 const login=await call(env,'auth/login','POST',{email:'OWNER@EXAMPLE.COM',password});await expect(login,200);assert.match(login.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);const second=login.headers.get('Set-Cookie').split(';')[0];
 const change=await call(env,'auth/password','POST',{currentPassword:password,newPassword:'a-different-long-password'},cookie);await expect(change,200);assert.equal((await expect(await call(env,'auth/me','GET',null,second),200)).user,null);const fresh=change.headers.get('Set-Cookie').split(';')[0];await expect(await call(env,'auth/logout','POST',null,fresh),200);assert.equal((await expect(await call(env,'auth/me','GET',null,fresh),200)).user,null);
 const row=env.raw.prepare('SELECT * FROM holiday_accounts').get();assert.notEqual(row.password_hash,password);assert.equal(row.password_hash.length,64);
});
test('invites are email-bound, expiring, one-use, cancellable and holiday-scoped',async()=>{
 const env=environment(),owner=await register(env),id=await holiday(env,owner),other=await holiday(env,owner);
 const invitation=await expect(await call(env,`holidays/${id}/invites`,'POST',{email:'friend@example.com',role:'viewer'},owner),201);
 assert.equal((await call(env,'auth/register','POST',{email:'wrong@example.com',password,name:'Wrong',invite:invitation.token})).status,403);
 const friend=await register(env,'friend@example.com',{invite:invitation.token});await expect(await call(env,'invitations/'+invitation.token,'POST',null,friend),200);
 assert.equal((await call(env,'invitations/'+invitation.token,'POST',null,friend)).status,404);
 assert.equal((await call(env,'holidays/'+id,'GET',null,friend)).status,200);assert.equal((await call(env,'holidays/'+other,'GET',null,friend)).status,404);
 const list=await expect(await call(env,'holidays','GET',null,friend),200);assert.equal(list.holidays.length,1);
 const ex=await expect(await call(env,`holidays/${id}/invites`,'POST',{email:'expired@example.com',role:'editor'},owner),201);env.raw.exec('UPDATE holiday_invites SET expires=0');assert.equal((await call(env,'invitations/'+ex.token)).status,404);
 const inv=await expect(await call(env,`holidays/${id}/invites`,'POST',{email:'cancel@example.com',role:'viewer'},owner),201);const pending=await expect(await call(env,`holidays/${id}/invites`,'GET',null,owner),200);assert.equal(pending.invites.length,1);assert.ok(!JSON.stringify(pending).includes(inv.token));await expect(await call(env,`holidays/${id}/invites/${pending.invites[0].id}`,'DELETE',null,owner),200);assert.equal((await call(env,'invitations/'+inv.token)).status,404);
});
test('viewer cannot write, editor cannot invite, owner can revoke immediately',async()=>{
 const env=environment(),owner=await register(env),id=await holiday(env,owner),{cookie:friend}=await invited(env,owner,id);
 assert.equal((await call(env,`holidays/${id}/events`,'POST',flight,friend)).status,403);
 assert.equal((await call(env,`holidays/${id}/invites`,'POST',{email:'new@example.com',role:'editor'},friend)).status,403);
 const detail=await expect(await call(env,'holidays/'+id,'GET',null,owner),200),user=detail.members.find(x=>x.email==='companion@example.com');
 await expect(await call(env,`holidays/${id}/members/${user.id}`,'PUT',{role:'editor'},owner),200);
 await expect(await call(env,`holidays/${id}/events`,'POST',flight,friend),201);
 assert.equal((await call(env,`holidays/${id}/members/${detail.members.find(x=>x.role==='owner').id}`,'DELETE',null,owner)).status,400);
 await expect(await call(env,`holidays/${id}/members/${user.id}`,'DELETE',null,owner),200);assert.equal((await call(env,'holidays/'+id,'GET',null,friend)).status,404);assert.equal((await call(env,`holidays/${id}/events`,'POST',flight,friend)).status,404);
});
test('holiday and itinerary updates reject concurrent writes without losing newer data',async()=>{
 const env=environment(),owner=await register(env),id=await holiday(env,owner);
 await expect(await call(env,'holidays/'+id,'PUT',{...sample,name:'Newer holiday'},owner,{'If-Match':'1'}),200);
 assert.equal((await call(env,'holidays/'+id,'PUT',sample,owner,{'If-Match':'1'})).status,409);
 const event=await expect(await call(env,`holidays/${id}/events`,'POST',flight,owner),201),eventPath=`holidays/${id}/events/${event.id}`;
 await expect(await call(env,eventPath,'PUT',{...flight,reference:'UPDATED'},owner,{'If-Match':'1'}),200);assert.equal((await call(env,eventPath,'PUT',flight,owner,{'If-Match':'1'})).status,409);assert.equal((await call(env,eventPath,'DELETE',null,owner,{'If-Match':'1'})).status,409);
 const detail=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.equal(detail.holiday.name,'Newer holiday');assert.equal(detail.events[0].reference,'UPDATED');
});
test('documents require membership, enforce types, prevent cross-holiday access and revoke with membership',async()=>{
 const env=environment(),owner=await register(env),id=await holiday(env,owner),other=await holiday(env,owner),{cookie:friend}=await invited(env,owner,id),file=new TextEncoder().encode('%PDF-1.4\nThis is a test document.');
 const url=`holidays/${id}/documents?name=Ticket.pdf&category=ticket`;
 assert.equal((await call(env,url,'POST',file,friend,{'Content-Type':'application/pdf'})).status,403);
 assert.equal((await call(env,url,'POST',file,owner,{'Content-Type':'text/html'})).status,400);
 assert.equal((await call(env,url,'POST',new TextEncoder().encode('<html>not a document</html>'),owner,{'Content-Type':'application/pdf'})).status,400);
 const doc=await expect(await call(env,url,'POST',file,owner,{'Content-Type':'application/pdf'}),201),docPath=`holidays/${id}/documents/${doc.id}`;
 const download=await call(env,docPath,'GET',null,friend);assert.equal(download.status,200);assert.match(download.headers.get('Cache-Control'),/no-store/);assert.match(download.headers.get('Content-Disposition'),/attachment/);assert.deepEqual(new Uint8Array(await download.arrayBuffer()),file);
 assert.equal((await call(env,docPath)).status,401);assert.equal((await call(env,`holidays/${other}/documents/${doc.id}`,'GET',null,owner)).status,404);
 const details=await expect(await call(env,'holidays/'+id,'GET',null,owner),200),member=details.members.find(x=>x.email==='companion@example.com');await expect(await call(env,`holidays/${id}/members/${member.id}`,'DELETE',null,owner),200);assert.equal((await call(env,docPath,'GET',null,friend)).status,404);
 await expect(await call(env,docPath,'DELETE',null,owner),200);assert.equal(env.objects.size,0);assert.equal((await call(env,docPath,'GET',null,owner)).status,404);
});
test('reject invalid dates and time zones, whitelist fields and throttle repeated auth attempts',async()=>{
 const {validateHoliday,validateEvent}=await moduleReady;assert.throws(()=>validateHoliday({...sample,start:'2027-02-30'}));assert.throws(()=>validateHoliday({...sample,end:'2029-01-01'}));assert.throws(()=>validateEvent({...flight,startZone:'invalid zone'}));assert.equal(validateEvent({...flight,SYNC_KEY:'secret'}).SYNC_KEY,undefined);assert.equal(validateHoliday({...sample,owner_id:'attacker'}).owner_id,undefined);
 const env=environment();for(let i=0;i<15;i++)assert.equal((await call(env,'auth/login','POST',{email:'brute@example.com',password})).status,401);assert.equal((await call(env,'auth/login','POST',{email:'brute@example.com',password})).status,429);
});

test('portal administrators can manage holidays while ordinary accounts stay isolated',async()=>{
 const env=environment(),owner=await register(env),id=await holiday(env,owner),adminCookie=await register(env,'admin@example.com');
 const admin=env.raw.prepare('SELECT id FROM holiday_accounts WHERE email=?').get('admin@example.com');env.raw.prepare('INSERT INTO holiday_admins(user_id) VALUES(?)').run(admin.id);
 assert.equal((await expect(await call(env,'auth/me','GET',null,adminCookie),200)).user.admin,1);
 const list=await expect(await call(env,'holidays','GET',null,adminCookie),200);assert.equal(list.holidays.length,1);assert.equal(list.holidays[0].role,'admin');
 const detail=await expect(await call(env,'holidays/'+id,'GET',null,adminCookie),200);assert.equal(detail.holiday.role,'admin');
 await expect(await call(env,`holidays/${id}/events`,'POST',flight,adminCookie),201);
 await expect(await call(env,`holidays/${id}/invites`,'POST',{email:'invited@example.com',role:'viewer'},adminCookie),201);
 assert.equal((await call(env,'auth/bootstrap','POST',{email:'attacker@example.com',password,name:'Attacker',token:'f'.repeat(64)})).status,404);
});

const sasText=`SAS — Travel itinerary\nBooking reference: ABC123\n02 February 2027\nSK973 Copenhagen CPH — Bangkok BKK\nDeparture: 02 February 2027 23:35\nArrival: 03 February 2027 16:05 (+1 day)\n20 February 2027\nSK974 Bangkok BKK — Copenhagen CPH\nDeparture: 20 February 2027 23:50\nArrival: 21 February 2027 06:40 (+1 day)\nAll times are local. Confirmed.`;
const extracted={bookingReference:'ABC123',flights:[{from:'Copenhagen',fromCode:'CPH',to:'Bangkok',toCode:'BKK',airline:'SAS',flightNumber:'SK 973',pnr:'ABC123',departure:'2027-02-02T23:35',arrival:'2027-02-03T16:05',status:'confirmed',evidence:'SK973 Copenhagen CPH — Bangkok BKK'},{from:'Bangkok',fromCode:'BKK',to:'Copenhagen',toCode:'CPH',airline:'SAS',flightNumber:'SK974',pnr:'ABC123',departure:'2027-02-20T23:50',arrival:'2027-02-21T06:40',status:'confirmed'}],warnings:[]};
async function bookingDoc(env,owner,id){const file=new TextEncoder().encode('%PDF-1.7\nSynthetic SAS booking fixture, not a real ticket.');return(await expect(await call(env,`holidays/${id}/documents?name=SAS-itinerary.pdf&category=ticket`,'POST',file,owner,{'Content-Type':'application/pdf'}),201)).id}
function mockBookingAI(env,output=extracted){env.AI={toMarkdown:async input=>{assert.equal(input.blob.type,'application/pdf');assert.ok(input.blob.size>0);return{format:'markdown',data:sasText}},run:async(model,input)=>{assert.equal(model,'@cf/meta/llama-3.3-70b-instruct-fp8-fast');assert.match(input.messages[0].content,/UNTRUSTED DATA/);assert.match(input.messages[1].content,/ABC123/);return{response:JSON.stringify(output)}}}}
test('SAS-style PDF preview preserves local overnight dates, PNR and all legs without saving flights',async()=>{
 const env=environment(),owner=await register(env),id=await holiday(env,owner),doc=await bookingDoc(env,owner,id);mockBookingAI(env,{...extracted,flights:[...extracted.flights,extracted.flights[0]]});
 const result=await expect(await call(env,`holidays/${id}/import-preview`,'POST',{documentId:doc},owner),200);assert.equal(result.flights.length,2);assert.equal(result.flights[0].reference,'ABC123');assert.equal(result.flights[0].flightNumber,'SK973');assert.equal(result.flights[0].start,'2027-02-02T23:35');assert.equal(result.flights[0].end,'2027-02-03T16:05');assert.equal(result.flights[0].startZone,'');assert.equal(result.flights[0].from,'CPH · Copenhagen');assert.ok(result.warnings.length);
 const detail=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.equal(detail.events.length,0);assert.equal(detail.documents.length,1);
});
test('reviewed flights import atomically, link the PDF to all legs, and do not duplicate or overwrite on retry',async()=>{
 const env=environment(),owner=await register(env),id=await holiday(env,owner),doc=await bookingDoc(env,owner,id);mockBookingAI(env);const result=await expect(await call(env,`holidays/${id}/import-preview`,'POST',{documentId:doc},owner),200);
 result.flights[0].reference='COR123';const payload={documentId:doc,flights:result.flights};
 const saved=await expect(await call(env,`holidays/${id}/import-flights`,'POST',payload,owner),200);assert.equal(saved.added,2);
 let detail=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.equal(detail.events.length,2);assert.equal(detail.documents[0].event_ids.length,2);assert.ok(detail.events.some(e=>e.reference==='COR123'));assert.equal(detail.events[0].warnings,undefined);
 const first=detail.events[0];await expect(await call(env,`holidays/${id}/events/${first.id}`,'PUT',{...first,notes:'Manually reviewed note'},owner,{'If-Match':'1'}),200);
 const again=await expect(await call(env,`holidays/${id}/import-flights`,'POST',payload,owner),200);assert.deepEqual({added:again.added,skipped:again.skipped},{added:0,skipped:2});detail=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.equal(detail.events.length,2);assert.equal(detail.events.find(e=>e.id===first.id).notes,'Manually reviewed note');
 assert.equal((await call(env,`holidays/${id}/events/${first.id}`,'DELETE',null,owner,{'If-Match':'1'})).status,409);assert.equal((await expect(await call(env,'holidays/'+id,'GET',null,owner),200)).documents[0].event_ids.length,2);
 await expect(await call(env,`holidays/${id}/events/${first.id}`,'DELETE',null,owner,{'If-Match':'2'}),200);assert.equal((await expect(await call(env,'holidays/'+id,'GET',null,owner),200)).documents[0].event_ids.length,1);
});
test('PDF import rejects viewers, foreign documents, missing AI and incomplete reviewed flights',async()=>{
 const env=environment(),owner=await register(env),id=await holiday(env,owner),other=await holiday(env,owner),doc=await bookingDoc(env,owner,id),{cookie:viewer}=await invited(env,owner,id);
 assert.equal((await call(env,`holidays/${id}/import-preview`,'POST',{documentId:doc},viewer)).status,403);assert.equal((await call(env,`holidays/${other}/import-preview`,'POST',{documentId:doc},owner)).status,404);assert.equal((await call(env,`holidays/${id}/import-preview`,'POST',{documentId:doc},owner)).status,503);
 mockBookingAI(env);assert.equal((await call(env,`holidays/${id}/import-flights`,'POST',{documentId:doc,flights:[{...flight,end:''}]},owner)).status,400);assert.equal((await call(env,`holidays/${id}/import-flights`,'POST',{documentId:doc,flights:[{...flight,end:'2027-02-02T16:00',type:'hotel'}]},owner)).status,400);
 const details=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.equal(details.events.length,0);
 env.AI.toMarkdown=async()=>({format:'error',error:'unreadable'});assert.equal((await call(env,`holidays/${id}/import-preview`,'POST',{documentId:doc},owner)).status,502);
});
test('AI itinerary sanitization never invents missing dates, rejects bad JSON and keeps segment-specific references',async()=>{
 const {normalizeItinerary,previewItinerary}=await import('../itinerary-ai.js');const d=normalizeItinerary({bookingReference:'ABC123',flights:[{...extracted.flights[0],departure:'2027-02-30T23:35',arrival:null,pnr:'OTHER1',departureTimezone:'not-a-zone',role:'admin'}]});assert.equal(d.flights[0].start,'');assert.equal(d.flights[0].end,'');assert.equal(d.flights[0].startZone,'');assert.equal(d.flights[0].reference,'OTHER1');assert.equal(d.flights[0].role,undefined);assert.ok(d.flights[0].warnings.length>=2);
 const env=environment();mockBookingAI(env);env.AI.run=async()=>({response:'not JSON'});await assert.rejects(()=>previewItinerary(env,new Blob(['%PDF-1.7'],{type:'application/pdf'})),/ufuldstændigt/);
});

const hotelAndTours={bookingReference:'ABC123',flights:[],hotels:[{name:'River Hotel',city:'Bangkok',address:'12 River Road',reference:'HOTEL-7788',checkIn:'2027-02-03',checkOut:'2027-02-07',roomType:'Double room',notes:'Breakfast included',status:'confirmed'}],tours:[{title:'Temples and canals',provider:'Local Tours',location:'Bangkok',reference:'TOUR-9911',start:'2027-02-05T09:00',end:'2027-02-05T14:00',meetingPoint:'Pier 3, River Road',pickup:'08:15 in the hotel lobby',notes:'Bring the voucher',status:'confirmed'}],warnings:[]};
test('hotel and tour proposals preserve separate references, pickup details and unknown hotel times',async()=>{
 const {normalizeItinerary}=await import('../itinerary-ai.js');const result=normalizeItinerary(hotelAndTours);assert.equal(result.events.length,2);assert.equal(result.flights.length,0);
 const hotel=result.events.find(e=>e.type==='hotel'),tour=result.events.find(e=>e.type==='activity');assert.equal(hotel.reference,'HOTEL-7788');assert.equal(hotel.start,'2027-02-03T00:00');assert.equal(hotel.end,'2027-02-07T00:00');assert.equal(hotel.startDateOnly,true);assert.equal(hotel.endDateOnly,true);assert.match(hotel.notes,/Double room/);assert.ok(hotel.warnings.some(w=>w.includes('tid er ikke angivet')));
 assert.equal(tour.reference,'TOUR-9911');assert.equal(tour.start,'2027-02-05T09:00');assert.equal(tour.startDateOnly,false);assert.equal(tour.address,'Pier 3, River Road');assert.match(tour.notes,/08:15/);assert.ok(!tour.reference.includes('ABC123'));
 const undated=normalizeItinerary({tours:[{title:'Trip with date not set',reference:'V1'}]});assert.equal(undated.events[0].start,'');assert.ok(undated.events[0].warnings.length);
});
test('mixed booking confirmation saves hotels and tours with source associations, deduplication and date precision',async()=>{
 const env=environment(),owner=await register(env),id=await holiday(env,owner),doc=await bookingDoc(env,owner,id);mockBookingAI(env,hotelAndTours);
 const preview=await expect(await call(env,`holidays/${id}/import-preview`,'POST',{documentId:doc},owner),200);assert.equal(preview.events.length,2);assert.equal(preview.events[0].duplicate,false);
 const payload={documentId:doc,events:preview.events};const imported=await expect(await call(env,`holidays/${id}/import-events`,'POST',payload,owner),200);assert.deepEqual({added:imported.added,skipped:imported.skipped},{added:2,skipped:0});
 let detail=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.equal(detail.events.length,2);assert.equal(detail.documents[0].event_ids.length,2);assert.equal(detail.documents[0].category,'other');const hotel=detail.events.find(e=>e.type==='hotel');assert.equal(hotel.startDateOnly,true);assert.equal(hotel.endDateOnly,true);
 await expect(await call(env,`holidays/${id}/events/${hotel.id}`,'PUT',{...hotel,notes:'Manually changed hotel notes'},owner,{'If-Match':'1'}),200);
 const again=await expect(await call(env,`holidays/${id}/import-events`,'POST',payload,owner),200);assert.deepEqual({added:again.added,skipped:again.skipped},{added:0,skipped:2});detail=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.equal(detail.events.find(e=>e.id===hotel.id).startDateOnly,true);assert.equal(detail.events.find(e=>e.id===hotel.id).notes,'Manually changed hotel notes');
 const repeat=await expect(await call(env,`holidays/${id}/import-preview`,'POST',{documentId:doc},owner),200);assert.ok(repeat.events.every(e=>e.duplicate));
});
test('type-specific import validation rejects incomplete hotels and date-less tours, and enforces permissions',async()=>{
 const {normalizeItinerary}=await import('../itinerary-ai.js'),env=environment(),owner=await register(env),id=await holiday(env,owner),doc=await bookingDoc(env,owner,id),{cookie:viewer}=await invited(env,owner,id);const items=normalizeItinerary(hotelAndTours).events;
 assert.equal((await call(env,`holidays/${id}/import-events`,'POST',{documentId:doc,events:items},viewer)).status,403);
 assert.equal((await call(env,`holidays/${id}/import-events`,'POST',{documentId:doc,events:[{...items[0],end:''}]},owner)).status,400);
 assert.equal((await call(env,`holidays/${id}/import-events`,'POST',{documentId:doc,events:[{...items[0],end:'2027-02-01T00:00'}]},owner)).status,400);
 assert.equal((await call(env,`holidays/${id}/import-events`,'POST',{documentId:doc,events:[{...items[1],start:''}]},owner)).status,400);
 await expect(await call(env,`holidays/${id}/import-events`,'POST',{documentId:doc,events:[items[0]]},owner),200);let detail=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.equal(detail.documents[0].category,'hotel');
 const tourDoc=await bookingDoc(env,owner,id);await expect(await call(env,`holidays/${id}/import-events`,'POST',{documentId:tourDoc,events:[{...items[1],start:'2027-02-05T00:00',startDateOnly:true,end:'',endDateOnly:false}]},owner),200);detail=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.equal(detail.documents.find(d=>d.id===tourDoc).category,'tour');assert.equal(detail.events.find(e=>e.type==='activity').startDateOnly,true);
});

test('confirmed imports return the saved chronological plan immediately, with editable names and separate PNRs',async()=>{
 const {buildTimeline}=await import('../portal-plan.mjs'),env=environment(),owner=await register(env),id=await holiday(env,owner),doc=await bookingDoc(env,owner,id);
 const flights=[{...flight,reference:'JAC123',start:'2027-02-02T15:00',end:'2027-02-03T06:00',travellers:['Jacob']},{...flight,reference:'LON456',start:'2027-02-01T15:00',end:'2027-02-02T06:00',travellers:'Lone'}];
 const result=await expect(await call(env,`holidays/${id}/import-events`,'POST',{documentId:doc,events:flights},owner),200);assert.equal(result.holiday.id,id);assert.equal(result.events.length,2);assert.equal(result.events[0].reference,'LON456');assert.deepEqual(result.events[0].travellers,['Lone']);assert.deepEqual(result.events[1].travellers,['Jacob']);assert.equal(result.documents[0].event_ids.length,2);assert.equal(buildTimeline(result.events).length,4);
 const first=result.events[0];await expect(await call(env,`holidays/${id}/events/${first.id}`,'PUT',{...first,travellers:'Lone\nJosephina'},owner,{'If-Match':String(first.version)}),200);const saved=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.deepEqual(saved.events.find(e=>e.id===first.id).travellers,['Lone','Josephina']);
 assert.equal((await call(env,`holidays/${id}/events/${first.id}`,'PUT',{...first,travellers:[{role:'admin'}]},owner,{'If-Match':'2'})).status,400);
});
test('AI passenger copies merge names only for matching bookings, while different references stay separate',async()=>{
 const {normalizeItinerary}=await import('../itinerary-ai.js');const original=extracted.flights[0],result=normalizeItinerary({flights:[{...original,travellers:['Jacob']},{...original,travellers:['Lone']},{...original,pnr:'OTHER9',travellers:['Carsten']}],hotels:[],tours:[]});assert.equal(result.events.length,2);assert.deepEqual(result.events[0].travellers,['Jacob','Lone']);assert.deepEqual(result.events[1].travellers,['Carsten']);assert.equal(result.events[1].reference,'OTHER9');
});
test('car rental PDF proposals save both chronological milestones, driver and non-PNR reference without duplicating',async()=>{
 const {buildTimeline}=await import('../portal-plan.mjs');const env=environment(),owner=await register(env),id=await holiday(env,owner),doc=await bookingDoc(env,owner,id);mockBookingAI(env,{cars:[{provider:'Example Rental',title:'Billeje kompakt',reference:'RENT-123456789',pickup:'2027-02-03T10:00',dropoff:'2027-02-10',pickupLocation:'Airport desk',dropoffLocation:'City office',vehicle:'Compact or similar',travellers:['Test Driver'],status:'confirmed'}]});
 const preview=await expect(await call(env,`holidays/${id}/import-preview`,'POST',{documentId:doc},owner),200);const car=preview.events[0];assert.equal(car.type,'car');assert.equal(car.reference,'RENT-123456789');assert.equal(car.endDateOnly,true);assert.equal(car.end,'2027-02-10T00:00');assert.deepEqual(car.travellers,['Test Driver']);
 const save=()=>call(env,`holidays/${id}/import-events`,'POST',{documentId:doc,events:[car]},owner);await expect(await save(),200);await expect(await save(),200);const detail=await expect(await call(env,'holidays/'+id,'GET',null,owner),200);assert.equal(detail.events.length,1);assert.equal(detail.documents[0].category,'car');assert.deepEqual(buildTimeline([...detail.events,{id:'flight',...flight,start:'2027-02-04T12:00',end:'2027-02-04T14:00'}]).map(p=>p.label),['Afhentning af bil','Afgang','Ankomst','Aflevering af bil']);
 assert.equal((await call(env,`holidays/${id}/events`,'POST',{...car,end:'2027-02-01T10:00'},owner)).status,400);assert.equal((await call(env,`holidays/${id}/events`,'POST',{...car,to:''},owner)).status,400);
 const {cookie:viewer}=await invited(env,owner,id);assert.equal((await call(env,`holidays/${id}/import-events`,'POST',{documentId:doc,events:[car]},viewer)).status,403);
});
