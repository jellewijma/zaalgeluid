import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { AudioEngine } from '../src/lib/audio-engine'
import type { Playback } from '../shared/protocol'

class FakeAudio extends EventTarget {
  static latest: FakeAudio
  src = ''
  preload = ''
  currentTime = 0
  duration = Number.NaN
  paused = true
  ended = false
  readyState = 0
  volume = 1
  error: { code: number } | null = null
  plays: string[] = []
  nextPlay: Promise<void> | null = null
  constructor() {
    super()
    FakeAudio.latest = this
  }
  setAttribute() {}
  removeAttribute() { this.src = '' }
  load() {
    this.currentTime = 0
    this.duration = Number.NaN
    this.readyState = 0
    this.ended = false
    this.error = null
  }
  play() {
    this.plays.push(this.src)
    this.paused = false
    const result = this.nextPlay || Promise.resolve()
    this.nextPlay = null
    return result
  }
  pause() { this.paused = true }
  loaded(duration = 120) {
    this.duration = duration
    this.readyState = 4
    this.dispatchEvent(new Event('loadedmetadata'))
    this.dispatchEvent(new Event('canplay'))
  }
}

class FakeContext extends EventTarget {
  static latest: FakeContext
  state = 'running'
  destination = {}
  gain = { gain: { value: 1 }, connect() {}, disconnect() {} }
  resumeCalled = false
  constructor() {
    super()
    FakeContext.latest = this
  }
  createGain() { return this.gain }
  createMediaElementSource() { return { connect() {}, disconnect() {} } }
  resume() {
    this.resumeCalled = true
    return Promise.resolve()
  }
  close() { return Promise.resolve() }
}

function fixture(t: TestContext) {
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalMediaError = Object.getOwnPropertyDescriptor(globalThis, 'MediaError')
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: FakeAudio })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: FakeContext } })
  Object.defineProperty(globalThis, 'MediaError', { configurable: true, value: { MEDIA_ERR_NETWORK: 2 } })
  const updates: Playback[] = []
  const engine = new AudioEngine({ token: 'test token', onPlayback: (value) => updates.push(value) })
  t.after(() => {
    engine.destroy()
    for (const [key, descriptor] of [['Audio', originalAudio], ['window', originalWindow], ['MediaError', originalMediaError]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  return { engine, audio: FakeAudio.latest, updates }
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('activation unlocks synchronously with silence and never plays the selected fragment', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.execute({ action: 'select', trackId: 'track-one' })
  const activation = engine.enable()
  assert.equal(FakeContext.latest.resumeCalled, true)
  assert.equal(audio.plays.length, 1)
  assert.match(audio.plays[0], /^data:audio\/wav;base64,/)
  await activation
  assert.equal(engine.playback.ready, true)
  assert.equal(audio.paused, true)
  assert.equal(audio.src, '/api/audio/track-one?token=test%20token')
  assert.equal(audio.plays.length, 1)
})

test('empty-library activation is supported and volume uses the gain node', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.enable()
  assert.equal(engine.playback.ready, true)
  assert.equal(engine.playback.status, 'idle')
  await engine.execute({ action: 'volume', value: 0.2 })
  assert.equal(FakeContext.latest.gain.gain.value, 0.2)
  assert.equal(audio.volume, 1)
  await engine.execute({ action: 'volume', value: 5 })
  assert.equal(FakeContext.latest.gain.gain.value, 1)
  await engine.execute({ action: 'volume', value: Number.NaN })
  assert.equal(engine.playback.volume, 1)
})

test('stop wins over a pending play promise and a later play resumes explicitly', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'select', trackId: 'one' })
  audio.loaded()
  const pending = deferred()
  audio.nextPlay = pending.promise
  const playing = engine.execute({ action: 'play' })
  audio.currentTime = 12
  await engine.execute({ action: 'stop' })
  pending.resolve()
  await playing
  assert.equal(audio.paused, true)
  assert.equal(audio.currentTime, 0)
  assert.equal(engine.playback.status, 'stopped')
  await engine.execute({ action: 'play' })
  assert.equal(engine.playback.status, 'playing')
})

test('a rejected stale play cannot overwrite a newer selected or playing track', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'select', trackId: 'one' })
  audio.loaded()
  const pending = deferred()
  audio.nextPlay = pending.promise
  const oldPlay = engine.execute({ action: 'restart' })
  await engine.execute({ action: 'select', trackId: 'two' })
  audio.loaded()
  await engine.execute({ action: 'play' })
  pending.reject(new DOMException('interrupted', 'AbortError'))
  await oldPlay
  assert.equal(engine.playback.trackId, 'two')
  assert.equal(engine.playback.status, 'playing')
  assert.equal(engine.playback.error, null)
  assert.equal(audio.paused, false)
})

test('pause preserves the position, restart resets it, and natural end never advances', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'select', trackId: 'one' })
  audio.loaded()
  await engine.execute({ action: 'play' })
  audio.currentTime = 42
  await engine.execute({ action: 'pause' })
  assert.equal(engine.playback.currentTime, 42)
  await engine.execute({ action: 'restart' })
  assert.equal(engine.playback.currentTime, 0)
  audio.currentTime = 120
  audio.ended = true
  audio.paused = true
  audio.dispatchEvent(new Event('ended'))
  assert.equal(engine.playback.status, 'ended')
  assert.equal(engine.playback.trackId, 'one')
  assert.equal(audio.plays.length, 3)
})

test('seek before metadata is applied once the duration is known and is clamped', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.execute({ action: 'select', trackId: 'one' })
  await engine.execute({ action: 'seek', value: 500 })
  audio.loaded(100)
  assert.equal(engine.playback.currentTime, 100)
  await engine.execute({ action: 'seek', value: -50 })
  assert.equal(engine.playback.currentTime, 0)
})

test('disconnect stops audio and requires reactivation, including during activation', async (t) => {
  const { engine, audio } = fixture(t)
  const pending = deferred()
  audio.nextPlay = pending.promise
  const activation = engine.enable()
  engine.disconnect()
  pending.resolve()
  await activation
  assert.equal(engine.playback.ready, false)
  assert.equal(audio.paused, true)
  await engine.enable()
  await engine.execute({ action: 'select', trackId: 'one' })
  audio.loaded()
  await engine.execute({ action: 'play' })
  engine.disconnect()
  const playCount = audio.plays.length
  await engine.execute({ action: 'play' })
  assert.equal(audio.plays.length, playCount)
  assert.equal(audio.paused, true)
  assert.equal(engine.playback.ready, false)
})

test('autoplay rejection is visible and clears readiness', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'select', trackId: 'one' })
  audio.loaded()
  audio.nextPlay = Promise.reject(new DOMException('gesture required', 'NotAllowedError'))
  await engine.execute({ action: 'play' })
  assert.equal(engine.playback.ready, false)
  assert.equal(engine.playback.status, 'error')
  assert.match(engine.playback.error!, /Audio activeren/)
  assert.equal(audio.paused, true)
})

test('clearing a selected fragment stops audio, empties the source, and preserves activation and volume', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'volume', value: 0.4 })
  await engine.execute({ action: 'select', trackId: 'one' })
  audio.loaded()
  await engine.execute({ action: 'play' })
  audio.currentTime = 10
  await engine.execute({ action: 'clear' })
  assert.equal(audio.paused, true)
  assert.equal(audio.src, '')
  assert.deepEqual(engine.playback, {
    trackId: null, currentTime: 0, duration: 0, status: 'idle', error: null,
    ready: true, volume: 0.4,
  })
})
