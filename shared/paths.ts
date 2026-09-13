/** A URL path prefix, shared by the Vite build and the Node server. */
export function normalizeBasePath(value = '/'): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/') return '/'
  const segments = trimmed.replace(/^\/+|\/+$/g, '').split('/')
  if (segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))) {
    throw new Error('APP_BASE_PATH moet een pad zijn zoals /play-audio, met alleen letters, cijfers, streepjes en underscores.')
  }
  return `/${segments.join('/')}/`
}

export function withBasePath(basePath: string, pathname: string): string {
  return `${normalizeBasePath(basePath)}${pathname.replace(/^\/+/, '')}`
}

/** Returns null for a URL outside this app; /play-audio-other is not a match. */
export function stripBasePath(basePath: string, pathname: string): string | null {
  const base = normalizeBasePath(basePath)
  const prefix = base.slice(0, -1)
  if (pathname !== prefix && !pathname.startsWith(base)) return null
  const route = pathname.slice(prefix.length).replace(/\/+$/, '')
  return route || '/'
}
