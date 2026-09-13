import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { request } from 'node:http'
import { WebSocket } from 'ws'
import { createAppServer } from '../server/app.js'
import { initialPlayback, type Playback, type ServerMessage, type Setup, type Track } from '../shared/protocol.js'

type Instance = Awaited<ReturnType<typeof createAppServer>>
let instance: Instance
let dataDir: string
let baseUrl: string
let setup: Setup
let controllerToken: string
const sockets: WebSocket[] = []

function jsonHeaders(token?: string) { return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
function headers(token: string) { return { Authorization: `Bearer ${token}` } }
function waitMessage(socket: WebSocket, predicate: (message: ServerMessage) => boolean) {
  return new Promise<ServerMessage>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for WebSocket message')) }, 2500)
    function onMessage(data: Buffer) {
      const message = JSON.parse(data.toString()) as ServerMessage
      if (predicate(message)) { cleanup(); resolve(message) }
    }
    function onClose() { cleanup(); reject(new Error('Socket closed while waiting for message')) }
    function cleanup() { clearTimeout(timer); socket.off('message', onMessage); socket.off('close', onClose) }
    socket.on('message', onMessage)
    socket.on('close', onClose)
  })
}
function connect(token: string, origin?: string) {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws?token=${token}`, origin ? { origin } : {})
  sockets.push(socket)
  return socket
}
async function openSocket(token: string) {
  const socket = connect(token)
  await waitMessage(socket, (message) => message.type === 'state')
  return socket
}
async function upload(name = 'Aankondiging.wav', bytes = Buffer.from('0123456789audio-data')) {
  const body = new FormData()
  body.append('files', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), name)
  const response = await fetch(`${baseUrl}/api/tracks`, { method: 'POST', headers: headers(setup.token), body })
  assert.equal(response.status, 201)
  const result = await response.json() as { tracks: Track[] }
  return result.tracks[0]!
}
async function report(player: WebSocket, playback: Partial<Playback> = {}) {
  const next = { ...initialPlayback, ready: true, ...playback }
  const state = waitMessage(player, (message) => message.type === 'state' && message.state.playback.ready === next.ready && message.state.playback.status === next.status)
  player.send(JSON.stringify({ type: 'playback', playback: next }))
  await state
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'play-server-test-'))
  instance = await createAppServer({ dataDir, port: 0, host: '127.0.0.1' })
  const { port } = await instance.listen()
  baseUrl = `http://127.0.0.1:${port}`
  setup = await (await fetch(`${baseUrl}/api/setup`)).json() as Setup
  const response = await fetch(`${baseUrl}/api/pair`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ pin: setup.pin }) })
  controllerToken = ((await response.json()) as { token: string }).token
})
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  await instance.close()
  // Every directory comes from mkdtemp under the fixed OS temporary directory.
  assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep))
  await rm(dataDir, { recursive: true, force: true })
})

test('API requires valid authentication and browser requests must use the local origin', async () => {
  assert.match(setup.pin, /^\d{6}$/)
  assert.equal((await fetch(`${baseUrl}/api/tracks`)).status, 401)
  assert.equal((await fetch(`${baseUrl}/api/tracks`, { headers: headers('invalid') })).status, 401)
  assert.equal((await fetch(`${baseUrl}/api/tracks`, { headers: headers(controllerToken) })).status, 200)
  assert.equal((await fetch(`${baseUrl}/api/tracks`, { headers: headers(setup.token) })).status, 200)
  assert.equal((await fetch(`${baseUrl}/api/pair`, { method: 'POST', headers: { ...jsonHeaders(), Origin: 'http://evil.test' }, body: JSON.stringify({ pin: setup.pin }) })).status, 403)
  assert.equal((await fetch(`${baseUrl}/api/setup`, { headers: { Origin: 'http://evil.test' } })).status, 403)
  const rebindingStatus = await new Promise<number | undefined>((resolve, reject) => {
    const outgoing = request(`${baseUrl}/api/setup`, { headers: { Host: 'evil.test' } }, (response) => { response.resume(); resolve(response.statusCode) })
    outgoing.on('error', reject)
    outgoing.end()
  })
  assert.equal(rebindingStatus, 403)
})

test('pairing rejects wrong codes and throttles repeated failures', async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/pair`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ pin: 'invalid' }) })
    assert.equal(response.status, 401)
  }
  const throttled = await fetch(`${baseUrl}/api/pair`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ pin: setup.pin }) })
  assert.equal(throttled.status, 429)
  assert.ok(Number(throttled.headers.get('Retry-After')) > 0)
})

test('unauthenticated and foreign-origin WebSockets cannot join', async () => {
  for (const [token, origin] of [['invalid', undefined], [controllerToken, 'http://evil.test']] as const) {
    const socket = connect(token, origin)
    const status = await new Promise<number | undefined>((resolve, reject) => {
      socket.on('unexpected-response', (_request, response) => { response.resume(); resolve(response.statusCode); socket.terminate() })
      socket.on('error', () => {})
      socket.on('open', () => reject(new Error('Unauthorized socket opened')))
    })
    assert.equal(status, 401)
  }
})

test('only one player owns output; controllers cannot forge playback', async () => {
  const player = await openSocket(setup.token)
  const controller = await openSocket(controllerToken)
  const secondPlayer = connect(setup.token)
  const closed = new Promise<number>((resolve) => secondPlayer.on('close', resolve))
  const busy = await waitMessage(secondPlayer, (message) => message.type === 'error')
  assert.equal(busy.type === 'error' && busy.code, 'PLAYER_BUSY')
  assert.equal(await closed, 4009)
  const rejected = waitMessage(controller, (message) => message.type === 'error')
  controller.send(JSON.stringify({ type: 'playback', playback: { ...initialPlayback, ready: true } }))
  assert.equal((await rejected as { code: string }).code, 'UNAUTHORIZED')
  await report(player)
  const incoming = waitMessage(player, (message) => message.type === 'command')
  controller.send(JSON.stringify({ type: 'command', command: { action: 'volume', value: 0.42 } }))
  const command = await incoming
  assert.deepEqual(command.type === 'command' && command.command, { action: 'volume', value: 0.42 })
})

test('ready state gates commands, telemetry is validated, and disconnected commands are never replayed', async () => {
  const track = await upload()
  const controller = await openSocket(controllerToken)
  const offline = waitMessage(controller, (message) => message.type === 'error')
  controller.send(JSON.stringify({ type: 'command', command: { action: 'select', trackId: track.id } }))
  assert.equal((await offline as { code: string }).code, 'PLAYER_NOT_READY')
  const player = await openSocket(setup.token)
  await report(player)
  const commandPromise = waitMessage(player, (message) => message.type === 'command')
  controller.send(JSON.stringify({ type: 'command', command: { action: 'select', trackId: track.id } }))
  const command = await commandPromise
  assert.deepEqual(command.type === 'command' && command.command, { action: 'select', trackId: track.id })
  assert.equal((await fetch(`${baseUrl}/api/tracks/${track.id}`, { method: 'DELETE', headers: headers(setup.token) })).status, 409)
  await report(player, { trackId: track.id, status: 'playing', currentTime: 2, duration: 20, volume: 0.5 })
  for (const invalidCommand of [{ action: 'volume', value: 2 }, { action: 'seek', value: 21 }, { action: 'select', trackId: 'missing' }]) {
    const error = waitMessage(controller, (message) => message.type === 'error')
    controller.send(JSON.stringify({ type: 'command', command: invalidCommand }))
    assert.equal((await error as { code: string }).code, 'INVALID_COMMAND')
  }
  const invalidTelemetry = waitMessage(player, (message) => message.type === 'error')
  player.send(JSON.stringify({ type: 'playback', playback: { ...initialPlayback, volume: -1 } }))
  assert.equal((await invalidTelemetry as { code: string }).code, 'INVALID_PLAYBACK')
  const offlineState = waitMessage(controller, (message) => message.type === 'state' && !message.state.playerOnline)
  player.close()
  const state = await offlineState
  assert.equal(state.type === 'state' && state.state.playback.ready, false)
  assert.equal(state.type === 'state' && state.state.playback.status, 'stopped')
  const rejected = waitMessage(controller, (message) => message.type === 'error')
  controller.send(JSON.stringify({ type: 'command', command: { action: 'play' } }))
  assert.equal((await rejected as { code: string }).code, 'PLAYER_NOT_READY')
  const replacement = connect(setup.token)
  const received: ServerMessage[] = []
  replacement.on('message', (data) => received.push(JSON.parse(data.toString()) as ServerMessage))
  await waitMessage(replacement, (message) => message.type === 'state')
  await report(replacement)
  const pong = waitMessage(replacement, (message) => message.type === 'pong')
  replacement.send(JSON.stringify({ type: 'ping' }))
  await pong
  assert.equal(received.some((message) => message.type === 'command'), false)
})

test('upload is local-player-only; audio supports byte ranges and stays on disk across restarts', async () => {
  const denied = new FormData()
  denied.append('files', new Blob(['sound']), 'sound.wav')
  assert.equal((await fetch(`${baseUrl}/api/tracks`, { method: 'POST', headers: headers(controllerToken), body: denied })).status, 403)
  const invalid = new FormData()
  invalid.append('files', new Blob(['html']), 'page.html')
  assert.equal((await fetch(`${baseUrl}/api/tracks`, { method: 'POST', headers: headers(setup.token), body: invalid })).status, 400)
  const track = await upload('Welkom & muziek.wav')
  assert.equal(track.name, 'Welkom & muziek')
  assert.equal((await fetch(`${baseUrl}/api/audio/${track.id}?token=${controllerToken}`)).status, 401)
  const partial = await fetch(`${baseUrl}/api/audio/${track.id}?token=${setup.token}`, { headers: { Range: 'bytes=2-5' } })
  assert.equal(partial.status, 206)
  assert.equal(partial.headers.get('Content-Range'), 'bytes 2-5/20')
  assert.equal(await partial.text(), '2345')
  const saved = JSON.parse(await readFile(path.join(dataDir, 'library.json'), 'utf8')) as Array<Track & { storedFilename: string }>
  assert.equal(saved.length, 1)
  assert.equal(await readFile(path.join(dataDir, 'audio', saved[0]!.storedFilename), 'utf8'), '0123456789audio-data')
  const oldPin = setup.pin
  await instance.close()
  instance = await createAppServer({ dataDir, port: 0, host: '127.0.0.1' })
  const { port } = await instance.listen()
  baseUrl = `http://127.0.0.1:${port}`
  setup = await (await fetch(`${baseUrl}/api/setup`)).json() as Setup
  assert.equal(setup.pin, oldPin)
  const tracks = await (await fetch(`${baseUrl}/api/tracks`, { headers: headers(setup.token) })).json() as Track[]
  assert.deepEqual(tracks, [track])
  assert.equal((await fetch(`${baseUrl}/api/tracks/${track.id}`, { method: 'DELETE', headers: headers(setup.token) })).status, 204)
  assert.deepEqual(await (await fetch(`${baseUrl}/api/tracks`, { headers: headers(setup.token) })).json(), [])
})

test('clearing the final selected track relays to the player and permits removal after acknowledgement', async () => {
  const track = await upload()
  const player = await openSocket(setup.token)
  await report(player, { trackId: track.id, status: 'stopped', duration: 20 })
  assert.equal((await fetch(`${baseUrl}/api/tracks/${track.id}`, { method: 'DELETE', headers: headers(setup.token) })).status, 409)
  const cleared = waitMessage(player, (message) => message.type === 'command')
  player.send(JSON.stringify({ type: 'command', command: { action: 'clear' } }))
  const command = await cleared
  assert.deepEqual(command.type === 'command' && command.command, { action: 'clear' })
  // Keep the selected file until the player confirms that the media is unloaded.
  assert.equal((await fetch(`${baseUrl}/api/tracks/${track.id}`, { method: 'DELETE', headers: headers(setup.token) })).status, 409)
  await report(player)
  assert.equal((await fetch(`${baseUrl}/api/tracks/${track.id}`, { method: 'DELETE', headers: headers(setup.token) })).status, 204)
  const emptyClear = waitMessage(player, (message) => message.type === 'command')
  player.send(JSON.stringify({ type: 'command', command: { action: 'clear' } }))
  assert.equal((await emptyClear).type, 'command')
})

test('development middleware cannot expose pairing settings, library metadata, or raw audio files', async () => {
  const privateDir = await mkdtemp(path.join(process.cwd(), 'data-private-test-'))
  const development = await createAppServer({ dataDir: privateDir, port: 0, host: '127.0.0.1', dev: true })
  try {
    const { port } = await development.listen()
    const devUrl = `http://127.0.0.1:${port}`
    const devSetup = await (await fetch(`${devUrl}/api/setup`)).json() as Setup
    const uploadForm = new FormData()
    uploadForm.append('files', new Blob(['private-audio-file']), 'secret.wav')
    assert.equal((await fetch(`${devUrl}/api/tracks`, { method: 'POST', headers: headers(devSetup.token), body: uploadForm })).status, 201)
    const saved = JSON.parse(await readFile(path.join(privateDir, 'library.json'), 'utf8')) as Array<{ storedFilename: string }>
    const relative = `/${path.basename(privateDir)}`
    const absolute = `/@fs/${privateDir.replaceAll('\\', '/')}`
    for (const url of [
      `${relative}/settings.json`, `${relative}/library.json`, `${relative}/audio/${saved[0]!.storedFilename}`,
      `${absolute}/settings.json`, `${relative}/settings.json?raw`, `${relative}/settings.json?import`,
    ]) {
      const response = await fetch(`${devUrl}${url}`)
      assert.equal(response.status, 403, `Private development URL must be blocked: ${url}`)
      assert.ok(!(await response.text()).includes(devSetup.pin))
    }
  } finally {
    await development.close()
    assert.equal(path.dirname(privateDir), process.cwd())
    assert.ok(path.basename(privateDir).startsWith('data-private-test-'))
    await rm(privateDir, { recursive: true, force: true })
  }
})
