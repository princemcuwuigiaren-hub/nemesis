/* Nemesis service worker, in the style of Canon's.

   Strategy
   - The app shell (index.html, manifest) is served network first. Every deploy is picked up on the next launch that has a
     connection, with no version bump. The saved copy exists so the app can still open offline or on a slow line.
   - If the network is slower than SHELL_NETWORK_TIMEOUT_MS the saved copy opens at once while the download finishes in the
     background. When the finished download differs from the saved copy (compared by SHA-256 of the bytes) every open
     window is told, so the app can offer a reload.
   - Icons are saved at install and served cache first. Google Fonts are served cache first and saved on first use.
   - Gemini and every other request, and every non-GET request, go straight to the network and are never cached.
   Bump SHELL_CACHE only when the PRECACHE list changes (a new file, or a changed icon). Ordinary changes to index.html need no bump. */
const SHELL_CACHE="nemesis-shell-v1",FONT_CACHE="nemesis-fonts-1";
const PRECACHE=["./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png"];
const FONT_CSS="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700&family=Inter:wght@400;500;600;700&display=swap";
const SHELL_NETWORK_TIMEOUT_MS=6000;

self.addEventListener("install",e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(SHELL_CACHE);
    /* each file on its own, so one failure does not sink offline support for the rest. cache:"reload" skips the browser's HTTP cache */
    await Promise.all(PRECACHE.map(u=>c.add(new Request(u,{cache:"reload"})).catch(x=>console.warn("Nemesis SW: precache skipped for",u,x&&x.message))));
    try{const f=await caches.open(FONT_CACHE);await f.add(new Request(FONT_CSS))}catch(x){}
  })());
  self.skipWaiting()});

self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(ns=>Promise.all(ns
    /* retire older Nemesis shell caches, including the pre-Canon-style "nemesis-m5-*" names. Fonts and foreign caches stay. */
    .filter(n=>(n.startsWith("nemesis-shell-")&&n!==SHELL_CACHE)||/^nemesis-m5-/.test(n))
    .map(n=>caches.delete(n)))));
  self.clients.claim()});

self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;
  const u=new URL(r.url),same=u.origin===self.location.origin;
  if(same&&(r.mode==="navigate"||/\/(index\.html|manifest\.webmanifest)$/.test(u.pathname))){e.respondWith(networkFirst(r,e));return}
  if(same&&/\/icon-(192|512)\.png$/.test(u.pathname)){e.respondWith(cacheFirst(r,e,SHELL_CACHE));return}
  if(u.hostname==="fonts.googleapis.com"||u.hostname==="fonts.gstatic.com"){e.respondWith(cacheFirst(r,e,FONT_CACHE));return}
  /* everything else (Gemini included) is not touched */
});

/* A fingerprint of a saved or fresh shell: SHA-256 of the body. Headers are not used, because two builds can share a length
   and a CDN can report different ETags for identical content. */
async function sig(resp){
  try{const d=await crypto.subtle.digest("SHA-256",await resp.clone().arrayBuffer());return"x:"+Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("")}catch(x){return""}}
async function notifyUpdateReady(){
  const ws=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  ws.forEach(c=>c.postMessage({type:"nemesis-update-ready"}))}

async function networkFirst(request,event){
  const cache=await caches.open(SHELL_CACHE),shellUrl=new URL("./index.html",self.registration.scope).href,isNav=request.mode==="navigate";
  /* one canonical entry for the page, whatever address launched it (site root, index.html, or either with a ?query) */
  const fromCache=async()=>{if(isNav){const s=await cache.match(shellUrl);if(s)return s}return cache.match(request,{ignoreSearch:true})};
  let servedSaved=false;
  const net=fetch(request,{cache:"no-cache"}).then(async fresh=>{
    /* only real, successful responses overwrite the saved copy */
    if(fresh&&fresh.ok){
      let changed=false;
      if(isNav){try{const old=await cache.match(shellUrl);if(old){const[a,b]=await Promise.all([sig(old),sig(fresh)]);changed=!!a&&!!b&&a!==b}}catch(x){}}
      const saved=cache.put(isNav?shellUrl:request,fresh.clone()).then(()=>{if(changed&&servedSaved)return notifyUpdateReady()}).catch(x=>console.warn("Nemesis SW: could not save",request.url,x&&x.message));
      if(event&&event.waitUntil)event.waitUntil(saved)}
    return fresh});
  net.catch(()=>{});
  if(event&&event.waitUntil)event.waitUntil(net.catch(()=>{}));
  const cached=await fromCache();
  if(!cached)return net; /* first ever load: nothing saved, so wait */
  const slow=new Promise(res=>setTimeout(()=>res(null),SHELL_NETWORK_TIMEOUT_MS));
  try{const w=await Promise.race([net,slow]);if(w&&w.ok)return w}catch(x){}
  servedSaved=true;return cached}

async function cacheFirst(request,event,name){
  const cache=await caches.open(name),hit=await cache.match(request);
  if(hit)return hit;
  const fresh=await fetch(request);
  /* opaque responses (a stylesheet or font loaded without CORS) cannot be inspected but are fine to keep */
  if(fresh&&(fresh.ok||fresh.type==="opaque")){const s=cache.put(request,fresh.clone()).catch(()=>{});if(event&&event.waitUntil)event.waitUntil(s)}
  return fresh}
