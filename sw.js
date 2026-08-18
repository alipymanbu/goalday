/* 计划册 Service Worker - 离线可用 + 每次刷新拉取最新
   v43 重大修复：导航请求（HTML 页面）一律 network-first
   —— v42 的 SHELL_RE 只匹配 /index.html 结尾的 URL，但用户访问 /goalday/ 时
   pathname 是 /goalday/ 不匹配 → 落入 cache-first → 永远返回旧 HTML！
   修复：用 e.request.mode==='navigate' 捕获所有页面导航，保证每次拉最新 HTML。 */
const CACHE = "jihua-v64";
const ASSETS = [
  "./",
  "./styles.css",
  "./app.js",
  "./plus.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 缓存策略（v64 优化，核心目标：重复访问秒开 + 更新仍必达）
   - 导航请求（HTML）：network-first，永远拿到最新页面
   - version.json：network-first（仅作离线兜底），保证 autoSync 读到最新 build 号，避免刷新死循环
   - shell 静态资源（app.js / styles.css / plus.js / manifest）：cache-first + 后台静默更新
        SW 缓存名已按版本号隔离（jihua-vXX），升级时旧缓存自动清理，故可安全走缓存优先，
        使重复访问不再每次联网拉 ~150KB 的 JS/CSS，整体响应时间大幅下降
   - 其余资源（图标等）：缓存优先，离线可用 */
const SHELL_RE = /\/(styles\.css|app\.js|plus\.js|manifest\.webmanifest)$/;

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  /* 导航请求：network-first（HTML 永远最新） */
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./")))
    );
    return;
  }

  /* version.json：network-first，缓存仅作离线兜底（autoSync 需读到最新版本号） */
  if (url.pathname.endsWith("/version.json")) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
    return;
  }

  /* shell 静态资源：cache-first + 后台静默更新（重复访问秒开） */
  if (SHELL_RE.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request, { ignoreSearch: true }).then(hit => {
          const net = fetch(e.request).then(res => {
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          }).catch(() => hit || caches.match("./"));
          return hit || net;
        })
      )
    );
    return;
  }

  // 其余资源（图标等）：缓存优先，离线可用
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match("./"));
    })
  );
});
