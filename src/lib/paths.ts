import { normalizeBasePath, stripBasePath, withBasePath } from '../../shared/paths'

// The fallback also permits importing the audio engine in Node-based tests.
const basePath = normalizeBasePath(import.meta.env?.BASE_URL ?? '/')

export function appPath(pathname: string): string {
  return withBasePath(basePath, pathname)
}

export function appRoute(pathname = location.pathname): string | null {
  return stripBasePath(basePath, pathname)
}
