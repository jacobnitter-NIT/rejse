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
 assert.equal((await call(env,'auth/register','POST',{email:'bad@example.com',password,name:'Bad'})).status,404);
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
