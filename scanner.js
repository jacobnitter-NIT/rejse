/* Receipt image processing is local. AI requests go through the authenticated server. */
async function receiptBitmap(blob){return createImageBitmap(blob,{imageOrientation:'from-image'})}
async function cropBlob(blob,crop,max=2000){
  const bmp=await receiptBitmap(blob),sx=Math.max(0,Math.floor(crop.x*bmp.width)),sy=Math.max(0,Math.floor(crop.y*bmp.height)),sw=Math.min(bmp.width-sx,Math.ceil(crop.width*bmp.width)),sh=Math.min(bmp.height-sy,Math.ceil(crop.height*bmp.height));
  if(sw<40||sh<40){bmp.close();throw Error('Beskæringen er for lille')}
  const scale=Math.min(1,max/Math.max(sw,sh)),canvas=document.createElement('canvas');canvas.width=Math.round(sw*scale);canvas.height=Math.round(sh*scale);canvas.getContext('2d').drawImage(bmp,sx,sy,sw,sh,0,0,canvas.width,canvas.height);bmp.close();
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Billedet kunne ikke gemmes')),'image/jpeg',.9));
}
async function paperBounds(blob){
  const bmp=await receiptBitmap(blob),s=Math.min(1,320/Math.max(bmp.width,bmp.height)),c=document.createElement('canvas');c.width=Math.round(bmp.width*s);c.height=Math.round(bmp.height*s);const ctx=c.getContext('2d');ctx.drawImage(bmp,0,0,c.width,c.height);bmp.close();
  const w=c.width,h=c.height,pixels=ctx.getImageData(0,0,w,h).data,light=new Uint8Array(w*h),hist=new Uint32Array(256);
  for(let i=0;i<light.length;i++){light[i]=Math.round((pixels[i*4]+pixels[i*4+1]+pixels[i*4+2])/3);hist[light[i]]++}
  let sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let count=0,back=0,best=0,threshold=180;
  for(let t=0;t<255;t++){count+=hist[t];back+=t*hist[t];if(!count||count===light.length)continue;const delta=back/count-(sum-back)/(light.length-count),variance=count*(light.length-count)*delta*delta;if(variance>best){best=variance;threshold=t}}
  threshold=Math.max(150,threshold);const visited=new Uint8Array(light.length),queue=new Int32Array(light.length);let largest=null;
  for(let i=0;i<light.length;i++){
    if(visited[i]||light[i]<=threshold)continue;let head=0,tail=1,minx=w,miny=h,maxx=0,maxy=0;queue[0]=i;visited[i]=1;
    while(head<tail){const at=queue[head++],x=at%w,y=Math.floor(at/w);minx=Math.min(minx,x);maxx=Math.max(maxx,x);miny=Math.min(miny,y);maxy=Math.max(maxy,y);
      const neighbours=[];if(x)neighbours.push(at-1);if(x<w-1)neighbours.push(at+1);if(y)neighbours.push(at-w);if(y<h-1)neighbours.push(at+w);
      for(const n of neighbours)if(!visited[n]&&light[n]>threshold){visited[n]=1;queue[tail++]=n}
    }
    if(!largest||tail>largest.n)largest={n:tail,minx,miny,maxx,maxy};
  }
  if(!largest)return null;const a=largest,area=(a.maxx-a.minx+1)*(a.maxy-a.miny+1),ratio=area/(w*h),touch=Number(a.minx<3)+Number(a.miny<3)+Number(a.maxx>w-4)+Number(a.maxy>h-4);
  if(ratio<.15||ratio>.92||touch>1||a.n/area<.65)return null;
  const x=Math.max(0,a.minx/w-.025),y=Math.max(0,a.miny/h-.025),right=Math.min(1,(a.maxx+1)/w+.025),bottom=Math.min(1,(a.maxy+1)/h+.025);return{x,y,width:right-x,height:bottom-y};
}
function resetReceiptUrls(it){for(const k of ['blob','thumb','original']){const id=it.id+k;if(urls.has(id)){URL.revokeObjectURL(urls.get(id));urls.delete(id)}}}
async function applyReceiptCrop(it,crop){
  if(!it.original)it.original=it.blob;
  it.blob=await cropBlob(it.original,crop);it.thumb=await cropBlob(it.original,crop,200);it.crop=crop;it.imageVersion=crypto.randomUUID();it.updated=Date.now();resetReceiptUrls(it);await put(it);render();autosync();refreshReceiptPreview();
}
async function pdfScanImage(it){
  const V='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';if(!window.pdfjsLib){await loadJs(V+'pdf.min.js');pdfjsLib.GlobalWorkerOptions.workerSrc=V+'pdf.worker.min.js'}
  const doc=await pdfjsLib.getDocument({data:await it.blob.arrayBuffer()}).promise;
  try{const pg=await doc.getPage(1),base=pg.getViewport({scale:1}),vp=pg.getViewport({scale:Math.min(2,1800/Math.max(base.width,base.height))}),cv=document.createElement('canvas');cv.width=vp.width;cv.height=vp.height;await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;return await new Promise(r=>cv.toBlob(r,'image/jpeg',.9))}finally{await doc.destroy()}
}
let scannerQueue=Promise.resolve();
function receiptRead(it){const job=scannerQueue.then(()=>scanReceipt(it));scannerQueue=job.catch(()=>{});return job}
async function scanReceipt(it){
  let result,reason='';
  if(key()){
    try{const image=it.type==='img'?(it.original||it.blob):await pdfScanImage(it);const response=await api('scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:await b64(image)})});result=await response.json();if(result.amount!=null)result.amount=String(result.amount);if(it.type==='pdf')result.warnings.push('AI læste første PDF-side. Kontrollér øvrige sider.')}catch(e){reason=e.message}
  }else reason='Indtast Sync key for at bruge AI';
  if(!result){result={...parseReceipt(await readText(it)),source:'ocr',warnings:[reason||'AI utilgængelig – almindelig tekstaflæsning anvendt'],confidence:0}}
  if(!items.includes(it))throw Error('Kvitteringen er ikke længere i arkivet');
  it.scan={source:result.source,confidence:result.confidence,warnings:result.warnings||[],time:Date.now()};
  if(it.type==='img'&&!it.crop&&lsGet('rb-autocrop')!=='off'){
    let bounds=result.confidence>=.7?result.crop:null;if(!bounds)bounds=await paperBounds(it.original||it.blob);
    if(bounds)await applyReceiptCrop(it,bounds);
  }
  it.updated=Date.now();await put(it);return result;
}
function refreshReceiptPreview(){
  const image=$('#receiptPreview'),note=$('#scanNote');if(!cur)return;image.hidden=cur.type!=='img';if(cur.type==='img')image.src=url(cur);$('#cropReceipt').hidden=cur.type!=='img';$('#restoreReceipt').hidden=!cur.original;
  $('#eV').href=url(cur,cur.original?'original':'blob');
  note.textContent=cur.scan?`${cur.scan.source==='ai'?'AI-forslag':'Tekstaflæsning'} · Kontrollér oplysningerne. ${(cur.scan.warnings||[]).join(' ')}`:'AI sender billedet til Cloudflare for aflæsning. Originalen bevares ved beskæring.';
}
document.addEventListener('DOMContentLoaded',()=>{
  $('#autoCrop').checked=lsGet('rb-autocrop')!=='off';$('#autoCrop').onchange=e=>lsSet('rb-autocrop',e.target.checked?'on':'off');
  $('#restoreReceipt').onclick=async()=>{try{cur.blob=cur.original;cur.thumb=(await shrink(cur.original)).thumb;delete cur.crop;cur.imageVersion=crypto.randomUUID();cur.updated=Date.now();resetReceiptUrls(cur);await put(cur);render();refreshReceiptPreview();autosync()}catch(e){toast(e.message)}};
  $('#cropReceipt').onclick=async()=>{
    const it=cur,c=it.crop||{x:0,y:0,width:1,height:1},source=it.original||it.blob;
    const d=document.createElement('dialog');d.className='trip-dialog';d.innerHTML=`<h2>Beskær kvittering</h2><p class="trip-muted">Justér kanterne i procent af originalbilledet.</p><img class="scanner-preview" id="cropPreview"><div class="crop-grid">${[['left','Venstre',c.x],['top','Top',c.y],['right','Højre',c.x+c.width],['bottom','Bund',c.y+c.height]].map(([id,label,n])=>`<div><label>${label} %</label><input id="crop-${id}" type="number" min="0" max="100" step="0.1" value="${(n*100).toFixed(1)}"></div>`).join('')}</div><p class="trip-form-error" id="cropError"></p><div class="acts"><button class="btn ghost" id="cropAuto">Find kanter</button><button class="btn ghost" id="cropCancel">Annullér</button><button class="btn" id="cropSave">Gem</button></div>`;
    document.body.append(d);const objectUrl=URL.createObjectURL(source);d.querySelector('#cropPreview').src=objectUrl;d.showModal();d.addEventListener('close',()=>{URL.revokeObjectURL(objectUrl);d.remove()});
    const read=()=>{const [x,y,r,b]=['left','top','right','bottom'].map(k=>Number(d.querySelector('#crop-'+k).value)/100);if([x,y,r,b].some(n=>!Number.isFinite(n))||x<0||y<0||r>1||b>1||r-x<.05||b-y<.05)throw Error('Kontrollér kanterne');return{x,y,width:r-x,height:b-y}};
    async function preview(){try{const cropped=await cropBlob(source,read(),600),u=URL.createObjectURL(cropped);const img=d.querySelector('#cropPreview'),old=img.src;img.src=u;if(old!==objectUrl)URL.revokeObjectURL(old)}catch(e){}}
    d.querySelectorAll('input').forEach(input=>input.onchange=preview);
    d.querySelector('#cropCancel').onclick=()=>d.close();d.querySelector('#cropAuto').onclick=async()=>{const bounds=await paperBounds(source);if(!bounds){d.querySelector('#cropError').textContent='Kan ikke finde sikre kanter. Justér manuelt.';return}['left','top','right','bottom'].forEach((k,i)=>d.querySelector('#crop-'+k).value=([bounds.x,bounds.y,bounds.x+bounds.width,bounds.y+bounds.height][i]*100).toFixed(1));preview()};
    d.querySelector('#cropSave').onclick=async()=>{try{await applyReceiptCrop(it,read());d.close()}catch(e){d.querySelector('#cropError').textContent=e.message}};
  };
});
