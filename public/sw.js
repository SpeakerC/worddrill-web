/**
 * 离线缓存：装到桌面后断网也能用。
 * 改了任何静态文件，把 VERSION 加一，用户下次打开就会拿到新版本。
 */
const VERSION = '2.0.2';
const CACHE = `worddrill-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './js/repo.js',
  './js/store.js',
  './js/csv.js',
  './js/quiz.js',
  './js/confuse.js',
  './js/vocab.js',
  './js/about.js',
  './js/persist.js',
  './js/review.js',
  './js/speech.js',
  './js/settings.js',
  './js/theme.js',
  './manifest.webmanifest',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './assets/words3500.json',
  './assets/words-cet4.json',
  './assets/about.txt',
  './assets/privacy.txt',
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

/* 这些文件必须「先问网络」：改了就要马上看到，不能先给旧缓存 */
const NETWORK_FIRST = [
  /\/$/,
  /\/index\.html$/,
  /\/app\.js$/,
  /\/js\/[^/]+\.js$/,
  /\.css$/,
  /\/assets\/about\.txt$/,
  /\/assets\/privacy\.txt$/,
];

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate';
  const preferNetwork = isNavigation || NETWORK_FIRST.some((rule) => rule.test(url.pathname));

  if (preferNetwork) {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            const key = isNavigation ? './index.html' : request;
            caches.open(CACHE).then((cache) => cache.put(key, copy));
          }
          return response;
        })
        .catch(() => caches.match(isNavigation ? './index.html' : request)
          .then((hit) => hit || (isNavigation ? caches.match('./') : undefined))),
    );
    return;
  }

  // 图片、词表这类不常改的：先用缓存秒开，同时后台更新。
  // 缓存命中时，返回给页面的是 hit，network 拿到的 response 没人消费，
  // 这时直接写缓存即可；只有未命中才把它原样交给页面，所以只在那种情况下 clone。
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) {
        // 后台更新缓存，结果不交给页面
        fetch(request)
          .then((response) => {
            if (response && response.ok) {
              return caches.open(CACHE).then((cache) => cache.put(request, response));
            }
            return undefined;
          })
          .catch(() => {});
        return hit;
      }
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {}),
            );
          }
          return response;
        })
        .catch(() => hit);
    }),
  );
});
















