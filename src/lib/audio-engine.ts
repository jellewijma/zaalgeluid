import { initialPlayback, type Command, type Playback } from '../../shared/protocol'
import { appPath } from './paths'

type Options = {
  token: string
  getAudioUrl?: (trackId: string) => string
  onPlayback: (playback: Playback) => void
}

const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0

// A short PCM WAV unlocks both media elements used for music and sound effects.
// No selected fragment is ever audible when the user activates the player.
function silentWav(): string {
  const bytes = new Uint8Array(44 + 160)
  const view = new DataView(bytes.buffer)
  const write = (offset: number, text: string) => {
    [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
  }
  write(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  write(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 16000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, bytes.length - 44, true)
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`
}

export class AudioEngine {
  private readonly audio = new Audio()
  private readonly effectAudio = new Audio()
  private readonly options: Options
  private state: Playback = { ...initialPlayback, queue: [] }
  private context: AudioContext | null = null
  private gain: GainNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private effectGain: GainNode | null = null
  private effectSource: MediaElementAudioSourceNode | null = null
  private wantsPlay = false
  private wantsEffect = false
  private transportVersion = 0
  private effectVersion = 0
  private activationVersion = 0
  private activating = false
  private activationPromise: Promise<void> | null = null
  private pendingSeek: number | null = null
  private destroyed = false
  private readonly timer: ReturnType<typeof setInterval>
  private readonly events = ['playing', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'timeupdate', 'canplay', 'waiting', 'error'] as const

  constructor(options: Options) {
    this.options = options
    if (options.getAudioUrl) {
      this.audio.crossOrigin = 'anonymous'
      this.effectAudio.crossOrigin = 'anonymous'
    }
    this.audio.preload = 'auto'
    this.audio.setAttribute('playsinline', '')
    for (const event of this.events) this.audio.addEventListener(event, this.onMediaEvent)
    this.effectAudio.preload = 'auto'
    this.effectAudio.setAttribute('playsinline', '')
    for (const event of this.events) this.effectAudio.addEventListener(event, this.onEffectEvent)
    this.timer = setInterval(() => {
      if (this.wantsPlay && !this.activating) this.publish()
    }, 250)
  }

  get playback(): Playback {
    return { ...this.state, queue: [...this.state.queue] }
  }

  getSnapshot(): Playback {
    return this.playback
  }

  /** Restore a saved session on another PC without starting either channel. */
  restore(playback: Playback): void {
    this.disconnect()
    this.state = {
      ...playback,
      queue: [...playback.queue],
      ready: false,
      status: playback.trackId ? 'paused' : 'idle',
      error: null,
      effectTrackId: null,
      effectStatus: 'idle',
      effectError: null,
    }
    this.pendingSeek = playback.currentTime
    this.loadSelectedTrack()
  }

  /** Call directly in the click handler: both resume() and play() run before any await. */
  enable(): Promise<void> {
    if (this.destroyed || this.state.ready) return Promise.resolve()
    if (this.activationPromise) return this.activationPromise

    const version = ++this.activationVersion
    this.transportVersion++
    this.effectVersion++
    this.wantsPlay = false
    this.wantsEffect = false
    this.activating = true
    this.audio.pause()
    this.effectAudio.pause()
    const previousTime = this.pendingSeek ?? this.state.currentTime
    this.pendingSeek = previousTime
    this.state.error = null
    this.state.effectError = null
    this.state.effectTrackId = null
    this.state.effectStatus = 'idle'
    this.state.status = this.state.trackId ? 'loading' : 'idle'
    this.publish()

    let activation: Promise<unknown>
    try {
      if (!this.context) {
        const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AudioContextConstructor) throw new Error('AudioContextUnavailable')
        this.context = new AudioContextConstructor()
        this.gain = this.context.createGain()
        this.source = this.context.createMediaElementSource(this.audio)
        this.source.connect(this.gain)
        this.gain.connect(this.context.destination)
        this.effectGain = this.context.createGain()
        this.effectSource = this.context.createMediaElementSource(this.effectAudio)
        this.effectSource.connect(this.effectGain)
        this.effectGain.connect(this.context.destination)
        this.context.addEventListener('statechange', this.onContextStateChange)
      }
      this.gain!.gain.value = this.state.volume
      this.effectGain!.gain.value = this.state.effectVolume
      const resumed = this.context.resume()
      this.audio.src = silentWav()
      this.audio.load()
      this.effectAudio.src = silentWav()
      this.effectAudio.load()
      const played = this.audio.play()
      const effectPlayed = this.effectAudio.play()
      // One channel can reject before the other's play() settles. Its late
      // completion must not revive output after activation failed or disconnected.
      activation = Promise.all([
        resumed,
        played.then(() => {
          if (!this.activating && (!this.wantsPlay || !this.state.ready)) this.audio.pause()
        }),
        effectPlayed.then(() => {
          if (!this.activating && (!this.wantsEffect || !this.state.ready)) this.effectAudio.pause()
        }),
      ])
    } catch (error) {
      activation = Promise.reject(error)
    }

    let timeout: ReturnType<typeof setTimeout>
    const limit = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('ActivationTimeout')), 8000)
    })
    const operation = Promise.race([activation, limit]).then(() => {
      if (this.destroyed || version !== this.activationVersion) {
        if (!this.wantsPlay || !this.state.ready) this.audio.pause()
        if (!this.wantsEffect || !this.state.ready) this.effectAudio.pause()
        return
      }
      this.audio.pause()
      this.clearEffectSource()
      this.activating = false
      this.state.ready = this.context?.state === 'running'
      if (!this.state.ready) throw new Error('ActivationTimeout')
      this.state.error = null
      this.loadSelectedTrack()
    }).catch((error: unknown) => {
      if (this.destroyed || version !== this.activationVersion) return
      this.audio.pause()
      this.clearEffectSource()
      this.activating = false
      this.state.ready = false
      this.loadSelectedTrack()
      this.state.error = error instanceof Error && error.message === 'AudioContextUnavailable'
        ? 'Deze browser ondersteunt de audio-afspeler niet. Gebruik een recente versie van Chrome, Edge of Safari.'
        : 'De browser heeft audio nog niet vrijgegeven. Klik op deze pc opnieuw op Audio activeren.'
      this.state.status = 'error'
      this.publish()
    }).finally(() => {
      clearTimeout(timeout)
      if (version === this.activationVersion) this.activationPromise = null
    })
    this.activationPromise = operation
    return operation
  }

  async execute(command: Command): Promise<void> {
    if (this.destroyed) return
    switch (command.action) {
      case 'queue-add': {
        if (!this.state.queue.includes(command.trackId) && this.state.queue.length < 200) {
          this.state.queue = [...this.state.queue, command.trackId]
        }
        if (!this.state.trackId && this.state.queue.length) this.selectTrack(this.state.queue[0])
        else this.publish()
        return
      }
      case 'queue-remove':
        this.state.queue = this.state.queue.filter((id) => id !== command.trackId)
        this.publish()
        return
      case 'queue-clear':
        this.state.queue = []
        this.publish()
        return
      case 'next':
      case 'previous':
        await this.advance(command.action === 'next' ? 1 : -1)
        return
      case 'effect-play':
        await this.playEffect(command.trackId)
        return
      case 'effect-stop':
        this.stopEffect()
        this.publish()
        return
      case 'effect-volume':
        if (!Number.isFinite(command.value)) return
        this.state.effectVolume = Math.min(1, Math.max(0, command.value))
        if (this.effectGain) this.effectGain.gain.value = this.state.effectVolume
        this.publish()
        return
      case 'clear': {
        this.transportVersion++
        this.wantsPlay = false
        if (!this.activating) this.audio.pause()
        this.state.trackId = null
        this.state.currentTime = 0
        this.state.duration = 0
        this.state.status = 'idle'
        this.state.error = null
        this.pendingSeek = null
        if (!this.activating) this.loadSelectedTrack()
        else this.publish()
        return
      }
      case 'volume': {
        if (!Number.isFinite(command.value)) return
        this.state.volume = Math.min(1, Math.max(0, command.value))
        if (this.gain) this.gain.gain.value = this.state.volume
        this.publish()
        return
      }
      case 'select': {
        this.selectTrack(command.trackId)
        return
      }
      case 'pause':
      case 'stop': {
        this.transportVersion++
        this.wantsPlay = false
        if (!this.activating) this.audio.pause()
        if (command.action === 'stop') {
          this.seekTo(0)
          this.stopEffect()
        }
        this.state.status = this.state.trackId ? (command.action === 'stop' ? 'stopped' : 'paused') : 'idle'
        this.publish()
        return
      }
      case 'seek':
        if (this.state.trackId && Number.isFinite(command.value)) this.seekTo(command.value)
        this.publish()
        return
      case 'play':
      case 'restart':
        await this.play(command.action === 'restart')
    }
  }

  disconnect(): void {
    if (this.destroyed) return
    this.activationVersion++
    this.transportVersion++
    this.activationPromise = null
    const wasActivating = this.activating
    this.activating = false
    this.wantsPlay = false
    this.audio.pause()
    this.state.ready = false
    this.stopEffect()
    if (wasActivating) this.loadSelectedTrack()
    this.state.status = this.state.trackId ? 'paused' : 'idle'
    this.state.error = null
    this.publish()
  }

  destroy(): void {
    if (this.destroyed) return
    this.disconnect()
    this.destroyed = true
    clearInterval(this.timer)
    for (const event of this.events) this.audio.removeEventListener(event, this.onMediaEvent)
    for (const event of this.events) this.effectAudio.removeEventListener(event, this.onEffectEvent)
    this.audio.removeAttribute('src')
    this.audio.load()
    this.source?.disconnect()
    this.gain?.disconnect()
    this.effectSource?.disconnect()
    this.effectGain?.disconnect()
    this.context?.removeEventListener('statechange', this.onContextStateChange)
    void this.context?.close().catch(() => {})
  }

  private selectTrack(trackId: string): void {
    this.transportVersion++
    this.wantsPlay = false
    if (!this.activating) this.audio.pause()
    this.state.trackId = trackId
    this.state.currentTime = 0
    this.state.duration = 0
    this.state.error = null
    this.pendingSeek = 0
    if (this.activating) {
      this.state.status = 'loading'
      this.publish()
    } else this.loadSelectedTrack()
  }

  private async advance(direction: 1 | -1, natural = false): Promise<void> {
    const index = this.state.trackId ? this.state.queue.indexOf(this.state.trackId) : -1
    if (natural && index < 0) return
    const target = this.state.queue[index + direction]
    if (!target) return
    const shouldPlay = natural || this.wantsPlay
    const previousStatus = this.state.status
    this.selectTrack(target)
    if (shouldPlay) await this.play(false)
    else {
      this.state.status = previousStatus === 'paused' ? 'paused' : 'stopped'
      this.publish()
    }
  }

  private async playEffect(trackId: string): Promise<void> {
    if (!this.state.ready || this.activating) {
      this.state.effectError = 'Klik eerst op deze pc op Audio activeren.'
      this.state.effectStatus = 'error'
      this.publish()
      return
    }
    if (this.context?.state !== 'running') {
      this.onContextStateChange()
      return
    }
    const version = ++this.effectVersion
    this.wantsEffect = false
    this.effectAudio.pause()
    this.state.effectTrackId = trackId
    this.state.effectError = null
    this.state.effectStatus = 'loading'
    this.effectAudio.src = this.audioUrl(trackId)
    this.effectAudio.load()
    this.wantsEffect = true
    this.publish()
    try {
      await this.effectAudio.play()
      if (this.destroyed || version !== this.effectVersion) {
        if (!this.wantsEffect || !this.state.ready) this.effectAudio.pause()
        return
      }
      if (!this.effectAudio.paused && !this.effectAudio.ended) this.state.effectStatus = 'playing'
      this.publish()
    } catch (error: unknown) {
      if (this.destroyed || version !== this.effectVersion) return
      this.wantsEffect = false
      this.effectAudio.pause()
      this.state.effectStatus = 'error'
      this.state.effectError = error instanceof Error && error.name === 'NotAllowedError'
        ? 'De browser blokkeert dit effect. Probeer het opnieuw vanaf de afspeel-pc.'
        : 'Dit geluidseffect kan niet worden afgespeeld. Controleer het bestand en probeer MP3 of WAV.'
      this.publish()
    }
  }

  private stopEffect(): void {
    this.effectVersion++
    this.wantsEffect = false
    this.state.effectTrackId = null
    this.state.effectStatus = 'idle'
    this.state.effectError = null
    if (!this.activating) this.clearEffectSource()
  }

  private clearEffectSource(): void {
    this.effectAudio.pause()
    this.effectAudio.removeAttribute('src')
    this.effectAudio.load()
  }

  private audioUrl(trackId: string): string {
    if (this.options.getAudioUrl) return this.options.getAudioUrl(trackId)
    return `${appPath(`/api/audio/${encodeURIComponent(trackId)}`)}?token=${encodeURIComponent(this.options.token)}`
  }

  private async play(restart: boolean): Promise<void> {
    if (!this.state.trackId) return
    if (!this.state.ready || this.activating) {
      this.state.error = 'Klik eerst op deze pc op Audio activeren.'
      this.publish()
      return
    }
    if (this.context?.state !== 'running') {
      this.onContextStateChange()
      return
    }
    const version = ++this.transportVersion
    this.wantsPlay = true
    this.state.error = null
    if (this.audio.error) this.loadSelectedTrack()
    if (restart || this.audio.ended) this.seekTo(0)
    this.state.status = 'loading'
    this.publish()
    try {
      await this.audio.play()
      if (this.destroyed || version !== this.transportVersion) {
        // An older promise must neither restart stopped audio nor pause a newer play.
        if (!this.wantsPlay || !this.state.ready) this.audio.pause()
        return
      }
      if (!this.audio.paused && !this.audio.ended) this.state.status = 'playing'
      this.publish()
    } catch (error: unknown) {
      if (this.destroyed || version !== this.transportVersion) return
      this.wantsPlay = false
      this.audio.pause()
      const name = error instanceof DOMException || error instanceof Error ? error.name : ''
      if (name === 'NotAllowedError') {
        this.state.ready = false
        this.state.error = 'De browser blokkeert het afspelen. Klik op deze pc opnieuw op Audio activeren.'
      } else if (name === 'AbortError') {
        this.state.error = 'Het laden is onderbroken. Probeer het fragment opnieuw af te spelen.'
      } else {
        this.state.error = 'Dit fragment kan niet worden afgespeeld. Controleer het bestand en probeer MP3 of WAV.'
      }
      this.state.status = 'error'
      this.publish()
    }
  }

  private loadSelectedTrack(): void {
    if (this.state.trackId) {
      this.audio.src = this.audioUrl(this.state.trackId)
      this.state.status = 'loading'
    } else {
      this.audio.removeAttribute('src')
      this.state.status = 'idle'
    }
    this.audio.load()
    this.publish()
  }

  private seekTo(value: number): void {
    const duration = this.activating ? this.state.duration : finite(this.audio.duration)
    const target = duration > 0 ? Math.min(duration, Math.max(0, value)) : Math.max(0, value)
    this.pendingSeek = target
    if (this.activating || this.audio.readyState === 0) return
    try {
      this.audio.currentTime = target
      this.pendingSeek = null
    } catch {
      // loadedmetadata will apply a seek that arrived before the file was ready.
    }
  }

  private onContextStateChange = (): void => {
    if (this.destroyed || this.activating || !this.state.ready || this.context?.state === 'running') return
    this.transportVersion++
    this.wantsPlay = false
    this.audio.pause()
    this.state.ready = false
    this.stopEffect()
    this.state.status = this.state.trackId ? 'paused' : 'idle'
    this.state.error = 'De audio-uitvoer is onderbroken. Klik op deze pc opnieuw op Audio activeren.'
    this.publish()
  }

  private onMediaEvent = (event: Event): void => {
    if (this.destroyed || this.activating || !this.state.trackId) return
    if (event.type === 'loadedmetadata' && this.pendingSeek !== null) this.seekTo(this.pendingSeek)
    if (event.type === 'playing') {
      if (!this.wantsPlay || !this.state.ready) this.audio.pause()
      else this.state.status = 'playing'
    } else if (event.type === 'pause' && this.audio.paused && this.state.status === 'playing') {
      if (!this.audio.ended) this.wantsPlay = false
      this.state.status = this.audio.ended ? 'ended' : 'paused'
    } else if (event.type === 'ended' && this.audio.ended) {
      const shouldAdvance = this.wantsPlay
      this.wantsPlay = false
      this.state.status = 'ended'
      if (shouldAdvance) {
        void this.advance(1, true)
      }
    } else if (event.type === 'waiting' && this.wantsPlay) {
      this.state.status = 'loading'
    } else if (event.type === 'canplay' && !this.wantsPlay && this.state.status === 'loading') {
      this.state.status = 'stopped'
    } else if (event.type === 'error' && this.audio.error) {
      this.transportVersion++
      this.wantsPlay = false
      this.state.status = 'error'
      this.state.error = this.audio.error.code === MediaError.MEDIA_ERR_NETWORK
        ? 'Het audiobestand kon niet worden geladen. Controleer de verbinding met de server.'
        : 'Dit audiobestand wordt niet ondersteund of is beschadigd. Probeer MP3 of WAV.'
    }
    this.publish()
  }

  private onEffectEvent = (event: Event): void => {
    if (this.destroyed || this.activating || !this.state.effectTrackId) return
    if (event.type === 'playing') {
      if (!this.wantsEffect || !this.state.ready) this.effectAudio.pause()
      else this.state.effectStatus = 'playing'
    } else if (event.type === 'ended' && this.effectAudio.ended) {
      this.wantsEffect = false
      this.state.effectStatus = 'ended'
    } else if (event.type === 'waiting' && this.wantsEffect) {
      this.state.effectStatus = 'loading'
    } else if (event.type === 'pause' && this.effectAudio.paused && this.state.effectStatus === 'playing') {
      this.wantsEffect = false
      this.state.effectStatus = this.effectAudio.ended ? 'ended' : 'paused'
    } else if (event.type === 'error' && this.effectAudio.error) {
      this.effectVersion++
      this.wantsEffect = false
      this.effectAudio.pause()
      this.state.effectStatus = 'error'
      this.state.effectError = this.effectAudio.error.code === MediaError.MEDIA_ERR_NETWORK
        ? 'Het geluidseffect kon niet worden geladen. Controleer de verbinding met de server.'
        : 'Dit geluidseffect wordt niet ondersteund of is beschadigd. Probeer MP3 of WAV.'
    }
    this.publish()
  }

  private publish(): void {
    if (this.destroyed) return
    if (!this.activating && this.state.trackId) {
      this.state.currentTime = finite(this.audio.currentTime)
      this.state.duration = finite(this.audio.duration)
    }
    this.options.onPlayback(this.playback)
  }
}
