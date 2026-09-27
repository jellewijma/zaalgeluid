import { appPath, appRoute } from './paths'

// Remember a destination, never a pairing token, PIN or OAuth query parameter.
function launchPath(url: URL): string | null {
  if (url.origin !== location.origin) return null
  const route = appRoute(url.pathname)
  if (route !== '/player' && route !== '/control') return null
  const room = route === '/control' ? url.searchParams.get('room') : null
  return appPath(route) + (room && /^[A-Za-z0-9_-]{1,128}$/.test(room) ? `?room=${encodeURIComponent(room)}` : '')
}

/** Returns true when navigation replaces this page, so the old route is not mounted. */
export function initializePwa(): boolean {
  const current = new URL(location.href)
  const storageKey = appPath('zaalgeluid-launch')
  const standalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  const home = appRoute() === '/'
  try {
    if (standalone && (home || appRoute() === '/launch') && current.searchParams.get('launch') === 'app') {
      const saved = localStorage.getItem(storageKey)
      const destination = saved ? launchPath(new URL(saved, location.origin)) : null
      if (destination) {
        location.replace(destination)
        return true
      }
    }
    const destination = launchPath(current)
    if (destination) localStorage.setItem(storageKey, destination)
  } catch {
    // A blocked storage API or an invalid saved URL must not stop the app opening.
  }

  // The portfolio redirects /play-audio/ to /play-audio, outside the PWA scope.
  // Keep Home inside that scope without changing authentication/storage namespaces.
  if (standalone && home) {
    location.replace(appPath('/launch'))
    return true
  }

  if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register(appPath('/sw.js'), {
      scope: appPath('/'),
      updateViaCache: 'none',
    }).catch(() => {
      console.warn('De app kon niet worden voorbereid voor offline openen. Je kunt Zaalgeluid blijven gebruiken.')
    })
  }
  return false
}
