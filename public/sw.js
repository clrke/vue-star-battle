/**
 * Star Battle service worker — offline-first shell + cache-first assets.
 *
 * Strategy:
 *   Navigation requests  → stale-while-revalidate (instant load, updates in bg)
 *   /assets/* resources  → cache-first (Vite content hashes = immutable files)
 *   Everything else      → network only (API calls, external resources)
 *
 * Bump CACHE_VERSION when you need to force-evict old caches across devices.
 */

const CACHE_VERSION = 'v1'
const SHELL_CACHE   = `star-battle-shell-${CACHE_VERSION}`
const ASSET_CACHE   = `star-battle-assets-${CACHE_VERSION}`
const BASE          = '/vue-star-battle'

// ── Install: pre-cache the app shell ─────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll([`${BASE}/`, `${BASE}/index.html`]))
      .then(() => self.skipWaiting())
  )
})

// ── Activate: evict stale caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  const live = new Set([SHELL_CACHE, ASSET_CACHE])
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !live.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event

  // Only handle same-origin requests
  if (!request.url.startsWith(self.location.origin)) return

  const url = new URL(request.url)

  // Navigation → stale-while-revalidate
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.open(SHELL_CACHE).then(cache =>
        cache.match(`${BASE}/`).then(cached => {
          const fresh = fetch(request).then(res => {
            cache.put(`${BASE}/`, res.clone())
            return res
          }).catch(() => cached)
          return cached ?? fresh
        })
      )
    )
    return
  }

  // Hashed assets → cache-first (filenames change on every build, so cached
  // entries are inherently correct — no need to revalidate)
  if (url.pathname.startsWith(`${BASE}/assets/`)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(cache =>
        cache.match(request).then(cached => cached ??
          fetch(request).then(res => {
            cache.put(request, res.clone())
            return res
          })
        )
      )
    )
    return
  }

  // Static public files (icons, manifest, sw.js itself) → cache-first
  if (url.pathname.startsWith(BASE) && !url.pathname.includes('.')) {
    // directory-level — already handled by navigate
    return
  }
})
