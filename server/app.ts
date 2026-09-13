import express, { type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import { WebSocketServer, WebSocket } from 'ws'
import { createServer, type IncomingMessage } from 'node:http'
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { initialPlayback, type Command, type Playback, type RoomState, type ServerMessage, type Track } from '../shared/protocol.js'

const SESSION_MS = 12 * 60 * 60 * 1000
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.aif', '.aiff', '.opus', '.webm', '.mp4'])
const STATUSES = new Set(['idle', 'loading', 'playing', 'paused', 'stopped', 'ended', 'error'])
type StoredTrack = Track & { storedFilename: string }
type Role = 'player' | 'controller'
type Peer = { role: Role; alive: boolean; expiresAt: number }
export interface ServerOptions { dataDir?: string; port?: number; host?: string; dev?: boolean }

function publicTrack({ id, name, filename, size, createdAt }: StoredTrack): Track {
  return { id, name, filename, size, createdAt }
}
function isLoopback(address: string | undefined) {
  return address === '::1' || address === '127.0.0.1' || address?.startsWith('::ffff:127.') || address?.startsWith('127.')
}
function equalSecret(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
function finiteRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}
function displayFilename(original: string) {
  // Browsers commonly send UTF-8 names through multipart's Latin-1 header decoding.
  const utf8 = Buffer.from(original, 'latin1').toString('utf8')
  const decoded = utf8.includes('\uFFFD') ? original : utf8
  const basename = path.basename(decoded.replaceAll('\\', '/'))
  return [...basename].filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').trim().slice(0, 220) || 'Audiofragment'
}
function localAddresses() {
  // Prefer the room's physical LAN over VPN and virtual adapters for the tablet QR.
  return Object.entries(networkInterfaces())
    .flatMap(([adapter, entries]) => (entries ?? []).map((entry) => ({ ...entry, adapter })))
    .filter((entry) => !entry.internal)
    .sort((left, right) => Number(/tailscale|zerotier|vethernet|vmware|virtualbox|docker|wsl|vpn/i.test(left.adapter))
      - Number(/tailscale|zerotier|vethernet|vmware|virtualbox|docker|wsl|vpn/i.test(right.adapter)))
}

export async function createAppServer(options: ServerOptions = {}) {
  const dataDir = path.resolve(options.dataDir ?? path.join(process.cwd(), 'data'))
  const audioDir = path.join(dataDir, 'audio')
  const manifestPath = path.join(dataDir, 'library.json')
  const settingsPath = path.join(dataDir, 'settings.json')
  await mkdir(audioDir, { recursive: true })
  let pin: string
  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as { pin?: unknown }
    if (typeof settings.pin !== 'string' || !/^\d{6}$/.test(settings.pin)) throw new Error('Ongeldige koppelcode in data/settings.json.')
    pin = settings.pin
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    pin = String(randomInt(100000, 1000000))
    await writeFile(settingsPath, JSON.stringify({ pin }, null, 2), { mode: 0o600, flag: 'wx' })
  }
  let library: StoredTrack[] = []
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (!Array.isArray(parsed) || !parsed.every((item: StoredTrack) => item && typeof item.id === 'string'
      && typeof item.name === 'string' && typeof item.filename === 'string' && typeof item.storedFilename === 'string'
      && path.basename(item.storedFilename) === item.storedFilename && !item.storedFilename.includes('\\')
      && /^[0-9a-f-]{36}\.[a-z0-9]+$/.test(item.storedFilename)
      && AUDIO_EXTENSIONS.has(path.extname(item.storedFilename)) && finiteRange(item.size, 0, 500 * 1024 * 1024)
      && typeof item.createdAt === 'string')) throw new Error('Ongeldige audiobibliotheek in data/library.json. De bestaande bestanden zijn behouden.')
    library = parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(manifestPath, '[]\n', { flag: 'wx' })
  }
  let mutationQueue = Promise.resolve()
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation)
    mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }
  async function saveLibrary(next: StoredTrack[]) {
    const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`)
    await rename(temporaryPath, manifestPath)
    library = next
  }
  const playerToken = randomBytes(32).toString('hex')
  const sessions = new Map<string, number>()
  const failedPairings = new Map<string, { count: number; until: number }>()
  const peers = new Map<WebSocket, Peer>()
  let activePlayer: WebSocket | null = null
  let pendingTrackId: string | null = null
  const deletingTrackIds = new Set<string>()
  let playback: Playback = { ...initialPlayback }
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', false)
  const server = createServer(app)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })

  function validHost(request: IncomingMessage) {
    const host = request.headers.host
    if (!host) return false
    try {
      const hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, '').toLowerCase()
      return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
        || localAddresses().some((entry) => entry.address.toLowerCase() === hostname)
    } catch { return false }
  }
  function validOrigin(request: IncomingMessage) {
    const origin = request.headers.origin
    if (!origin) return true // Native clients do not set Origin; browser cross-origin requests do.
    return origin === `http://${request.headers.host}`
  }
  function roleForToken(token: string | undefined): Role | null {
    if (!token) return null
    if (equalSecret(token, playerToken)) return 'player'
    const expiresAt = sessions.get(token)
    if (expiresAt && expiresAt > Date.now()) return 'controller'
    if (expiresAt) sessions.delete(token)
    return null
  }
  function bearer(request: Request) { return request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1] }
  function authorized(request: Request, response: Response, next: NextFunction) {
    if (!roleForToken(bearer(request))) return response.status(401).json({ error: 'Koppel dit apparaat eerst.' })
    next()
  }
  function localPlayer(request: Request, response: Response, next: NextFunction) {
    if (!isLoopback(request.socket.remoteAddress) || roleForToken(bearer(request)) !== 'player') {
      return response.status(403).json({ error: 'Audio beheren kan alleen op de afspeelcomputer.' })
    }
    next()
  }
  function roomState(): RoomState {
    return { tracks: library.map(publicTrack), playerOnline: activePlayer?.readyState === WebSocket.OPEN,
      controllerCount: [...peers.values()].filter((peer) => peer.role === 'controller').length,
      playback: { ...playback } }
  }
  function send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }
  function broadcast() {
    const message: ServerMessage = { type: 'state', state: roomState() }
    for (const socket of peers.keys()) send(socket, message)
  }
  function fail(socket: WebSocket, message: string, code: string) { send(socket, { type: 'error', message, code }) }

  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    if (!validHost(request) || !validOrigin(request)) return response.status(403).json({ error: 'Dit verzoek komt niet van deze lokale app.' })
    next()
  })
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next() })
  app.use(express.json({ limit: '16kb' }))
  app.get('/api/setup', (request, response) => {
    if (!isLoopback(request.socket.remoteAddress)) return response.status(403).json({ error: 'Open deze pagina op de afspeelcomputer via localhost.' })
    const port = (server.address() as AddressInfo | null)?.port ?? options.port ?? 3000
    const urls = [...new Set(localAddresses().filter((entry) => entry.family === 'IPv4').map((entry) => `http://${entry.address}:${port}/control`))]
    response.json({ pin, token: playerToken, urls })
  })
  app.post('/api/pair', (request, response) => {
    const ip = request.socket.remoteAddress ?? 'unknown'
    const previous = failedPairings.get(ip)
    if (previous && previous.until > Date.now() && previous.count >= 8) {
      response.setHeader('Retry-After', Math.ceil((previous.until - Date.now()) / 1000))
      return response.status(429).json({ error: 'Te veel pogingen. Probeer het over enkele minuten opnieuw.' })
    }
    if (typeof request.body?.pin !== 'string' || !equalSecret(request.body.pin.trim(), pin)) {
      const attempt = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 5 * 60 * 1000 }
      attempt.count += 1
      failedPairings.set(ip, attempt)
      return response.status(401).json({ error: 'Deze koppelcode klopt niet.' })
    }
    failedPairings.delete(ip)
    const token = randomBytes(32).toString('hex')
    sessions.set(token, Date.now() + SESSION_MS)
    response.json({ token })
  })
  app.get('/api/tracks', authorized, (_request, response) => response.json(library.map(publicTrack)))
  const upload = multer({
    storage: multer.diskStorage({ destination: audioDir, filename: (_request, file, callback) => callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`) }),
    limits: { fileSize: 500 * 1024 * 1024, files: 50, fields: 0 },
    fileFilter: (_request, file, callback) => {
      if (!AUDIO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase())) return callback(new Error('Kies een audiobestand, zoals mp3, wav, m4a, ogg of flac.'))
      callback(null, true)
    },
  }).array('files', 50)
  app.post('/api/tracks', localPlayer, (request, response, next) => {
    upload(request, response, (error: unknown) => {
      if (error) return next(error)
      const files = (request.files ?? []) as Express.Multer.File[]
      if (!files.length) return response.status(400).json({ error: 'Kies minimaal één audiobestand.' })
      void mutate(async () => {
        const tracks: StoredTrack[] = files.map((file) => {
          const filename = displayFilename(file.originalname)
          return { id: path.parse(file.filename).name, name: path.parse(filename).name, filename,
            storedFilename: file.filename, size: file.size, createdAt: new Date().toISOString() }
        })
        try { await saveLibrary([...library, ...tracks]) }
        catch (saveError) { await Promise.allSettled(files.map((file) => unlink(file.path))); throw saveError }
        broadcast()
        response.status(201).json({ tracks: tracks.map(publicTrack) })
      }).catch(next)
    })
  })
  app.delete('/api/tracks/:id', localPlayer, (request, response, next) => {
    void mutate(async () => {
      const track = library.find((item) => item.id === request.params.id)
      if (!track) return response.status(404).json({ error: 'Dit audiofragment bestaat niet meer.' })
      if (playback.trackId === track.id || pendingTrackId === track.id) return response.status(409).json({ error: 'Selecteer eerst een ander fragment voordat je dit verwijdert.' })
      deletingTrackIds.add(track.id)
      try { await saveLibrary(library.filter((item) => item.id !== track.id)) }
      finally { deletingTrackIds.delete(track.id) }
      await unlink(path.join(audioDir, track.storedFilename)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') console.error('Audiobestand kon niet worden opgeruimd:', error.code) })
      broadcast()
      response.status(204).end()
    }).catch(next)
  })
  app.get('/api/audio/:id', (request, response) => {
    const token = typeof request.query.token === 'string' ? request.query.token : bearer(request)
    if (roleForToken(token) !== 'player') return response.status(401).json({ error: 'Alleen de afspeler kan audio ophalen.' })
    const track = library.find((item) => item.id === request.params.id)
    if (!track) return response.status(404).json({ error: 'Dit audiofragment bestaat niet meer.' })
    response.sendFile(path.join(audioDir, track.storedFilename), { acceptRanges: true, cacheControl: false })
  })
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Onbekend verzoek.' }))

  function validPlayback(value: unknown): value is Playback {
    if (!value || typeof value !== 'object') return false
    const next = value as Playback
    return (next.trackId === null || (typeof next.trackId === 'string' && library.some((track) => track.id === next.trackId)))
      && STATUSES.has(next.status) && finiteRange(next.currentTime, 0, 7 * 24 * 3600)
      && finiteRange(next.duration, 0, 7 * 24 * 3600) && next.currentTime <= next.duration + 1
      && finiteRange(next.volume, 0, 1) && typeof next.ready === 'boolean'
      && (next.error === null || (typeof next.error === 'string' && next.error.length <= 1000))
      && (next.status !== 'playing' || next.trackId !== null)
  }
  function parseCommand(value: unknown): Command | null {
    if (!value || typeof value !== 'object') return null
    const input = value as Record<string, unknown>
    if (input.action === 'select' && typeof input.trackId === 'string' && !deletingTrackIds.has(input.trackId) && library.some((track) => track.id === input.trackId)) return { action: 'select', trackId: input.trackId }
    if (input.action === 'volume' && finiteRange(input.value, 0, 1)) return { action: 'volume', value: input.value }
    if (input.action === 'seek' && finiteRange(input.value, 0, playback.duration)) return { action: 'seek', value: input.value }
    if (input.action === 'play' || input.action === 'pause' || input.action === 'stop' || input.action === 'restart' || input.action === 'clear') return { action: input.action }
    return null
  }
  server.on('upgrade', (request, socket, head) => {
    let url: URL
    try { url = new URL(request.url ?? '/', 'http://localhost') } catch { socket.destroy(); return }
    // Vite owns its own HMR websocket in development.
    if (url.pathname !== '/ws') { if (!options.dev) socket.destroy(); return }
    const token = url.searchParams.get('token') ?? undefined
    const role = roleForToken(token)
    if (!validHost(request) || !validOrigin(request) || !role) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      if (role === 'player' && activePlayer && activePlayer.readyState !== WebSocket.CLOSED) {
        fail(webSocket, 'Er is al een afspeler actief. Sluit die eerst om deze computer te gebruiken.', 'PLAYER_BUSY')
        webSocket.close(4009, 'PLAYER_BUSY')
        return
      }
      peers.set(webSocket, { role, alive: true, expiresAt: role === 'player' ? Infinity : sessions.get(token!)! })
      if (role === 'player') { activePlayer = webSocket; playback = { ...playback, ready: false, status: 'stopped' } }
      webSocket.on('pong', () => { const peer = peers.get(webSocket); if (peer) peer.alive = true })
      webSocket.on('error', () => webSocket.terminate())
      webSocket.on('message', (data, isBinary) => {
        const peer = peers.get(webSocket)
        if (!peer || peer.expiresAt <= Date.now()) { fail(webSocket, 'Koppel dit apparaat opnieuw.', 'UNAUTHORIZED'); webSocket.close(4001, 'SESSION_EXPIRED'); return }
        let message: Record<string, unknown>
        try {
          if (isBinary) throw new Error('binary')
          message = JSON.parse(data.toString()) as Record<string, unknown>
          if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('shape')
        } catch { fail(webSocket, 'Ongeldig bericht.', 'INVALID_MESSAGE'); return }
        if (message.type === 'ping') { send(webSocket, { type: 'pong' }); return }
        if (message.type === 'playback') {
          if (peer.role !== 'player' || activePlayer !== webSocket) { fail(webSocket, 'Alleen de afspeler kan de afspeelstatus wijzigen.', 'UNAUTHORIZED'); return }
          if (!validPlayback(message.playback)) { fail(webSocket, 'Ongeldige afspeelstatus.', 'INVALID_PLAYBACK'); return }
          const next = message.playback
          playback = { trackId: next.trackId, status: next.status, currentTime: next.currentTime,
            duration: next.duration, volume: next.volume, ready: next.ready, error: next.error }
          if (pendingTrackId === next.trackId || next.status === 'error') pendingTrackId = null
          broadcast()
          return
        }
        if (message.type === 'command') {
          const command = parseCommand(message.command)
          if (!command) { fail(webSocket, 'Ongeldige bediening of onbekend fragment.', 'INVALID_COMMAND'); return }
          if (!activePlayer || activePlayer.readyState !== WebSocket.OPEN || !playback.ready) {
            fail(webSocket, 'De afspeler is niet gereed. Activeer audio op de afspeelcomputer.', 'PLAYER_NOT_READY'); return
          }
          if (command.action !== 'select' && command.action !== 'volume' && command.action !== 'clear' && !playback.trackId && !pendingTrackId) {
            fail(webSocket, 'Selecteer eerst een audiofragment.', 'NO_TRACK'); return
          }
          if (command.action === 'select') pendingTrackId = command.trackId
          if (command.action === 'clear') pendingTrackId = null
          send(activePlayer, { type: 'command', id: randomUUID(), command })
          return
        }
        fail(webSocket, 'Onbekend bericht.', 'INVALID_MESSAGE')
      })
      webSocket.on('close', () => {
        peers.delete(webSocket)
        if (activePlayer === webSocket) {
          activePlayer = null
          pendingTrackId = null
          playback = { ...playback, ready: false, status: 'stopped', currentTime: 0, error: null }
        }
        broadcast()
      })
      broadcast()
    })
  })
  const heartbeat = setInterval(() => {
    const now = Date.now()
    for (const [token, expiry] of sessions) if (expiry <= now) sessions.delete(token)
    for (const [ip, attempts] of failedPairings) if (attempts.until <= now) failedPairings.delete(ip)
    for (const [socket, peer] of peers) {
      if (peer.expiresAt <= now) { fail(socket, 'Koppel dit apparaat opnieuw.', 'UNAUTHORIZED'); socket.close(4001, 'SESSION_EXPIRED'); continue }
      if (!peer.alive) { socket.terminate(); continue }
      peer.alive = false
      socket.ping()
    }
  }, 15_000)
  heartbeat.unref()

  let vite: { close(): Promise<void> } | undefined
  if (options.dev) {
    const { createServer: createViteServer } = await import('vite')
    const devServer = await createViteServer({
      server: {
        middlewareMode: true, hmr: { server },
        // Vite's root also contains the local library. Protect direct URLs, @fs,
        // and ?raw imports so development mode cannot bypass the authenticated API.
        fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', `${dataDir.replaceAll('\\', '/')}/**`] },
      },
      appType: 'spa',
    })
    vite = devServer
    app.use(devServer.middlewares)
  } else {
    const distDir = path.resolve(process.cwd(), 'dist')
    app.use(express.static(distDir))
    app.get('/{*path}', (_request, response) => {
      if (!existsSync(path.join(distDir, 'index.html'))) return response.status(503).send('Bouw de app eerst met npm run build, of start npm run dev.')
      response.sendFile(path.join(distDir, 'index.html'))
    })
  }
  app.use((error: Error, _request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) { next(error); return }
    if (error instanceof multer.MulterError) {
      response.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Een audiobestand mag maximaal 500 MB zijn.' : 'Upload maximaal 50 audiobestanden tegelijk.' })
      return
    }
    const clientError = error instanceof SyntaxError || error.message.startsWith('Kies een audiobestand')
    if (!clientError) console.error('Lokaal serververzoek mislukt:', error.message)
    response.status(clientError ? 400 : 500).json({ error: clientError ? error.message : 'Het verzoek is mislukt. Controleer of de lokale audiomap beschikbaar is.' })
  })

  return {
    app, server, wss,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port ?? 3000, options.host ?? '0.0.0.0', () => { server.off('error', reject); resolve() })
      })
      const address = server.address() as AddressInfo
      return { port: address.port, url: `http://localhost:${address.port}` }
    },
    async close() {
      clearInterval(heartbeat)
      for (const socket of wss.clients) socket.terminate()
      await vite?.close()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      if (server.listening) {
        await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections() })
      }
      await mutationQueue
    },
  }
}
