/* Nemesis service worker. Caches the app shell only. Gemini calls and anything else cross-origin go straight to the network.
   Bump CACHE on every release so old caches are removed. */
const CACHE="nemesis-m5-1",FONTS="nemesis-fonts-1";
const SHELL=["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!==FONTS).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
const timeout=ms=>new Promise((_,rej)=>setTimeout(()=>rej(new Error("slow")),ms));
self.addEventListener("fetch",e=>{
  const r=e.request;if(r.method!=="GET")return;
  const u=new URL(r.url);
  if(u.origin===location.origin){
    if(r.mode==="navigate"){
      /* network first so a new version always arrives when online; the cache answers when offline or very slow */
      e.respondWith(Promise.race([fetch(r),timeout(4000)]).then(res=>{if(res&&res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put("index.html",cp))}return res}).catch(()=>caches.match("index.html").then(x=>x||caches.match("./"))));
      return}
    e.respondWith(caches.match(r).then(x=>x||fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(CACHE).then(c=>c.put(r,cp))}return res})));
    return}
  if(u.hostname==="fonts.googleapis.com"||u.hostname==="fonts.gstatic.com"){
    e.respondWith(caches.open(FONTS).then(c=>c.match(r).then(x=>{const f=fetch(r).then(res=>{if(res.ok||res.type==="opaque")c.put(r,res.clone());return res}).catch(()=>x);return x||f})))}
});
