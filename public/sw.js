/**
 * 离线缓存：装到桌面后断网也能用。
 * 改了任何静态文件，把 VERSION 加一，用户下次打开就会拿到新版本。
 */
const VERSION = '1.0.1';
const CACHE = `worddrill-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './js/repo.js',
  './js/store.js',
  './js/quiz.js',
  './js/vocab.js',
  './js/about.js',
  './js/persist.js',
  './manifest.webmanifest',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './assets/words3500.json',
  './assets/about.txt',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 打开页面：优先网络（拿新版本），断网时回退到缓存的首页
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./'))),
    );
    return;
  }

  // 其它资源：先用缓存秒开，同时后台更新
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
