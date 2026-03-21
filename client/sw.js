/**
 * sw.js — PocketDex Service Worker
 *
 * Strategy:
 * - Cache the app shell (index.html, app.js, manifest.json) on install
 * - Serve shell from cache for offline/slow connections
 * - Network-first for Socket.IO and dynamic requests
 *
 * This enables "Add to Home Screen" on both iOS and Android.
 */

const CACHE_NAME = 'pocketdex-shell-v4';
const OFFLINE_PAGE = '/offline.html';
const SHELL_ASSETS = [
  '/',
  '/app.js',
  '/account.css',
  '/style.css',
  '/manifest.json',
  '/offline.html',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

const STATIC_PATHS = new Set(SHELL_ASSETS);

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Let Socket.IO and push/API-style requests go straight to network
  if (url.pathname.includes('/socket.io/') || url.pathname.startsWith('/push/')) return;

  // Only cache same-origin static shell assets without query strings
  if (url.origin !== self.location.origin) return;
  if (url.search) return;
  if (!STATIC_PATHS.has(url.pathname)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          );
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match(OFFLINE_PAGE)))
  );
});

// ── Web Push (Item 6) ─────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* ignore */ }
  const title = data.title || 'PocketDex';
  const body  = data.body  || 'Codex is waiting for your approval.';
  const icon  = '/icons/icon.svg';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      badge: icon,
      tag: 'approval',
      renotify: true,
      data: { url: self.registration.scope },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
