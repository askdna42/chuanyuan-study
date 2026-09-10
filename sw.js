/* 船员学习室 · Service Worker
   让手机「添加到主屏幕」后像 App 一样打开，断网也能看到界面 */
const CACHE = 'cy-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './assets/style.css', './assets/config.js', './assets/seed.js',
  './assets/store.js', './assets/app.js', './assets/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 策略：网页和代码文件走「网络优先」——这样每次改完重新部署，用户打开就是新版；
   拿不到网络时自动回落到缓存，所以断网依然能打开。
   图片等静态资源走「缓存优先」。 */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isCode = req.mode === 'navigate' || /\.(html|js|css|webmanifest)$/.test(url.pathname);
  if (isCode) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }))
  );
});
