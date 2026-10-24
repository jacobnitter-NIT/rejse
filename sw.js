const C='rb-v10-chronological-overview',A=['./','index.html','icon.svg','manifest.webmanifest','trips.css','design.css','portal.css','portal.js?v=10','portal-plan.mjs?v=10','trip-engine.js','trips.js','scanner.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('rb-')&&x!==C).map(x=>caches.delete(x)))).then(()=>clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.pathname.startsWith('/api/')||u.origin!==self.location.origin)return;
  e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(r.ok){const copy=r.clone();e.waitUntil(caches.open(C).then(c=>c.put(e.request,copy)).catch(()=>{}))}return r}).catch(async()=>await caches.match(e.request)||(e.request.mode==='navigate'?await caches.match('index.html'):Response.error())));
});
