/**
 * Service Worker с автоматическим версионированием
 * Инкрементируй VERSION при каждом деплое!
 */

const VERSION = "11"; // <-- МЕНЯЙТЕ ЭТО ЧИСЛО ПРИ КАЖДОМ ОБНОВЛЕНИИ
const CACHE_NAME = `checklist-v${VERSION}`;

// Статические ресурсы для кэширования
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./css/main.css",
  "./js/app.js?v=11",
  "./js/config.js?v=11",
  "./js/data.js?v=11",
  "./js/storage.js?v=11",
  "./js/ui.js?v=11",
  "./js/cache.js?v=11",
];

// Внешние ресурсы (CDN)
const EXTERNAL_ASSETS = [
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
];

// При установке - кэшируем новые ресурсы
self.addEventListener("install", (event) => {
  // Installing service worker

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        // Caching static assets
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        // Кэшируем внешние ресурсы отдельно (может падать)
        return caches.open(CACHE_NAME).then((cache) => {
          return Promise.allSettled(
            EXTERNAL_ASSETS.map((url) =>
              fetch(url, { mode: "no-cors" })
                .then((response) => cache.put(url, response))
                .catch(() => {
                  // Failed to cache external - ignore
                }),
            ),
          );
        });
      })
      .then(() => {
        // Skip waiting
        return self.skipWaiting();
      }),
  );
});

// При активации - удаляем ВСЕ старые кэши
self.addEventListener("activate", (event) => {
  // Activating service worker

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Удаляем все кэши кроме текущего
            if (cacheName !== CACHE_NAME) {
              // Deleting old cache
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => {
        // Claiming clients
        return self.clients.claim();
      })
      .then(() => {
        // Отправляем сообщение всем клиентам о новой версии
        return self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: "NEW_VERSION",
              version: VERSION,
            });
          });
        });
      }),
  );
});

// Стратегии кэширования
const strategies = {
  // Статика - Cache First с фоновым обновлением (Stale While Revalidate)
  static: async (request) => {
    const cached = await caches.match(request);

    const fetchPromise = fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => cached);

    return cached || fetchPromise;
  },

  // API запросы - Network First с коротким таймаутом
  api: async (request) => {
    try {
      // Пробуем сеть с таймаутом 5 секунд
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const networkResponse = await fetch(request, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (networkResponse.ok) {
        // Обновляем кэш в фоне
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, clone);
        });
        return networkResponse;
      }

      throw new Error("Network response not ok");
    } catch (error) {
      // Fallback на кэш
      const cached = await caches.match(request);
      if (cached) {
        // Serving cached response
        return cached;
      }
      throw error;
    }
  },

  // Изображения и медиа - Cache First
  media: async (request) => {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => {
        // Кэшируем только успешные ответы
        cache.put(request, clone);
      });
    }
    return response;
  },
};

// Перехват запросов
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Пропускаем некоторые запросы
  if (request.method !== "GET") return;
  if (url.protocol === "chrome-extension:") return;
  
  // Пропускаем JSONP-запросы (script теги с callback)
  // Они загружаются браузером напрямую, без SW
  if (url.searchParams.has('callback')) {
    return; // Не перехватываем JSONP
  }

  // Пропускаем все запросы к Google Script (JSONP работает напрямую)
  if (url.href.includes("script.google.com")) {
    return; // Не перехватываем API запросы
  }

  // Статические ресурсы приложения (без query-параметров)
  const pathnameWithoutQuery = url.pathname.replace(/^\//, '');
  const staticPaths = STATIC_ASSETS.map(p => p.replace(/^\.\//, '').replace(/\?.*$/, ''));
  if (staticPaths.includes(pathnameWithoutQuery)) {
    event.respondWith(strategies.static(request));
    return;
  }

  // Изображения
  if (request.destination === "image") {
    event.respondWith(strategies.media(request));
    return;
  }

  // Остальные запросы - пробуем сеть, fallback на кэш
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

// Обработка сообщений от клиента
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data === "GET_VERSION") {
    event.ports[0].postMessage(VERSION);
  }

  // Принудительная очистка кэша
  if (event.data === "CLEAR_CACHE") {
    caches
      .keys()
      .then((names) => {
        return Promise.all(names.map((name) => caches.delete(name)));
      })
      .then(() => {
        event.ports[0].postMessage("CACHE_CLEARED");
      });
  }
});

// Обработка push уведомлений (если понадобится)
self.addEventListener("push", (event) => {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon.png",
      badge: "/badge.png",
    }),
  );
});
