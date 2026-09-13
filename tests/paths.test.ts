import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WebSocket } from 'ws'
import { normalizeBasePath, stripBasePath, withBasePath } from '../shared/paths.js'
import { createAppServer } from '../server/app.js'
import type { ServerMessage, Setup, Track } from '../shared/protocol.js'

test('base paths keep routes inside the configured app and reject ambiguous prefixes', () => {
  assert.equal(normalizeBasePath(), '/')
  assert.equal(normalizeBasePath(' /play-audio/ '), '/play-audio/')
  assert.equal(withBasePath('/play-audio', '/api/tracks?kind=effect'), '/play-audio/api/tracks?kind=effect')
  assert.equal(stripBasePath('/play-audio', '/play-audio/player/'), '/player')
  assert.equal(stripBasePath('/play-audio', '/play-audio'), '/')
  assert.equal(stripBasePath('/play-audio', '/play-audio-other/player'), null)
  assert.equal(stripBasePath('/play-audio', '/player'), null)
  for (const invalid of ['https://example.com/play', '/play/../admin', '/play?admin', '/play//audio', '/play%2faudio']) {
    assert.throws(() => normalizeBasePath(invalid), /APP_BASE_PATH/)
  }
})

test('a prefixed server pairs, uploads, streams audio and accepts WebSockets below /play-audio', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'play-path-test-'))
  const instance = await createAppServer({ dataDir, port: 0, host: '127.0.0.1', basePath: '/play-audio' })
  let socket: WebSocket | undefined
  try {
    const { port, url } = await instance.listen()
    assert.equal(url, `http://localhost:${port}/play-audio`)
    const origin = `http://127.0.0.1:${port}`
    const baseUrl = `${origin}/play-audio`
    const redirect = await fetch(`${baseUrl}?source=local`, { redirect: 'manual' })
    assert.equal(redirect.status, 308)
    assert.equal(redirect.headers.get('location'), '/play-audio/?source=local')
    const appRoot = await fetch(`${baseUrl}/?source=local`, { redirect: 'manual' })
    assert.equal(appRoot.headers.get('location'), null, 'The canonical app root must not redirect to itself.')
    assert.equal((await fetch(`${origin}/api/setup`)).status, 404)
    assert.equal((await fetch(`${origin}/play-audio-other/api/setup`)).status, 404)
    const setupResponse = await fetch(`${baseUrl}/api/setup`)
    assert.equal(setupResponse.status, 200)
    const setup = await setupResponse.json() as Setup
    assert.ok(setup.urls.every((value) => new URL(value).pathname === '/play-audio/control'))
    assert.equal((await fetch(`${baseUrl}/api/tracks`)).status, 401)
    const pairing = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ pin: setup.pin }),
    })
    assert.equal(pairing.status, 200)
    const { token } = await pairing.json() as { token: string }
    const form = new FormData()
    form.append('files', new Blob(['prefix-audio-test']), 'Prefix.wav')
    const uploaded = await fetch(`${baseUrl}/api/tracks`, {
      method: 'POST', headers: { Authorization: `Bearer ${setup.token}` }, body: form,
    })
    assert.equal(uploaded.status, 201)
    const { tracks } = await uploaded.json() as { tracks: Track[] }
    const audio = await fetch(`${baseUrl}/api/audio/${tracks[0]!.id}?token=${encodeURIComponent(setup.token)}`, { headers: { Range: 'bytes=0-5' } })
    assert.equal(audio.status, 206)
    assert.equal(await audio.text(), 'prefix')
    socket = new WebSocket(`${baseUrl.replace('http:', 'ws:')}/ws?token=${encodeURIComponent(token)}`, { origin })
    const message = await new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Prefixed WebSocket did not connect.')), 3000)
      socket!.once('message', (raw) => { clearTimeout(timer); resolve(JSON.parse(raw.toString()) as ServerMessage) })
      socket!.once('error', (error) => { clearTimeout(timer); reject(error) })
    })
    assert.equal(message.type, 'state')
    if (message.type === 'state') assert.equal(message.state.tracks[0]?.id, tracks[0]!.id)
  } finally {
    socket?.terminate()
    await instance.close()
    assert.equal(path.dirname(dataDir), tmpdir())
    assert.ok(path.basename(dataDir).startsWith('play-path-test-'))
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('prefixed development pages serve the favicon and source modules at their rendered URLs', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'play-path-dev-test-'))
  const instance = await createAppServer({ dataDir, port: 0, host: '127.0.0.1', basePath: '/play-audio', dev: true })
  try {
    const { port } = await instance.listen()
    const origin = `http://127.0.0.1:${port}`
    const response = await fetch(`${origin}/play-audio/player`, { redirect: 'manual' })
    assert.equal(response.status, 200)
    const html = await response.text()
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]!)
    assert.ok(assets.includes('/play-audio/favicon.svg'))
    assert.ok(assets.includes('/play-audio/src/main.tsx'))
    for (const assetUrl of assets) {
      assert.ok(assetUrl.startsWith('/play-audio/'), assetUrl)
      const asset = await fetch(`${origin}${assetUrl}`)
      assert.equal(asset.status, 200, assetUrl)
      assert.ok(!(await asset.text()).includes('<!doctype html>'), `${assetUrl} returned the fallback page`)
    }
  } finally {
    await instance.close()
    assert.equal(path.dirname(dataDir), tmpdir())
    assert.ok(path.basename(dataDir).startsWith('play-path-dev-test-'))
    await rm(dataDir, { recursive: true, force: true })
  }
})
