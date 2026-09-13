import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Link2,
  Pause,
  Play,
  Plus,
  Minus,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Tabs } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn, formatTime } from "@/lib/utils";
import type { Command, Playback, RoomState, Track } from "../../shared/protocol";
import "./tablet-controller.css";

const playbackLabels: Record<Playback["status"], string> = {
  idle: "Klaar voor muziek",
  loading: "Liedje laden…",
  playing: "Speelt af",
  paused: "Gepauzeerd",
  stopped: "Gestopt",
  ended: "Afgelopen",
  error: "Audio controleren",
};

type LibraryView = "music" | "queue" | "effects";

const effectLabels: Record<Playback["status"], string> = {
  idle: "Kies een effect",
  loading: "Effect laden…",
  playing: "Effect speelt",
  paused: "Effect gepauzeerd",
  stopped: "Effect gestopt",
  ended: "Effect afgelopen",
  error: "Effect controleren",
};

interface TabletControllerProps {
  state: RoomState;
  connection: "connecting" | "connected" | "disconnected" | "busy";
  command: (command: Command) => void;
  error: string | null;
  clearError: () => void;
  onDisconnect: () => void;
}

export function TabletController({
  state,
  connection,
  command,
  error,
  clearError,
  onDisconnect,
}: TabletControllerProps) {
  const { playback, tracks } = state;
  const online = connection === "connected";
  const ready = online && state.playerOnline && playback.ready;
  const current = tracks.find((track) => track.id === playback.trackId);
  const enabled = ready && !!current;
  const playing = playback.status === "playing";
  const music = tracks.filter((track) => track.kind !== "effect");
  const effects = tracks.filter((track) => track.kind === "effect");
  const queue = playback.queue
    .map((id) => music.find((track) => track.id === id))
    .filter((track): track is Track => !!track);
  const queueIndex = queue.findIndex((track) => track.id === playback.trackId);
  const effect = effects.find((track) => track.id === playback.effectTrackId);
  const hasEffects = effects.length > 0;
  const effectActive = playback.effectStatus === "playing" || playback.effectStatus === "loading";
  const [library, setLibrary] = useState<LibraryView>("music");
  const libraryTracks = library === "effects" ? effects : library === "queue" ? queue : music;
  const [dragVolume, setDragVolume] = useState<number | null>(null);
  const [dragEffectVolume, setDragEffectVolume] = useState<number | null>(null);
  const [dragSeek, setDragSeek] = useState<number | null>(null);
  const previousVolume = useRef(0.75);
  const volume = dragVolume ?? Math.round(playback.volume * 100);
  const effectVolume = dragEffectVolume ?? Math.round(playback.effectVolume * 100);
  const position = Math.min(dragSeek ?? playback.currentTime, playback.duration || 0);
  const fragmentSpace = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState({ rows: 1, columns: 1 });
  const [pageAnchor, setPageAnchor] = useState(0);

  useEffect(() => {
    const element = fragmentSpace.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const rows = Math.max(1, Math.floor((entry.contentRect.height + 10) / 76));
      const columns = entry.contentRect.width >= 540 ? 2 : 1;
      setCapacity((previous) =>
        previous.rows === rows && previous.columns === columns
          ? previous
          : { rows, columns },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pageSize = capacity.rows * capacity.columns;
  const pageCount = Math.max(1, Math.ceil(libraryTracks.length / pageSize));
  const page = Math.min(Math.floor(pageAnchor / pageSize), pageCount - 1);
  const start = page * pageSize;
  const visibleTracks = libraryTracks.slice(start, start + pageSize);
  const reason = !online
    ? "Verbinding wordt hersteld. De audio op de pc kan doorspelen."
    : !state.playerOnline
      ? "Open de afspeler op de PA-pc."
      : !playback.ready
        ? "Tik op de pc op ‘Audio activeren’."
        : !current
          ? "Kies een liedje om klaar te zetten."
          : "";
  const message = error || playback.error || playback.effectError;

  return (
    <div className={cn("tablet-shell", hasEffects && "tablet-has-effects")}>
      <header className="tablet-header">
        <div className="tablet-brand">
          <span>Zaalgeluid</span>
          <h1>Bediening</h1>
        </div>
        <div className="tablet-header-actions">
          <span className={cn("tablet-connection", ready && "tablet-connected")} role="status">
            {online ? <Wifi size={18} /> : <WifiOff size={18} />}
            {online ? (state.playerOnline ? "Verbonden" : "Pc offline") : "Verbinden…"}
          </span>
          <Button variant="ghost" className="tablet-disconnect" onClick={onDisconnect}>
            <Link2 /> Ontkoppelen
          </Button>
        </div>
      </header>

      {message && (
        <div className="tablet-notice" role="alert">
          <p title={message}>{message}</p>
          {error && (
            <Button variant="ghost" size="icon" aria-label="Melding sluiten" onClick={clearError}>
              <X />
            </Button>
          )}
        </div>
      )}

      <main className="tablet-main">
        <section className={cn("tablet-playback", !ready && "tablet-awaiting")} aria-label="Audiobediening">
          <div className="tablet-current">
            <p id="tablet-control-reason" className={cn("tablet-playback-status", playing && ready && "tablet-playing")}>
              <span aria-hidden="true" />
              {ready ? playbackLabels[playback.status] : reason}
            </p>
            <div className="tablet-current-heading">
              <h2 title={current?.name}>{current?.name || "Kies een liedje"}</h2>
              {queue.length > 0 && (
                <div className="tablet-queue-navigation" aria-label="Afspeellijst bedienen">
                  <Button variant="outline" size="icon" aria-label="Vorig liedje" disabled={!ready || queueIndex <= 0} onClick={() => command({ action: "previous" })}>
                    <SkipBack />
                  </Button>
                  <Button variant="outline" size="icon" aria-label="Volgend liedje" disabled={!ready || queueIndex >= queue.length - 1} onClick={() => command({ action: "next" })}>
                    <SkipForward />
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="tablet-timeline">
            <Slider
              aria-label="Afspeelpositie"
              value={[position]}
              min={0}
              max={playback.duration || 1}
              step={0.1}
              disabled={!enabled || !playback.duration}
              onValueChange={([value]) => setDragSeek(value)}
              onValueCommit={([value]) => {
                command({ action: "seek", value });
                setDragSeek(null);
              }}
            />
            <div className="tablet-times">
              <span>{formatTime(position)}</span>
              <span>{formatTime(playback.duration)}</span>
            </div>
          </div>

          <div className="tablet-transport" aria-describedby={reason ? "tablet-control-reason" : undefined}>
            <Button
              className="tablet-play"
              disabled={!enabled}
              onClick={() => command({ action: playing ? "pause" : "play" })}
            >
              {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
              {playing ? "Pauzeren" : playback.status === "paused" ? "Hervatten" : "Afspelen"}
            </Button>
            <Button variant="outline" className="tablet-stop" disabled={!online || !state.playerOnline || (!current && !effect)} onClick={() => command({ action: "stop" })}>
              <Square fill="currentColor" /> Stoppen
            </Button>
            <Button variant="outline" disabled={!enabled} onClick={() => command({ action: "restart" })}>
              <RotateCcw /> Opnieuw
            </Button>
          </div>

          <div className="tablet-volume">
            <div className="tablet-volume-heading">
              <label id="tablet-volume-label">Muziekvolume</label>
              <span>{volume}%</span>
            </div>
            <div className="tablet-volume-controls">
              <Button
                variant="outline"
                size="icon"
                disabled={!ready}
                aria-label={playback.volume === 0 ? "Geluid aan" : "Geluid dempen"}
                onClick={() => {
                  if (playback.volume > 0) {
                    previousVolume.current = playback.volume;
                    command({ action: "volume", value: 0 });
                  } else {
                    command({ action: "volume", value: previousVolume.current });
                  }
                }}
              >
                {volume === 0 ? <VolumeX /> : <Volume2 />}
              </Button>
              <Slider
                aria-labelledby="tablet-volume-label"
                value={[volume]}
                max={100}
                step={1}
                disabled={!ready}
                onValueChange={([value]) => {
                  setDragVolume(value);
                  command({ action: "volume", value: value / 100 });
                }}
                onValueCommit={() => setDragVolume(null)}
              />
            </div>
          </div>
        </section>

        <Tabs.Root value={library} onValueChange={(value) => {
          setLibrary(value as LibraryView);
          setPageAnchor(0);
        }} asChild>
          <section className="tablet-library" aria-label="Audiobibliotheek">
            <Tabs.List className="tablet-library-tabs" aria-label="Bibliotheek kiezen">
              {([
                ["music", "Liedjes", music.length],
                ["queue", "Afspeellijst", queue.length],
                ["effects", "Geluidseffecten", effects.length],
              ] as const).map(([value, label, count]) => (
                <Tabs.Trigger key={value} value={value} asChild>
                  <Button variant="ghost" aria-label={label}>
                    {label}<span>{count}</span>
                  </Button>
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {hasEffects && (
              <div className="tablet-effect-controls" aria-label="Geluidseffect bedienen">
                <div className="tablet-effect-current" role="status">
                  <strong title={effect?.name}>{effect?.name || "Geluidseffect"}</strong>
                  <span className={cn(effectActive && "tablet-playing")}>{effectLabels[playback.effectStatus]}</span>
                </div>
                <div className="tablet-effect-volume">
                  <div><label id="tablet-effect-volume-label">Effectvolume</label><span>{effectVolume}%</span></div>
                  <Slider
                    aria-labelledby="tablet-effect-volume-label"
                    value={[effectVolume]}
                    max={100}
                    step={1}
                    disabled={!ready}
                    onValueChange={([value]) => {
                      setDragEffectVolume(value);
                      command({ action: "effect-volume", value: value / 100 });
                    }}
                    onValueCommit={() => setDragEffectVolume(null)}
                  />
                </div>
                <Button variant="outline" size="icon" aria-label="Effect stoppen" title="Effect stoppen" disabled={!online || !state.playerOnline || (!playback.effectTrackId && !playback.effectError)} onClick={() => command({ action: "effect-stop" })}>
                  <Square fill="currentColor" />
                </Button>
              </div>
            )}
            <Tabs.Content value={library} className="tablet-library-content">
              <div className="tablet-fragment-space" ref={fragmentSpace}>
                {libraryTracks.length === 0 ? (
                  <div className="tablet-empty">
                    <strong>{library === "queue" ? "Je afspeellijst is leeg" : library === "effects" ? "Nog geen geluidseffecten" : "Nog geen liedjes"}</strong>
                    <p>{library === "queue" ? "Tik bij een liedje op + om het toe te voegen." : "Voeg audio toe op de PA-pc."}</p>
                  </div>
                ) : (
                  <div
                    className="tablet-fragments"
                    style={{
                      gridTemplateColumns: `repeat(${capacity.columns}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${capacity.rows}, minmax(66px, 1fr))`,
                    }}
                  >
                    {visibleTracks.map((track, index) => {
                      const selected = track.id === (library === "effects" ? playback.effectTrackId : playback.trackId);
                      const queued = playback.queue.includes(track.id);
                      return (
                        <div key={track.id} className={cn("tablet-track", selected && "tablet-selected")}>
                          <Button
                            variant="ghost"
                            className="tablet-fragment"
                            disabled={!ready}
                            aria-label={`${track.name} ${library === "effects" ? "effect afspelen" : "klaarzetten"}`}
                            aria-pressed={selected}
                            title={track.name}
                            onClick={() => command({ action: library === "effects" ? "effect-play" : "select", trackId: track.id })}
                          >
                            <span className="tablet-fragment-number">{String(start + index + 1).padStart(2, "0")}</span>
                            <span className="tablet-fragment-name">{track.name}</span>
                            {selected && <Check className="tablet-fragment-check" aria-hidden="true" />}
                            {library === "effects" && !selected && <Play aria-hidden="true" />}
                          </Button>
                          {library !== "effects" && (
                            <Button
                              variant="ghost"
                              className="tablet-queue-toggle"
                              disabled={!ready || (!queued && playback.queue.length >= 200)}
                              aria-pressed={queued}
                              aria-label={`${track.name} ${queued ? "uit afspeellijst verwijderen" : "aan afspeellijst toevoegen"}`}
                              title={queued ? "Uit afspeellijst verwijderen" : "Aan afspeellijst toevoegen"}
                              onClick={() => command({ action: queued ? "queue-remove" : "queue-add", trackId: track.id })}
                            >
                              {queued ? <Minus /> : <Plus />}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <nav className="tablet-pagination" aria-label="Fragmentpagina's">
                <Button
                  variant="outline"
                  aria-label="Vorige fragmenten"
                  disabled={page === 0}
                  onClick={() => setPageAnchor((page - 1) * pageSize)}
                >
                  <ChevronLeft />
                </Button>
                <span aria-live="polite">
                  {libraryTracks.length === 0 ? "0 items" : `${start + 1}–${Math.min(start + pageSize, libraryTracks.length)} van ${libraryTracks.length}`}
                </span>
                <Button
                  variant="outline"
                  aria-label="Volgende fragmenten"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPageAnchor((page + 1) * pageSize)}
                >
                  <ChevronRight />
                </Button>
              </nav>
            </Tabs.Content>
          </section>
        </Tabs.Root>
      </main>
    </div>
  );
}
