import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { AudioEngine } from '../src/lib/audio-engine'
import type { Playback } from '../shared/protocol'

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = []
  src = ''
  preload = ''
  crossOrigin: string | null = null
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
    FakeAudio.instances.push(this)
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
  finish() {
    this.currentTime = this.duration
    this.ended = true
    this.paused = true
    this.dispatchEvent(new Event('pause'))
    this.dispatchEvent(new Event('ended'))
  }
}

class FakeContext extends EventTarget {
  static latest: FakeContext
  state = 'running'
  destination = {}
  gains: { gain: { value: number }, connect(): void, disconnect(): void }[] = []
  sources: FakeAudio[] = []
  get gain() { return this.gains[0] }
  resumeCalled = false
  constructor() {
    super()
    FakeContext.latest = this
  }
  createGain() {
    const gain = { gain: { value: 1 }, connect() {}, disconnect() {} }
    this.gains.push(gain)
    return gain
  }
  createMediaElementSource(audio: FakeAudio) {
    this.sources.push(audio)
    return { connect() {}, disconnect() {} }
  }
  resume() {
    this.resumeCalled = true
    return Promise.resolve()
  }
  close() { return Promise.resolve() }
}

function fixture(t: TestContext, getAudioUrl?: (id: string) => string) {
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalMediaError = Object.getOwnPropertyDescriptor(globalThis, 'MediaError')
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: FakeAudio })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: FakeContext } })
  Object.defineProperty(globalThis, 'MediaError', { configurable: true, value: { MEDIA_ERR_NETWORK: 2 } })
  FakeAudio.instances = []
  const updates: Playback[] = []
  const engine = new AudioEngine({ token: 'test token', getAudioUrl, onPlayback: (value) => updates.push(value) })
  t.after(() => {
    engine.destroy()
    for (const [key, descriptor] of [['Audio', originalAudio], ['window', originalWindow], ['MediaError', originalMediaError]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  return { engine, audio: FakeAudio.instances[0], effect: FakeAudio.instances[1], updates }
}

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('activation unlocks synchronously with silence and never plays the selected fragment', async (t) => {
  const { engine, audio, effect } = fixture(t)
  await engine.execute({ action: 'select', trackId: 'track-one' })
  const activation = engine.enable()
  assert.equal(FakeContext.latest.resumeCalled, true)
  assert.equal(audio.plays.length, 1)
  assert.match(audio.plays[0], /^data:audio\/wav;base64,/)
  assert.equal(effect.plays.length, 1)
  assert.match(effect.plays[0], /^data:audio\/wav;base64,/)
  assert.deepEqual(FakeContext.latest.sources, [audio, effect])
  await activation
  assert.equal(engine.playback.ready, true)
  assert.equal(audio.paused, true)
  assert.equal(audio.src, '/api/audio/track-one?token=test%20token')
  assert.equal(audio.plays.length, 1)
  assert.equal(effect.paused, true)
  assert.equal(effect.src, '')
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

test('partial activation failure stops both elements even when the other play settles late', async (t) => {
  const { engine, audio, effect } = fixture(t)
  await engine.execute({ action: 'select', trackId: 'song' })
  const pending = deferred()
  audio.nextPlay = pending.promise
  effect.nextPlay = Promise.reject(new DOMException('gesture required', 'NotAllowedError'))
  await engine.enable()
  assert.equal(engine.playback.ready, false)
  assert.equal(audio.paused, true)
  assert.equal(effect.paused, true)
  audio.paused = false
  pending.resolve()
  await Promise.resolve()
  assert.equal(audio.paused, true)
  assert.equal(engine.playback.status, 'error')
  await engine.enable()
  assert.equal(engine.playback.ready, true)
  assert.equal(audio.paused, true)
  assert.equal(effect.paused, true)
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

test('pause preserves the position, restart resets it, and natural end without a queue never advances', async (t) => {
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
    queue: [], effectTrackId: null, effectStatus: 'idle', effectVolume: 0.75, effectError: null,
  })
})

test('queued songs advance at natural end, preserving order without wrapping', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'queue-add', trackId: 'one' })
  await engine.execute({ action: 'queue-add', trackId: 'two' })
  await engine.execute({ action: 'queue-add', trackId: 'one' })
  assert.deepEqual(engine.playback.queue, ['one', 'two'])
  assert.equal(engine.playback.trackId, 'one')
  audio.loaded()
  await engine.execute({ action: 'play' })
  audio.finish()
  await Promise.resolve()
  assert.equal(engine.playback.trackId, 'two')
  assert.equal(engine.playback.status, 'playing')
  assert.match(audio.src, /\/two\?/)
  audio.loaded()
  audio.finish()
  await Promise.resolve()
  assert.equal(engine.playback.trackId, 'two')
  assert.equal(engine.playback.status, 'ended')
  assert.equal(audio.paused, true)
  assert.equal(audio.plays.length, 3)
})

test('removing the playing song keeps it playing and cannot advance to an unrelated queue entry', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.enable()
  for (const trackId of ['one', 'two', 'three']) await engine.execute({ action: 'queue-add', trackId })
  audio.loaded()
  await engine.execute({ action: 'play' })
  await engine.execute({ action: 'queue-remove', trackId: 'one' })
  assert.deepEqual(engine.playback.queue, ['two', 'three'])
  assert.equal(engine.playback.trackId, 'one')
  assert.equal(audio.paused, false)
  audio.finish()
  await Promise.resolve()
  assert.equal(engine.playback.trackId, 'one')
  assert.equal(engine.playback.status, 'ended')
  assert.equal(audio.plays.length, 2)
})

test('next and previous preserve paused or playing intent and select preserves the queue', async (t) => {
  const { engine, audio } = fixture(t)
  await engine.enable()
  for (const trackId of ['one', 'two', 'three']) await engine.execute({ action: 'queue-add', trackId })
  audio.loaded()
  await engine.execute({ action: 'play' })
  await engine.execute({ action: 'pause' })
  const playCount = audio.plays.length
  await engine.execute({ action: 'next' })
  audio.loaded()
  assert.equal(engine.playback.trackId, 'two')
  assert.equal(engine.playback.status, 'paused')
  assert.equal(audio.plays.length, playCount)
  assert.equal(audio.paused, true)
  await engine.execute({ action: 'previous' })
  audio.loaded()
  assert.equal(engine.playback.trackId, 'one')
  assert.equal(engine.playback.status, 'paused')
  await engine.execute({ action: 'play' })
  await engine.execute({ action: 'next' })
  assert.equal(engine.playback.trackId, 'two')
  assert.equal(engine.playback.status, 'playing')
  await engine.execute({ action: 'stop' })
  await engine.execute({ action: 'next' })
  audio.loaded()
  assert.equal(engine.playback.trackId, 'three')
  assert.equal(engine.playback.status, 'stopped')
  await engine.execute({ action: 'select', trackId: 'outside' })
  assert.deepEqual(engine.playback.queue, ['one', 'two', 'three'])
})

test('clearing the queue leaves both channels playing and prevents automatic advancement', async (t) => {
  const { engine, audio, effect } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'queue-add', trackId: 'one' })
  await engine.execute({ action: 'queue-add', trackId: 'two' })
  audio.loaded()
  await engine.execute({ action: 'play' })
  await engine.execute({ action: 'effect-play', trackId: 'applause' })
  await engine.execute({ action: 'queue-clear' })
  assert.deepEqual(engine.playback.queue, [])
  assert.equal(engine.playback.trackId, 'one')
  assert.equal(audio.paused, false)
  assert.equal(effect.paused, false)
  audio.finish()
  await Promise.resolve()
  assert.equal(engine.playback.trackId, 'one')
  assert.equal(engine.playback.status, 'ended')
  assert.equal(engine.playback.effectStatus, 'playing')
})

test('effects play independently, retrigger from the beginning, and use a separate volume', async (t) => {
  const { engine, audio, effect } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'select', trackId: 'song' })
  audio.loaded()
  await engine.execute({ action: 'play' })
  audio.currentTime = 30
  const musicPlays = audio.plays.length
  await engine.execute({ action: 'effect-play', trackId: 'applause' })
  effect.loaded(5)
  effect.currentTime = 2
  await engine.execute({ action: 'effect-play', trackId: 'applause' })
  assert.equal(effect.currentTime, 0)
  await engine.execute({ action: 'effect-play', trackId: 'bell' })
  assert.match(effect.src, /\/bell\?/)
  assert.equal(engine.playback.effectTrackId, 'bell')
  await engine.execute({ action: 'volume', value: 0.3 })
  await engine.execute({ action: 'effect-volume', value: 0.9 })
  assert.equal(FakeContext.latest.gains[0].gain.value, 0.3)
  assert.equal(FakeContext.latest.gains[1].gain.value, 0.9)
  assert.equal(engine.playback.status, 'playing')
  assert.equal(engine.playback.currentTime, 30)
  assert.equal(audio.plays.length, musicPlays)
  assert.equal(audio.paused, false)
  await engine.execute({ action: 'effect-stop' })
  assert.equal(effect.paused, true)
  assert.equal(effect.src, '')
  assert.equal(engine.playback.effectTrackId, null)
  assert.equal(engine.playback.effectStatus, 'idle')
  assert.equal(audio.paused, false)
})

test('a failed effect cannot change music playback or its error and another effect recovers', async (t) => {
  const { engine, audio, effect } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'select', trackId: 'song' })
  audio.loaded()
  await engine.execute({ action: 'play' })
  effect.nextPlay = Promise.reject(new DOMException('gesture required', 'NotAllowedError'))
  await engine.execute({ action: 'effect-play', trackId: 'bad' })
  assert.equal(engine.playback.status, 'playing')
  assert.equal(engine.playback.error, null)
  assert.equal(engine.playback.ready, true)
  assert.equal(engine.playback.effectStatus, 'error')
  assert.match(engine.playback.effectError!, /blokkeert/)
  assert.equal(audio.paused, false)
  await engine.execute({ action: 'effect-play', trackId: 'good' })
  assert.equal(engine.playback.effectStatus, 'playing')
  assert.equal(engine.playback.effectError, null)
  effect.error = { code: 2 }
  effect.dispatchEvent(new Event('error'))
  assert.equal(engine.playback.effectStatus, 'error')
  assert.equal(engine.playback.status, 'playing')
  assert.equal(engine.playback.error, null)
  assert.equal(audio.paused, false)
})

test('stopping effects cancels late play completion without interrupting music', async (t) => {
  const { engine, audio, effect } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'select', trackId: 'song' })
  audio.loaded()
  await engine.execute({ action: 'play' })
  const pending = deferred()
  effect.nextPlay = pending.promise
  const playing = engine.execute({ action: 'effect-play', trackId: 'bell' })
  await engine.execute({ action: 'effect-stop' })
  effect.paused = false
  pending.resolve()
  await playing
  assert.equal(effect.paused, true)
  assert.equal(engine.playback.effectTrackId, null)
  assert.equal(engine.playback.effectStatus, 'idle')
  assert.equal(engine.playback.status, 'playing')
  assert.equal(audio.paused, false)
})

test('a stale rejected effect cannot override a newer effect', async (t) => {
  const { engine, effect } = fixture(t)
  await engine.enable()
  const pending = deferred()
  effect.nextPlay = pending.promise
  const first = engine.execute({ action: 'effect-play', trackId: 'one' })
  await engine.execute({ action: 'effect-play', trackId: 'two' })
  pending.reject(new DOMException('interrupted', 'AbortError'))
  await first
  assert.equal(engine.playback.effectTrackId, 'two')
  assert.equal(engine.playback.effectStatus, 'playing')
  assert.equal(engine.playback.effectError, null)
  assert.equal(effect.paused, false)
})

test('emergency stop and output interruption stop both music and effects', async (t) => {
  const { engine, audio, effect } = fixture(t)
  await engine.enable()
  await engine.execute({ action: 'select', trackId: 'song' })
  audio.loaded()
  await engine.execute({ action: 'play' })
  await engine.execute({ action: 'effect-play', trackId: 'bell' })
  await engine.execute({ action: 'stop' })
  assert.equal(audio.paused, true)
  assert.equal(effect.paused, true)
  assert.equal(engine.playback.status, 'stopped')
  assert.equal(engine.playback.effectTrackId, null)
  await engine.execute({ action: 'play' })
  await engine.execute({ action: 'effect-play', trackId: 'bell' })
  FakeContext.latest.state = 'suspended'
  FakeContext.latest.dispatchEvent(new Event('statechange'))
  assert.equal(audio.paused, true)
  assert.equal(effect.paused, true)
  assert.equal(engine.playback.ready, false)
  assert.equal(engine.playback.effectTrackId, null)
  assert.match(engine.playback.error!, /onderbroken/)
})

test('disconnect cancels a late effect promise and destroy ignores further commands', async (t) => {
  const { engine, effect } = fixture(t)
  await engine.enable()
  const pending = deferred()
  effect.nextPlay = pending.promise
  const playing = engine.execute({ action: 'effect-play', trackId: 'bell' })
  engine.disconnect()
  effect.paused = false
  pending.resolve()
  await playing
  assert.equal(effect.paused, true)
  assert.equal(engine.playback.effectTrackId, null)
  assert.equal(engine.playback.ready, false)
  engine.destroy()
  const plays = effect.plays.length
  await engine.execute({ action: 'effect-play', trackId: 'bell' })
  assert.equal(effect.plays.length, plays)
})

test('playback snapshots cannot mutate the internal queue', async (t) => {
  const { engine } = fixture(t)
  await engine.execute({ action: 'queue-add', trackId: 'one' })
  engine.playback.queue.push('injected')
  assert.deepEqual(engine.getSnapshot().queue, ['one'])
})

test('cloud media uses CORS on both channels and restores a session without autoplay', async (t) => {
  const { engine, audio, effect } = fixture(t, id => `https://storage.example/${id}`)
  const saved = { ...engine.playback, trackId: 'one', queue: ['one', 'two'], currentTime: 17, volume: 0.3, effectVolume: 0.6, ready: true, status: 'playing' as const }
  engine.restore(saved)
  assert.equal(audio.crossOrigin, 'anonymous')
  assert.equal(effect.crossOrigin, 'anonymous')
  assert.equal(audio.src, 'https://storage.example/one')
  assert.equal(audio.plays.length, 0)
  assert.equal(engine.playback.ready, false)
  assert.deepEqual(engine.playback.queue, ['one', 'two'])
  await engine.enable()
  audio.loaded()
  assert.equal(audio.currentTime, 17)
  assert.equal(audio.paused, true)
  assert.equal(FakeContext.latest.gains[0].gain.value, 0.3)
  assert.equal(FakeContext.latest.gains[1].gain.value, 0.6)
  await engine.execute({ action: 'effect-play', trackId: 'bell' })
  assert.equal(effect.src, 'https://storage.example/bell')
  assert.equal(audio.paused, true)
})
