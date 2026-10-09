var CACHE_NAME='miningbtc-v2';
var ASSETS=['/','/index.html','/style.css','/app.js','/config.js','/sha256d.js','/icon.svg','/manifest.json'];
self.addEventListener('install',function(e){self.skipWaiting();e.waitUntil(caches.open(CACHE_NAME).then(function(c){return c.addAll(ASSETS)}))});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.filter(function(k){return k!==CACHE_NAME}).map(function(k){return caches.delete(k)}))}).then(function(){return self.clients.claim()}))});
self.addEventListener('fetch',function(e){e.respondWith(fetch(e.request).then(function(res){return caches.open(CACHE_NAME).then(function(c){c.put(e.request,res.clone());return res})}).catch(function(){return caches.match(e.request)}))});