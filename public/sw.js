/* global self, URL, fetch, Response */
// Network-only navigation keeps live playback, authentication and deployments fresh.
// No audio, account data, API responses or old application bundles are cached.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  const scope = new URL(self.registration.scope)
  if (request.method !== 'GET' || request.mode !== 'navigate'
    || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return
  const route = url.pathname.slice(scope.pathname.length).replace(/\/+$/, '')
  if (!['', 'launch', 'player', 'control', 'privacy'].includes(route)) return

  event.respondWith(fetch(request).catch(() => new Response(`<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#111714"><title>Geen verbinding · Zaalgeluid</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111714;color:#eef4f0;font:1rem/1.6 system-ui,sans-serif}main{max-width:30rem;padding:2rem}h1{font-size:1.8rem}a{color:#7bd6a7}</style>
</head><body><main><h1>Geen verbinding</h1><p>Zaalgeluid kan de afspeler niet bereiken. Controleer je internetverbinding of de verbinding met het lokale netwerk en de pc.</p><a href="">Opnieuw proberen</a></main></body></html>`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'",
    },
  })))
})
