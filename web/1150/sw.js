// Маккод Service Worker — OTA-кеш для iOS-обёртки.
// HTML: network-first (всегда свежий, если есть сеть; кеш как fallback offline).
// Ассеты same-origin: stale-while-revalidate (мгновенный старт из кеша + фоновое обновление).
// Cross-origin картинки/видео/документы из чата: stale-while-revalidate в отдельный
// media-cache с мягким лимитом 100 МБ (LRU-выселение по порядку keys() в CacheStorage —
// stale-while-revalidate переставляет hit в конец на каждом put, что эмулирует LRU).
// Версия cache name бампается на каждый деплой через build.mjs.

const CACHE_VERSION = "20260604094503000-v1150";
const CACHE = `maccode-${CACHE_VERSION}`;
// MEDIA_CACHE намеренно НЕ привязан к CACHE_VERSION — иначе на каждом деплое
// activate-листенер удаляет старый media-cache вместе с code-cache, и все
// картинки чата качаются заново. Бамп суффикса (v1→v2) делать только когда
// меняется СХЕМА записей media-cache (например, формат match'а ключа).
const MEDIA_CACHE = `maccode-media-v1`;
const MEDIA_MAX_BYTES = 100 * 1024 * 1024;

// Диагностика — счётчики событий SW. Через postMessage(GET_STATS) фронт
// читает их в Настройках → строка `[data-cache-stats]`. Нужно понять,
// видит ли вообще SW fetch'и от <img> на iOS WKWebView (исторический
// pain-point: бывает, что SW не перехватывает запросы тегов изображений).
const _stats = {
  totalFetch: 0,    // все GET-fetch'и, дошедшие до listener
  crossSeen: 0,     // cross-origin запросы
  mediaSeen: 0,     // из них — медиа по нашему фильтру
  mediaPutOk: 0,    // успешный cache.put
  mediaPutErr: 0,   // ошибка cache.put
  lastMediaUrl: "", // последний URL который пытались кешировать
  lastErr: "",      // текст последней ошибки put
};

// Эти расширения и destination'ы считаем «медиа» — кешируем cross-origin.
const MEDIA_EXT_RE = /\.(jpe?g|png|gif|webp|avif|heic|heif|svg|bmp|ico|mp4|mov|webm|m4v|mp3|m4a|aac|ogg|wav|opus|pdf|docx?|xlsx?|pptx?|zip|tgz|gz)(\?|$)/i;
const MEDIA_DESTINATIONS = new Set(["image", "video", "audio", "font"]);

function isMediaRequest(req, url) {
  if (MEDIA_DESTINATIONS.has(req.destination)) return true;
  if (req.destination === "document" || req.mode === "navigate") return false;
  return MEDIA_EXT_RE.test(url.pathname);
}

// Подсчёт байт ответа — берём Content-Length, иначе клонируем blob.
async function _responseBytes(resp) {
  if (!resp) return 0;
  const cl = resp.headers.get("content-length");
  if (cl) {
    const n = parseInt(cl, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  try {
    const blob = await resp.clone().blob();
    return blob.size || 0;
  } catch (_) {
    return 0;
  }
}

// Дебаунс prune — чтоб не пересчитывать на каждый put в высоком темпе.
let _pruneScheduled = false;
function schedulePrune() {
  if (_pruneScheduled) return;
  _pruneScheduled = true;
  setTimeout(() => {
    _pruneScheduled = false;
    pruneMediaCache(MEDIA_MAX_BYTES).catch(() => {});
  }, 1500);
}

async function pruneMediaCache(maxBytes) {
  const cache = await caches.open(MEDIA_CACHE);
  const reqs = await cache.keys();
  if (!reqs.length) return;
  // Считаем размеры по порядку (CacheStorage гарантирует insertion order).
  const sizes = [];
  let total = 0;
  for (const r of reqs) {
    const resp = await cache.match(r);
    const b = await _responseBytes(resp);
    sizes.push(b);
    total += b;
  }
  if (total <= maxBytes) return;
  // Выселяем с начала — самые «старые» по insertion order.
  for (let i = 0; i < reqs.length && total > maxBytes; i++) {
    try {
      await cache.delete(reqs[i]);
      total -= sizes[i];
    } catch (_) {}
  }
}

self.addEventListener("install", (e) => {
  // Не блокируем активацию pre-cache'ом — сеть наполнит кеш по факту использования.
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => (k.startsWith("maccode-") || k.startsWith("maccode-media-")) && k !== CACHE && k !== MEDIA_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  _stats.totalFetch++;

  const url = new URL(req.url);

  // Cross-origin — кешируем только медиа в отдельный namespace.
  if (url.origin !== self.location.origin) {
    _stats.crossSeen++;
    if (!isMediaRequest(req, url)) return;
    _stats.mediaSeen++;
    _stats.lastMediaUrl = req.url;
    e.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA_CACHE);
        // LRU-trick: при попадании удаляем и заново кладём в конец очереди.
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === "opaque")) {
              cache.put(req, res.clone())
                .then(() => { _stats.mediaPutOk++; schedulePrune(); })
                .catch((err) => { _stats.mediaPutErr++; _stats.lastErr = String(err && err.message || err); });
            }
            return res;
          })
          .catch(() => null);
        if (cached) {
          // Промоутим запись в конец очереди (LRU). Не блокируем ответ — fire&forget.
          (async () => {
            try {
              const fresh = cached.clone();
              await cache.delete(req);
              await cache.put(req, fresh);
            } catch (_) {}
          })();
          return cached;
        }
        return (await network) || Response.error();
      })()
    );
    return;
  }

  // Не кешируем sw.js — пусть браузер сам решает, была ли смена байт.
  if (url.pathname === "/sw.js") return;

  const isHTML = req.mode === "navigate" || req.destination === "document";

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);

      if (isHTML) {
        // Network-first.
        try {
          const fresh = await fetch(req, { cache: "no-store" });
          if (fresh && fresh.ok) cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch (_) {
          const cached = await cache.match(req);
          if (cached) return cached;
          // Финальный fallback — корень.
          const fallback = await cache.match("/");
          if (fallback) return fallback;
          throw _;
        }
      }

      // Stale-while-revalidate.
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);

      return cached || (await network) || Response.error();
    })()
  );
});

// Канал «есть обновление» — даёт фронту шанс показать тост и/или мягко перезагрузиться.
// Плюс GET_STATS — фронт читает счётчики событий SW для диагностики офлайн-кеша.
self.addEventListener("message", (e) => {
  if (!e.data) return;
  if (e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (e.data.type === "GET_STATS") {
    const port = (e.ports && e.ports[0]) || null;
    const payload = { ..._stats, version: CACHE_VERSION };
    if (port) {
      try { port.postMessage(payload); } catch (_) {}
    } else if (e.source) {
      try { e.source.postMessage({ type: "SW_STATS", payload }); } catch (_) {}
    }
  }
});
