import { useRef, useState } from 'react'
import { AudioLines, Check, FileAudio2, ListMusic, LoaderCircle, Plus, ShieldCheck, Square, Trash2, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { appPath } from '@/lib/paths'
import { cn, formatSize } from '@/lib/utils'
import type { Command, Playback, Track } from '../../shared/protocol'

interface Props {
  tracks: Track[]
  playback: Playback
  token: string
  ready: boolean
  online: boolean
  command: (command: Command) => void
  cloud?: boolean
  onUpload?: (files: File[], kind: 'music' | 'effect') => Promise<void>
  onRemove?: (id: string) => Promise<void>
}

async function checked(response: Response) {
  if (response.ok) return
  const data = await response.json().catch(() => ({}))
  throw new Error(data.error || 'Dit is niet gelukt. Probeer het opnieuw.')
}

export function AudioLibrary(props: Props) {
  return <>
    <LibrarySection {...props} kind="music" />
    <LibrarySection {...props} kind="effect" />
  </>
}

function LibrarySection({ tracks, playback, token, ready, online, command, kind, cloud = false, onUpload, onRemove }: Props & { kind: 'music' | 'effect' }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [showQueue, setShowQueue] = useState(false)
  const effects = kind === 'effect'
  const available = tracks.filter(track => (track.kind ?? 'music') === kind)
  const queue = playback.queue.map(id => tracks.find(track => track.id === id)).filter((track): track is Track => !!track)
  const visible = !effects && showQueue ? queue : available
  const activeEffect = tracks.find(track => track.id === playback.effectTrackId)
  const effectActive = playback.effectStatus === 'playing' || playback.effectStatus === 'loading'

  async function upload(files: FileList | null) {
    if (!files?.length || busy) return
    setBusy(true)
    setError('')
    try {
      if (files.length > 50) throw new Error('Kies maximaal 50 bestanden tegelijk.')
      const selectedFiles = Array.from(files)
      for (const file of selectedFiles) {
        if (file.size > 500 * 1024 * 1024) throw new Error(`${file.name} is groter dan 500 MB.`)
      }
      if (onUpload) {
        await onUpload(selectedFiles, kind)
      } else {
        const body = new FormData()
        for (const file of selectedFiles) body.append('files', file)
        await checked(await fetch(appPath(`/api/tracks?kind=${kind}`), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body }))
      }
      setShowQueue(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Toevoegen is niet gelukt.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function remove(id: string) {
    setDeleting(id)
    setError('')
    try {
      if (onRemove) await onRemove(id)
      else await checked(await fetch(appPath(`/api/tracks/${encodeURIComponent(id)}`), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }))
      setConfirmDelete(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Verwijderen is niet gelukt.')
    } finally { setDeleting(null) }
  }

  return <section className={cn('library panel', effects && 'effects-library')} aria-label={effects ? 'Geluidseffecten' : 'Liedjes en afspeellijst'}>
    <div className="library-heading">
      <div>
        <h2>{effects ? 'Geluidseffecten' : 'Liedjes'} <span className="track-count">{available.length}</span></h2>
        <p>{effects ? 'Tik om direct over de muziek heen af te spelen.' : 'Zet een liedje klaar of voeg meerdere toe aan je afspeellijst.'}</p>
      </div>
      <input ref={input} type="file" multiple accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac,.webm,.opus" className="sr-only" tabIndex={-1}
        aria-label={effects ? 'Geluidseffecten toevoegen' : 'Audiobestanden toevoegen'} onChange={event => void upload(event.target.files)} />
      <Button variant="outline" size="sm" disabled={busy || !online} onClick={() => input.current?.click()}>
        {busy ? <LoaderCircle className="spin" /> : <Plus />}{busy ? 'Toevoegen…' : effects ? 'Effecten toevoegen' : 'Liedjes toevoegen'}
      </Button>
    </div>
    {!effects && <div className="library-switcher" role="group" aria-label="Liedjes weergeven">
      <Button size="sm" variant={showQueue ? 'ghost' : 'secondary'} aria-pressed={!showQueue} onClick={() => setShowQueue(false)}>Alle liedjes</Button>
      <Button size="sm" variant={showQueue ? 'secondary' : 'ghost'} aria-pressed={showQueue} onClick={() => setShowQueue(true)}><ListMusic /> Afspeellijst ({queue.length})</Button>
      {showQueue && queue.length > 0 && <Button className="queue-clear" size="sm" variant="ghost" disabled={!ready} onClick={() => command({ action: 'queue-clear' })}>Lijst leegmaken</Button>}
    </div>}
    {effects && <div className="effect-controls">
      <div className="effect-current" role="status"><Zap size={17} /><span>{effectActive && activeEffect ? `${playback.effectStatus === 'loading' ? 'Laden' : 'Speelt'}: ${activeEffect.name}` : 'Klaar voor een effect'}</span></div>
      <Button variant="outline" size="sm" disabled={!online || (!playback.effectTrackId && !playback.effectError)} onClick={() => command({ action: 'effect-stop' })}><Square /> Effect stoppen</Button>
      <div className="effect-volume"><label id="effect-volume-label">Effectvolume <span>{Math.round(playback.effectVolume * 100)}%</span></label>
        <Slider aria-labelledby="effect-volume-label" value={[Math.round(playback.effectVolume * 100)]} max={100} step={1} disabled={!ready} onValueChange={([value]) => command({ action: 'effect-volume', value: value / 100 })} />
      </div>
    </div>}
    {(error || (effects && playback.effectError)) && <p className="library-error" role="alert">{error || playback.effectError}</p>}
    {visible.length === 0 ? <div className="empty-library">
      {effects ? <Zap size={27} /> : showQueue ? <ListMusic size={27} /> : <FileAudio2 size={27} />}
      <h3>{effects ? 'Je effecten, direct onder de knop.' : showQueue ? 'Kies meerdere liedjes.' : 'Jouw liedjes, hier bij elkaar.'}</h3>
      <p>{effects ? 'Voeg je eigen geluidseffecten toe vanaf deze pc.' : showQueue ? 'Gebruik de plus naast een liedje. De volgorde van toevoegen is de afspeelvolgorde.' : 'Selecteer één of meerdere audiobestanden van deze pc.'}</p>
      {!showQueue && <span>MP3, WAV, M4A en meer · tot 500 MB per bestand</span>}
    </div> : <ul className="track-list">{visible.map((track, index) => {
      const queued = playback.queue.includes(track.id)
      const selected = effects ? effectActive && playback.effectTrackId === track.id : playback.trackId === track.id
      const protectedTrack = playback.trackId === track.id || playback.effectTrackId === track.id || queued
      return <li key={track.id} className={cn('track-row', selected && 'selected')}>
        <button className="track-select" disabled={!ready} onClick={() => command({ action: effects ? 'effect-play' : 'select', trackId: track.id })}
          aria-label={`${track.name} ${effects ? 'afspelen' : 'klaarzetten'}`} aria-pressed={selected}>
          <span className="track-number">{effects ? <Zap size={18} /> : selected ? <AudioLines size={19} /> : String(index + 1).padStart(2, '0')}</span>
          <span className="track-info"><strong>{track.name}</strong><span>{track.filename.split('.').at(-1)?.toUpperCase()} · {formatSize(track.size)}</span></span>
          {selected && <span className="selected-label"><Check size={14} />{effects ? 'Speelt' : 'Klaargezet'}</span>}
        </button>
        {!effects && <Button size="icon" variant="ghost" className="queue-toggle" disabled={!ready || (!queued && playback.queue.length >= 200)}
          aria-label={`${track.name} ${queued ? 'uit afspeellijst halen' : 'aan afspeellijst toevoegen'}`} aria-pressed={queued}
          title={queued ? 'Uit afspeellijst halen' : 'Aan afspeellijst toevoegen'}
          onClick={() => command({ action: queued ? 'queue-remove' : 'queue-add', trackId: track.id })}>
          {queued ? <Check size={17} /> : <Plus size={17} />}
        </Button>}
        <div className="delete-action">{confirmDelete === track.id ? <>
          <Button variant="ghost" size="sm" disabled={!!deleting || protectedTrack || !online} aria-label={`${track.name} definitief verwijderen`} onClick={() => void remove(track.id)}>Verwijderen</Button>
          <Button variant="ghost" size="icon" aria-label="Verwijderen annuleren" onClick={() => setConfirmDelete(null)}><X /></Button>
        </> : <Button variant="ghost" size="icon" disabled={protectedTrack || !online || !!deleting} aria-label={`${track.name} verwijderen`}
          title={protectedTrack ? 'Haal dit bestand uit de afspeellijst en wis de selectie, of stop het effect.' : 'Bestand verwijderen'} onClick={() => setConfirmDelete(track.id)}><Trash2 size={16} /></Button>}</div>
      </li>
    })}</ul>}
    <div className="library-footnote"><ShieldCheck size={14} /><span>{effects ? 'Eén effect tegelijk. Opnieuw tikken start het effect opnieuw; de muziek blijft doorspelen.' : cloud ? 'Privé opgeslagen bij je account. Gekozen liedjes spelen na elkaar zodra je op Afspelen drukt.' : 'Bestanden worden op deze pc bewaard. Gekozen liedjes spelen na elkaar zodra je op Afspelen drukt.'}</span></div>
  </section>
}
