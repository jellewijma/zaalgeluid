import { useCallback, useEffect, useRef, useState } from 'react'
import { useConvex, useConvexConnectionState, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { initialPlayback, type Command, type Playback, type RoomState } from '../../shared/protocol'
import { AudioEngine } from '../lib/audio-engine'
import { appPath } from '../lib/paths'
import type { Connection } from './use-room'

const emptyRoom: RoomState = { tracks: [], playerOnline: false, controllerCount: 0, playback: initialPlayback }
const newPin = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0')
function message(cause: unknown) {
  const text = cause instanceof Error ? cause.message : 'De opdracht is niet gelukt. Probeer opnieuw.'
  return text.split('Uncaught Error: ').at(-1)!.split('\n')[0].replace(/\s+at .*$/, '')
}

/** Audio remains on this PC; Convex carries state and short-lived control commands. */
export function useCloudRoom({ role, token, onInvalidSession }: {
  role: 'player' | 'controller'; token?: string; onInvalidSession: () => void
}) {
  const convex = useConvex()
  const transport = useConvexConnectionState()
  const serverState = useQuery(api.rooms.state, token ? { token } : {})
  const serverSetup = useQuery(api.rooms.setup, role === 'player' ? {} : 'skip')
  const urls = useQuery(api.files.mediaUrls, role === 'player' ? {} : 'skip')
  const claimPlayer = useMutation(api.rooms.claimPlayer)
  const reportPlayback = useMutation(api.rooms.reportPlayback)
  const releasePlayer = useMutation(api.rooms.releasePlayer)
  const sendCommand = useMutation(api.rooms.sendCommand)
  const heartbeat = useMutation(api.rooms.controllerHeartbeat)
  const rotatePin = useMutation(api.rooms.rotatePin)
  const [clientId] = useState(() => crypto.randomUUID())
  const [claimed, setClaimed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localPlayback, setLocalPlayback] = useState<Playback>(initialPlayback)
  const [afterSequence, setAfterSequence] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [clockOffset, setClockOffset] = useState(0)
  const engineRef = useRef<AudioEngine | null>(null)
  const mediaRef = useRef<Record<string, string>>({})
  const live = useRef({ connected: false, claimed: false, busy: false, leaseUntil: 0, clockOffset: 0, ack: 0, disposed: false })
  const claimInFlight = useRef(false)
  const processing = useRef(false)
  const invalidSession = useRef(onInvalidSession)
  const pending = useQuery(api.rooms.pendingCommands, role === 'player' && claimed ? { clientId, afterSequence } : 'skip')

  useEffect(() => { invalidSession.current = onInvalidSession }, [onInvalidSession])
  useEffect(() => { if (urls) mediaRef.current = urls }, [urls])
  useEffect(() => { live.current.connected = transport.isWebSocketConnected }, [transport.isWebSocketConnected])

  const calibrateClock = useCallback(async () => {
    const start = Date.now()
    const serverNow = await convex.action(api.rooms.serverTime, {})
    const received = Date.now()
    if (received - start >= 5000 || !live.current.connected) throw new Error('De verbinding is te traag. Probeer opnieuw.')
    const offset = serverNow - (start + received) / 2
    live.current.clockOffset = offset
    setClockOffset(offset)
  }, [convex])

  useEffect(() => {
    if (role !== 'controller' || !transport.isWebSocketConnected) return
    const timer = setTimeout(() => void calibrateClock().catch(() => {}), 0)
    return () => clearTimeout(timer)
  }, [role, transport.isWebSocketConnected, calibrateClock])

  const claim = useCallback(async (force = false) => {
    if (!live.current.connected || claimInFlight.current) return
    claimInFlight.current = true
    try {
      await calibrateClock()
      const result = await claimPlayer({ clientId, pin: newPin(), force, sentAt: Date.now() + live.current.clockOffset })
      const [saved, media] = await Promise.all([convex.query(api.rooms.state, {}), convex.query(api.files.mediaUrls, {})])
      if (live.current.disposed) return
      if (!saved || saved.playerClientId !== clientId) throw new Error('Een andere pc heeft de afspeler overgenomen.')
      mediaRef.current = media
      engineRef.current?.restore(saved.playback)
      live.current.claimed = true
      live.current.busy = false
      live.current.leaseUntil = result.leaseUntil
      live.current.ack = result.ackSequence
      setAfterSequence(result.ackSequence)
      setClaimed(true)
      setBusy(false)
      setError(null)
    } catch (cause) {
      if (live.current.disposed) return
      live.current.busy = true
      setBusy(true)
      setError(message(cause))
    } finally { claimInFlight.current = false }
  }, [claimPlayer, clientId, convex, calibrateClock])

  useEffect(() => {
    const session = live.current
    session.disposed = false
    let dirty = true
    let inFlight = false
    let lastReport = 0
    const engine = role === 'player' ? new AudioEngine({ token: '', getAudioUrl: id => mediaRef.current[id] || '', onPlayback: playback => {
      dirty = true
      setLocalPlayback(playback)
    } }) : null
    engineRef.current = engine
    const interval = setInterval(() => {
      const current = live.current
      if (!engine || !current.claimed) return
      const serverNow = Date.now() + current.clockOffset
      // Stop before the server may grant a second PC the lease, even offline.
      if (serverNow >= current.leaseUntil - 1000) {
        current.claimed = false
        engine.disconnect()
        setClaimed(false)
        setError('De verbinding met de speler is verlopen. Activeer audio opnieuw zodra de verbinding is hersteld.')
        return
      }
      if (!current.connected || inFlight || (!dirty && Date.now() - lastReport < 5000)) return
      dirty = false
      inFlight = true
      lastReport = Date.now()
      void reportPlayback({ clientId, playback: engine.getSnapshot(), ackSequence: current.ack }).catch(cause => {
        if (!current.disposed) setError(message(cause))
      }).finally(() => { inFlight = false })
    }, 750)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      session.disposed = true
      clearInterval(interval)
      clearInterval(clock)
      engine?.destroy()
      engineRef.current = null
      if (role === 'player' && session.claimed && session.connected) void releasePlayer({ clientId }).catch(() => {})
      session.claimed = false
    }
  }, [role, clientId, releasePlayer, reportPlayback])

  useEffect(() => {
    if (role !== 'player' || !transport.isWebSocketConnected || claimed || busy) return
    const timer = setTimeout(() => void claim(), 0)
    return () => clearTimeout(timer)
  }, [role, transport.isWebSocketConnected, claimed, busy, claim])

  useEffect(() => {
    const reconcile = () => {
      if (!serverState) {
        if (role === 'controller' && serverState === null && live.current.connected) invalidSession.current()
        return
      }
      if (role !== 'player' || !live.current.claimed) return
      if (serverState.playerClientId === clientId) live.current.leaseUntil = serverState.leaseUntil
      else {
        live.current.claimed = false
        live.current.busy = true
        engineRef.current?.disconnect()
        setClaimed(false)
        setBusy(true)
        setError('Een andere pc heeft de afspeler overgenomen.')
      }
    }
    reconcile()
  }, [serverState, role, clientId])

  useEffect(() => {
    if (!pending?.length || processing.current || !live.current.claimed || !transport.isWebSocketConnected) return
    let cancelled = false
    processing.current = true
    const processCommands = async () => {
      try {
        const needsMedia = pending.some(item => 'trackId' in item.command && !mediaRef.current[item.command.trackId])
        if (needsMedia && live.current.connected) mediaRef.current = await convex.query(api.files.mediaUrls, {})
        if (cancelled || !live.current.claimed || !live.current.connected || live.current.disposed) return
        for (const item of pending) {
          if (!live.current.claimed || !live.current.connected || Date.now() + live.current.clockOffset >= live.current.leaseUntil - 1000) return
          if (item.sequence <= live.current.ack) continue
          if (item.clientId === clientId && item.expiresAt > Date.now() + live.current.clockOffset) {
            // Transport operations must not wait on play(): a later stop cancels it.
            void engineRef.current?.execute(item.command).catch(cause => setError(message(cause)))
          }
          live.current.ack = item.sequence
        }
        setAfterSequence(live.current.ack)
      } catch (cause) { if (!cancelled) setError(message(cause)) }
      finally { processing.current = false }
    }
    void processCommands()
    return () => { cancelled = true; processing.current = false }
  }, [pending, convex, clientId, transport.isWebSocketConnected])

  useEffect(() => {
    if (role !== 'controller' || !token) return
    let inFlight = false
    const tick = () => {
      if (!live.current.connected || inFlight) return
      inFlight = true
      void heartbeat({ token }).catch(() => {
        if (live.current.connected) invalidSession.current()
      }).finally(() => { inFlight = false })
    }
    tick()
    const timer = setInterval(tick, 10000)
    return () => clearInterval(timer)
  }, [role, token, heartbeat])

  const command = useCallback((value: Command) => {
    if (!live.current.connected) { setError('Geen verbinding. Wacht tot de verbinding is hersteld en probeer opnieuw.'); return }
    setError(null)
    void sendCommand({ ...(token ? { token } : {}), command: value, sentAt: Date.now() + live.current.clockOffset }).catch(cause => setError(message(cause)))
  }, [sendCommand, token])
  const enable = useCallback(async () => {
    if (!live.current.connected || !live.current.claimed) { setError('Wacht tot deze pc met de afspeler is verbonden.'); return }
    setError(null)
    // Synchronous call in the user gesture unlocks both media elements.
    const engine = engineRef.current
    await engine?.enable()
    if (!engine || engineRef.current !== engine || !live.current.connected || !live.current.claimed) return
    // Publish activation immediately: the server validates every play command
    // against this state, so waiting for telemetry leaves a quick-click race.
    try { await reportPlayback({ clientId, playback: engine.getSnapshot(), ackSequence: live.current.ack }) }
    catch (cause) { if (!live.current.disposed) setError(message(cause)) }
  }, [clientId, reportPlayback])
  const refreshPin = useCallback(async () => {
    if (!live.current.connected || !live.current.claimed) return
    try { await rotatePin({ clientId, pin: newPin() }); setError(null) }
    catch (cause) { setError(message(cause)) }
  }, [rotatePin, clientId])

  const connection: Connection = busy ? 'busy' : !transport.isWebSocketConnected ? (transport.hasEverConnected ? 'disconnected' : 'connecting') : role === 'player' && !claimed ? 'connecting' : 'connected'
  const state: RoomState = serverState ? {
    ...serverState,
    playerOnline: serverState.playerClientId !== null && serverState.leaseUntil > now + clockOffset,
    playback: role === 'player' && claimed ? {
      ...localPlayback,
      // Keep transport controls disabled until this PC's activation is also
      // visible to the server that accepts commands from the PC and tablets.
      ready: localPlayback.ready && serverState.playerClientId === clientId && serverState.playback.ready,
    } : serverState.playback,
  } : emptyRoom
  const setup = serverSetup ? {
    ...serverSetup,
    token: '',
    urls: [`${location.origin}${appPath('/control')}?room=${encodeURIComponent(serverSetup.roomId)}`],
  } : null
  return { state, connection, command, enable, error, clearError: () => setError(null), setup, takeover: () => claim(true), refreshPin }
}
