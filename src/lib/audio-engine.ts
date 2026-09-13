import { initialPlayback, type Command, type Playback } from '../../shared/protocol'

type Options = {
  token: string
  onPlayback: (playback: Playback) => void
}

const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0

// A short PCM WAV unlocks the very same media element used for every real track.
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
  private readonly options: Options
  private state: Playback = { ...initialPlayback }
  private context: AudioContext | null = null
  private gain: GainNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private wantsPlay = false
  private transportVersion = 0
  private activationVersion = 0
  private activating = false
  private activationPromise: Promise<void> | null = null
  private pendingSeek: number | null = null
  private destroyed = false
  private readonly timer: ReturnType<typeof setInterval>
  private readonly events = ['playing', 'pause', 'ended', 'loadedmetadata', 'durationchange', 'timeupdate', 'canplay', 'waiting', 'error'] as const

  constructor(options: Options) {
    this.options = options
    this.audio.preload = 'auto'
    this.audio.setAttribute('playsinline', '')
    for (const event of this.events) this.audio.addEventListener(event, this.onMediaEvent)
    this.timer = setInterval(() => {
      if (this.wantsPlay && !this.activating) this.publish()
    }, 250)
  }

  get playback(): Playback {
    return { ...this.state }
  }

  getSnapshot(): Playback {
    return this.playback
  }

  /** Call directly in the click handler: both resume() and play() run before any await. */
  enable(): Promise<void> {
    if (this.destroyed || this.state.ready) return Promise.resolve()
    if (this.activationPromise) return this.activationPromise

    const version = ++this.activationVersion
    this.transportVersion++
    this.wantsPlay = false
    this.activating = true
    this.audio.pause()
    const previousTime = this.state.currentTime
    this.pendingSeek = previousTime
    this.state.error = null
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
        this.context.addEventListener('statechange', this.onContextStateChange)
      }
      this.gain!.gain.value = this.state.volume
      const resumed = this.context.resume()
      this.audio.src = silentWav()
      this.audio.load()
      const played = this.audio.play()
      activation = Promise.all([resumed, played])
    } catch (error) {
      activation = Promise.reject(error)
    }

    let timeout: ReturnType<typeof setTimeout>
    const limit = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('ActivationTimeout')), 8000)
    })
    const operation = Promise.race([activation, limit]).then(() => {
      if (this.destroyed || version !== this.activationVersion) return
      this.audio.pause()
      this.activating = false
      this.state.ready = this.context?.state === 'running'
      if (!this.state.ready) throw new Error('ActivationTimeout')
      this.state.error = null
      this.loadSelectedTrack()
    }).catch((error: unknown) => {
      if (this.destroyed || version !== this.activationVersion) return
      this.audio.pause()
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
        this.transportVersion++
        this.wantsPlay = false
        if (!this.activating) this.audio.pause()
        this.state.trackId = command.trackId
        this.state.currentTime = 0
        this.state.duration = 0
        this.state.error = null
        this.pendingSeek = 0
        if (this.activating) {
          this.state.status = 'loading'
          this.publish()
        } else this.loadSelectedTrack()
        return
      }
      case 'pause':
      case 'stop': {
        this.transportVersion++
        this.wantsPlay = false
        if (!this.activating) this.audio.pause()
        if (command.action === 'stop') this.seekTo(0)
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
    this.audio.removeAttribute('src')
    this.audio.load()
    this.source?.disconnect()
    this.gain?.disconnect()
    this.context?.removeEventListener('statechange', this.onContextStateChange)
    void this.context?.close().catch(() => {})
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
      this.audio.src = `/api/audio/${encodeURIComponent(this.state.trackId)}?token=${encodeURIComponent(this.options.token)}`
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
      this.wantsPlay = false
      this.state.status = this.audio.ended ? 'ended' : 'paused'
    } else if (event.type === 'ended' && this.audio.ended) {
      this.wantsPlay = false
      this.state.status = 'ended'
    } else if (event.type === 'waiting' && this.wantsPlay) {
      this.state.status = 'loading'
    } else if (event.type === 'canplay' && !this.wantsPlay && this.state.status === 'loading') {
      this.state.status = 'stopped'
    } else if (event.type === 'error' && this.audio.error) {
      this.transportVersion++
      this.wantsPlay = false
      this.state.status = 'error'
      this.state.error = this.audio.error.code === MediaError.MEDIA_ERR_NETWORK
        ? 'Het audiobestand kon niet worden geladen. Controleer de verbinding met de lokale server.'
        : 'Dit audiobestand wordt niet ondersteund of is beschadigd. Probeer MP3 of WAV.'
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
