var CACHE_NAME='miningbtc-v1';
var ASSETS=['/','/index.html','/style.css','/app.js','/config.js','/sha256d.js','/icon.svg','/manifest.json'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(CACHE_NAME).then(function(c){return c.addAll(ASSETS)}))});
self.addEventListener('fetch',function(e){e.respondWith(caches.match(e.request).then(function(r){return r||fetch(e.request).then(function(res){return caches.open(CACHE_NAME).then(function(c){c.put(e.request,res.clone());return res})})}))});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.filter(function(k){return k!==CACHE_NAME}).map(function(k){return caches.delete(k)}))}))});