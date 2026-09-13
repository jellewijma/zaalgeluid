import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AudioLines,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  FileAudio2,
  Headphones,
  Link2,
  LoaderCircle,
  Monitor,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Square,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useRoom } from "@/hooks/use-room";
import { cn, formatSize, formatTime } from "@/lib/utils";
import type { Command, Playback, Setup, Track } from "../shared/protocol";

const labels: Record<Playback["status"], string> = {
  idle: "Klaar voor een fragment",
  loading: "Fragment laden",
  playing: "Speelt af",
  paused: "Gepauzeerd",
  stopped: "Gestopt",
  ended: "Afgelopen",
  error: "Audio controleren",
};
const isPlayer = location.pathname === "/player";
const isControl = location.pathname === "/control";

function Header({ connected, role }: { connected?: boolean; role?: string }) {
  return (
    <header className="app-header">
      <div className="header-inner">
        <a href="/" className="brand" aria-label="Zaalgeluid startpagina">
          <span className="brand-icon">
            <AudioLines size={23} />
          </span>
          <span>
            Zaalgeluid
            <span className="brand-caption">JOUW AUDIO. JOUW ZAAL.</span>
          </span>
        </a>
        <div className="header-meta">
          <span className="local-label">
            <ShieldCheck size={15} /> Lokaal netwerk
          </span>
          {role && (
            <span className={cn("connection-tag", connected && "is-connected")}>
              {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
              {role}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

function Home() {
  return (
    <>
      <Header />
      <main className="welcome page-width">
        <div className="eyebrow">VANAF DE ZAAL, RECHTSTREEKS NAAR DE PA</div>
        <h1>
          Het juiste geluid.
          <br />
          Op jouw moment.
        </h1>
        <p className="lead">
          Je pc speelt af. Jij bedient vanaf je tablet.
          <br />
          Alles blijft op je eigen netwerk.
        </p>
        <div className="role-options">
          <a className="role-option" href="/player">
            <span className="role-icon">
              <Monitor />
            </span>
            <div>
              <h2>Deze pc speelt af</h2>
              <p>
                Verbind met de PA, voeg audio toe
                <br />
                en koppel je tablet.
              </p>
            </div>
            <span className="role-link">
              Afspeler openen <ChevronRight size={18} />
            </span>
          </a>
          <a className="role-option" href="/control">
            <span className="role-icon">
              <Smartphone />
            </span>
            <div>
              <h2>Dit apparaat bedient</h2>
              <p>
                Start en stop fragmenten vanaf
                <br />
                elke plek in de zaal.
              </p>
            </div>
            <span className="role-link">
              Bediening openen <ChevronRight size={18} />
            </span>
          </a>
        </div>
        <p className="welcome-note">
          <Link2 size={17} /> Verbind beide apparaten met hetzelfde netwerk.
        </p>
      </main>
      <Footer />
    </>
  );
}

function Footer() {
  return (
    <footer className="footer page-width">
      <span>
        <AudioLines size={14} /> Zaalgeluid
      </span>
      <span>Audio op de pc. Bediening in de zaal.</span>
    </footer>
  );
}

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.error || data.message || "Dit is niet gelukt. Probeer het opnieuw.",
    );
  return data as T;
}

function Pairing({ onPaired }: { onPaired: (token: string) => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function pair(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      }).then(responseData<{ token: string }>);
      sessionStorage.setItem("zaalgeluid-controller", data.token);
      onPaired(data.token);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "De pc is niet bereikbaar.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header role="Bediening" />
      <main className="pairing-page">
        <a href="/" className="back-link">
          <ArrowLeft size={16} /> Terug
        </a>
        <div className="pairing-icon">
          <Smartphone size={30} />
        </div>
        <div className="eyebrow">BEDIENING KOPPELEN</div>
        <h1>Neem de bediening over.</h1>
        <p>
          Vul de 6-cijferige koppelcode in die op het afspelerscherm van de pc
          staat.
        </p>
        <form onSubmit={pair}>
          <label htmlFor="pairing-code">Koppelcode</label>
          <Input
            id="pairing-code"
            className="pin-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            value={pin}
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            required
            autoFocus
            aria-describedby={error ? "pair-error" : undefined}
          />
          <Button
            className="pair-submit"
            type="submit"
            disabled={pin.length !== 6 || busy}
          >
            {busy ? <LoaderCircle className="spin" /> : <Link2 />}{" "}
            {busy ? "Verbinden…" : "Verbind met de afspeler"}
          </Button>
          {error && (
            <p className="error-note" id="pair-error" role="alert">
              {error}
            </p>
          )}
        </form>
        <div className="pairing-hint">
          <Wifi size={18} />
          <span>De pc en dit apparaat moeten op hetzelfde netwerk zitten.</span>
        </div>
      </main>
    </>
  );
}

export default function App() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupError, setSetupError] = useState("");
  const [controllerToken, setControllerToken] = useState(() =>
    sessionStorage.getItem("zaalgeluid-controller"),
  );
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!isPlayer) return;
    let cancelled = false;
    fetch("/api/setup", { signal: AbortSignal.timeout(5000) })
      .then(responseData<Setup>)
      .then((value) => {
        if (!cancelled) {
          setSetup(value);
          setSetupError("");
        }
      })
      .catch((cause) => {
        if (!cancelled)
          setSetupError(
            cause instanceof Error
              ? cause.message
              : "De lokale server is niet bereikbaar.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [generation]);
  const invalidSession = useCallback(() => {
    if (isPlayer) {
      setSetup(null);
      setGeneration((value) => value + 1);
    } else {
      sessionStorage.removeItem("zaalgeluid-controller");
      setControllerToken(null);
    }
  }, []);
  if (!isPlayer && !isControl) return <Home />;
  if (isControl && !controllerToken)
    return <Pairing onPaired={setControllerToken} />;
  if (isPlayer && !setup)
    return (
      <>
        <Header role="Afspeler" />
        <main className="setup-loading">
          <Monitor size={36} />
          <h1>
            {setupError
              ? "Open de afspeler op de pc."
              : "Afspeler voorbereiden…"}
          </h1>
          <p>{setupError || "Verbinding maken met de lokale server."}</p>
          {setupError && (
            <>
              <p>
                Gebruik op de PA-pc{" "}
                <a href={`http://localhost:${location.port || "3000"}/player`}>
                  localhost:{location.port || "3000"}/player
                </a>
                .
              </p>
              <Button
                variant="outline"
                onClick={() => setGeneration((value) => value + 1)}
              >
                Opnieuw proberen
              </Button>
              <a className="back-link" href="/control">
                Naar de bediening <ChevronRight size={16} />
              </a>
            </>
          )}
        </main>
      </>
    );
  return (
    <Session
      key={isPlayer ? setup!.token : controllerToken!}
      token={isPlayer ? setup!.token : controllerToken!}
      setup={setup}
      onInvalidSession={invalidSession}
    />
  );
}

function Session({
  token,
  setup,
  onInvalidSession,
}: {
  token: string;
  setup: Setup | null;
  onInvalidSession: () => void;
}) {
  const { state, connection, command, enable, error, clearError } = useRoom(
    token,
    isPlayer ? "player" : "controller",
    onInvalidSession,
  );
  const [activating, setActivating] = useState(false);
  const online = connection === "connected";
  const ready = online && state.playerOnline && state.playback.ready;
  const current = state.tracks.find(
    (track) => track.id === state.playback.trackId,
  );
  const reason = !online
    ? "De verbinding wordt hersteld. Opdrachten zijn tijdelijk uitgeschakeld."
    : !state.playerOnline
      ? "Open de afspeler op de PA-pc om te beginnen."
      : !state.playback.ready
        ? "Klik op de pc op ‘Audio activeren’ om de bediening vrij te geven."
        : !current
          ? "Kies hieronder een fragment om te beginnen."
          : "";
  async function activate() {
    setActivating(true);
    try {
      await enable();
    } finally {
      setActivating(false);
    }
  }

  return (
    <>
      <Header connected={online} role={isPlayer ? "Afspeler" : "Bediening"} />
      <main className="page-width workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              {isPlayer ? "AFSPELER · PA-PC" : "BEDIENING · OP AFSTAND"}
            </div>
            <h1>
              {isPlayer ? "Klaar voor jouw moment." : "Jij hebt de regie."}
            </h1>
            <p>
              {isPlayer
                ? "Voeg fragmenten toe en bedien het geluid vanuit de zaal."
                : "Het geluid speelt af op de pc die met de PA is verbonden."}
            </p>
          </div>
          {isPlayer ? (
            <Button variant="outline" asChild>
              <a href="/control" target="_blank" rel="noreferrer">
                <Smartphone /> Bediening openen <ArrowUpRight />
              </a>
            </Button>
          ) : (
            <Button variant="ghost" onClick={onInvalidSession}>
              <Link2 /> Ontkoppelen
            </Button>
          )}
        </div>
        {connection === "busy" ? (
          <div className="notice warning" role="alert">
            <Monitor />
            <div>
              <strong>Er is al een afspeler actief.</strong>
              <p>
                Gebruik het andere afspelertabblad op deze pc, of sluit dat
                tabblad en vernieuw deze pagina.
              </p>
            </div>
            <Button variant="outline" onClick={() => location.reload()}>
              Opnieuw proberen
            </Button>
          </div>
        ) : (
          !online && (
            <div className="notice warning" role="status">
              <WifiOff />
              <div>
                <strong>
                  {connection === "connecting"
                    ? "Verbinding maken…"
                    : "Verbinding onderbroken"}
                </strong>
                <p>
                  {isPlayer
                    ? "Audio is gestopt. Na herstel kun je de audio opnieuw activeren."
                    : "Opdrachten staan uit totdat de verbinding terug is. Audio op de pc kan doorspelen."}
                </p>
              </div>
              <LoaderCircle className="spin" />
            </div>
          )
        )}
        {(error || state.playback.error) && (
          <div className="notice error" role="alert">
            <CircleHelp />
            <p>{error || state.playback.error}</p>
            {error && (
              <Button
                variant="ghost"
                size="icon"
                onClick={clearError}
                aria-label="Melding sluiten"
              >
                <X />
              </Button>
            )}
          </div>
        )}
        <div className={cn("console-grid", !isPlayer && "controller-grid")}>
          <div className="main-column">
            {isPlayer && !state.playback.ready && connection !== "busy" && (
              <section className="activation">
                <div className="activation-icon">
                  <Headphones size={23} />
                </div>
                <div>
                  <h2>Geef deze pc toestemming om af te spelen</h2>
                  <p>
                    Eenmalig activeren, daarna bedien je alles vanaf je tablet.
                  </p>
                </div>
                <Button
                  disabled={!online || activating}
                  onClick={() => void activate()}
                >
                  {activating ? <LoaderCircle className="spin" /> : <Radio />}{" "}
                  {activating ? "Activeren…" : "Audio activeren"}
                </Button>
              </section>
            )}
            <Transport
              playback={state.playback}
              current={current}
              ready={ready}
              reason={reason}
              command={command}
            />
            <Library
              tracks={state.tracks}
              selectedId={state.playback.trackId}
              token={token}
              ready={ready}
              online={online}
              command={command}
            />
          </div>
          {isPlayer && setup && (
            <aside className="side-column">
              <ConnectionPanel
                setup={setup}
                controllerCount={state.controllerCount}
              />
              <section className="output-note">
                <Headphones size={20} />
                <div>
                  <h3>Geluid via deze pc</h3>
                  <p>
                    Kies je PA of audio-interface als geluidsuitvoer in Windows.
                    Houd deze pagina open en voorkom dat de pc in slaapstand
                    gaat.
                  </p>
                </div>
              </section>
            </aside>
          )}
        </div>
        <div className="workspace-bottom">
          <span>
            <span className={cn("status-dot", ready && "live")} />
            {ready
              ? "Afspeler verbonden en audio geactiveerd"
              : "Afspeler nog niet gereed"}
          </span>
          <span>
            <ShieldCheck size={14} /> Blijft op je lokale netwerk
          </span>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Transport({
  playback,
  current,
  ready,
  reason,
  command,
}: {
  playback: Playback;
  current?: Track;
  ready: boolean;
  reason: string;
  command: (command: Command) => void;
}) {
  const [dragVolume, setDragVolume] = useState<number | null>(null);
  const [dragSeek, setDragSeek] = useState<number | null>(null);
  const previousVolume = useRef(0.75);
  const enabled = ready && !!current;
  const playing = playback.status === "playing";
  const volume = dragVolume ?? Math.round(playback.volume * 100);
  const position = dragSeek ?? playback.currentTime;
  const changeVolume = (value: number) => {
    command({ action: "volume", value: value / 100 });
  };
  return (
    <section className="transport panel" aria-label="Audiobediening">
      <div className="transport-top">
        <span className="section-label">NU IN DE AFSPELER</span>
        <span className={cn("playback-status", playing && "playing")}>
          <span className={cn("status-dot", playing && "live")} />
          {!ready ? "Wacht op afspeler" : labels[playback.status]}
        </span>
      </div>
      <div className="track-display">
        <span className={cn("track-art", playing && "active")}>
          <AudioLines size={34} strokeWidth={1.4} />
        </span>
        <h2>{current?.name || "Nog even stil."}</h2>
        <p>
          {current
            ? current.filename
            : isPlayer
              ? "Voeg audio toe en kies een fragment om klaar te zetten."
              : "Kies een fragment zodra de afspeler klaarstaat."}
        </p>
        {isPlayer && current && (
          <Button
            variant="ghost"
            size="sm"
            className="clear-selection"
            disabled={!enabled || playing || playback.status === "loading"}
            onClick={() => command({ action: "clear" })}
          >
            <X size={12} /> Selectie wissen
          </Button>
        )}
      </div>
      <div className="timeline">
        <Slider
          aria-label="Afspeelpositie"
          value={[Math.min(position, playback.duration || 0)]}
          min={0}
          max={playback.duration || 1}
          step={0.1}
          disabled={!enabled || !playback.duration}
          onValueChange={(value) => setDragSeek(value[0])}
          onValueCommit={(value) => {
            command({ action: "seek", value: value[0] });
            setDragSeek(null);
          }}
        />
        <div className="time-labels">
          <span>{formatTime(position)}</span>
          <span>{formatTime(playback.duration)}</span>
        </div>
      </div>
      <div className="transport-buttons">
        <Button
          className="play-button"
          disabled={!enabled}
          onClick={() => command({ action: playing ? "pause" : "play" })}
        >
          {playing ? (
            <Pause fill="currentColor" />
          ) : (
            <Play fill="currentColor" />
          )}
          {playing
            ? "Pauzeren"
            : playback.status === "paused"
              ? "Hervatten"
              : "Afspelen"}
        </Button>
        <Button
          variant="outline"
          className="stop-button"
          disabled={!enabled}
          onClick={() => command({ action: "stop" })}
        >
          <Square size={18} fill="currentColor" /> Stoppen
        </Button>
        <Button
          variant="outline"
          className="restart-button"
          disabled={!enabled}
          onClick={() => command({ action: "restart" })}
        >
          <RotateCcw /> Opnieuw
        </Button>
      </div>
      {reason && <p className="control-hint">{reason}</p>}
      <div className="volume-section">
        <div className="volume-heading">
          <label id="volume-label">Uitvoervolume</label>
          <span>
            {volume}
            <small>%</small>
          </span>
        </div>
        <div className="volume-controls">
          <Button
            size="icon"
            variant="ghost"
            disabled={!ready}
            aria-label={playback.volume === 0 ? "Geluid aan" : "Geluid dempen"}
            onClick={() => {
              if (playback.volume > 0) {
                previousVolume.current = playback.volume;
                command({ action: "volume", value: 0 });
              } else
                command({ action: "volume", value: previousVolume.current });
            }}
          >
            {volume === 0 ? <VolumeX /> : <Volume1 />}
          </Button>
          <Slider
            aria-labelledby="volume-label"
            value={[volume]}
            max={100}
            step={1}
            disabled={!ready}
            onValueChange={(value) => {
              setDragVolume(value[0]);
              changeVolume(value[0]);
            }}
            onValueCommit={() => setDragVolume(null)}
          />
          <Volume2 size={20} className="volume-max" />
        </div>
      </div>
    </section>
  );
}

function Library({
  tracks,
  selectedId,
  token,
  ready,
  online,
  command,
}: {
  tracks: Track[];
  selectedId: string | null;
  token: string;
  ready: boolean;
  online: boolean;
  command: (command: Command) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      for (const file of Array.from(files)) {
        if (file.size > 500 * 1024 * 1024)
          throw new Error(`${file.name} is groter dan 500 MB.`);
        form.append("files", file);
      }
      await fetch("/api/tracks", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      }).then(responseData);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Toevoegen is niet gelukt.",
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }
  async function remove(id: string) {
    setDeleting(id);
    setError("");
    try {
      await fetch(`/api/tracks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).then(responseData);
      setConfirmDelete(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Verwijderen is niet gelukt.",
      );
    } finally {
      setDeleting(null);
    }
  }
  return (
    <section className="library panel">
      <div className="library-heading">
        <div>
          <h2>
            Audiofragmenten <span className="track-count">{tracks.length}</span>
          </h2>
          <p>Tik op een fragment om het klaar te zetten.</p>
        </div>
        {isPlayer && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac,.webm,.opus"
              className="sr-only"
              tabIndex={-1}
              aria-label="Audiobestanden toevoegen"
              onChange={(event) => void upload(event.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={uploading || !online}
            >
              {uploading ? <LoaderCircle className="spin" /> : <Plus />}{" "}
              {uploading ? "Toevoegen…" : "Audio toevoegen"}
            </Button>
          </>
        )}
      </div>
      {error && (
        <p className="library-error" role="alert">
          {error}
        </p>
      )}
      {tracks.length === 0 ? (
        <div className="empty-library">
          <FileAudio2 size={27} strokeWidth={1.5} />
          <h3>Jouw fragmenten, hier bij elkaar.</h3>
          <p>
            {isPlayer
              ? "Voeg een audiobestand van deze pc toe."
              : "Voeg op de PA-pc je eerste audiobestand toe."}
          </p>
          <span>MP3, WAV, M4A en meer · tot 500 MB per bestand</span>
        </div>
      ) : (
        <ul className="track-list">
          {tracks.map((track, index) => (
            <li
              key={track.id}
              className={cn("track-row", track.id === selectedId && "selected")}
            >
              <button
                className="track-select"
                disabled={!ready}
                onClick={() => command({ action: "select", trackId: track.id })}
                aria-label={`${track.name} klaarzetten`}
                aria-pressed={track.id === selectedId}
              >
                <span className="track-number">
                  {track.id === selectedId ? (
                    <AudioLines size={19} />
                  ) : (
                    String(index + 1).padStart(2, "0")
                  )}
                </span>
                <span className="track-info">
                  <strong>{track.name}</strong>
                  <span>
                    {track.filename.split(".").at(-1)?.toUpperCase()}{" "}
                    <span className="file-divider">·</span>{" "}
                    {formatSize(track.size)}
                  </span>
                </span>
                {track.id === selectedId && (
                  <span className="selected-label">
                    <Check size={14} /> Klaargezet
                  </span>
                )}
              </button>
              {isPlayer && (
                <div className="delete-action">
                  {confirmDelete === track.id ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deleting === track.id}
                        onClick={() => void remove(track.id)}
                        aria-label={`${track.name} definitief verwijderen`}
                      >
                        Verwijderen
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Verwijderen annuleren"
                        onClick={() => setConfirmDelete(null)}
                      >
                        <X />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={track.id === selectedId || !online}
                      title={
                        track.id === selectedId
                          ? "Zet eerst een ander fragment klaar om dit bestand te verwijderen."
                          : "Fragment verwijderen"
                      }
                      aria-label={`${track.name} verwijderen`}
                      onClick={() => setConfirmDelete(track.id)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="library-footnote">
        <ShieldCheck size={14} />
        <span>
          {isPlayer
            ? "Bestanden worden op deze pc bewaard."
            : "Alleen de PA-pc speelt audio af."}{" "}
          Een selectie start nooit automatisch.
        </span>
      </div>
    </section>
  );
}

function ConnectionPanel({
  setup,
  controllerCount,
}: {
  setup: Setup;
  controllerCount: number;
}) {
  const [selectedUrl, setSelectedUrl] = useState(setup.urls[0] || "");
  const [copied, setCopied] = useState(false);
  const urlInput = useRef<HTMLInputElement>(null);
  const activeUrl = selectedUrl || setup.urls[0] || "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      urlInput.current?.focus();
      urlInput.current?.select();
    }
  }
  return (
    <section className="connection-panel panel">
      <div className="connection-title">
        <Smartphone size={20} />
        <h2>Koppel je tablet</h2>
      </div>
      <p className="connection-intro">
        De bediening binnen handbereik.
        <br />
        In drie stappen verbonden.
      </p>
      <ol className="connection-steps">
        <li>
          <span>1</span>
          <div>
            <strong>Hetzelfde netwerk</strong>
            <p>Verbind je tablet met de wifi van deze pc.</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <strong>Open de bediening</strong>
            <p>Scan de QR-code met je tablet.</p>
          </div>
        </li>
      </ol>
      {activeUrl ? (
        <>
          <div className="qr-container">
            <QRCodeSVG
              value={activeUrl}
              size={140}
              level="M"
              marginSize={0}
              title="Scan om de bediening op je tablet te openen"
            />
          </div>
          <div className="address-field">
            <Input
              ref={urlInput}
              value={activeUrl}
              readOnly
              aria-label="Adres voor de tablet"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void copy()}
              aria-label="Tabletadres kopiëren"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>
          {setup.urls.length > 1 && (
            <details className="network-options">
              <summary>Ander netwerkadres kiezen</summary>
              {setup.urls.map((url) => (
                <button
                  key={url}
                  onClick={() => setSelectedUrl(url)}
                  className={cn(activeUrl === url && "chosen")}
                >
                  {url} {activeUrl === url && <Check size={13} />}
                </button>
              ))}
            </details>
          )}
        </>
      ) : (
        <p className="no-network">
          Geen lokaal netwerkadres gevonden. Verbind de pc met wifi of een
          netwerkkabel en vernieuw de pagina.
        </p>
      )}
      <ol className="connection-steps last-step" start={3}>
        <li>
          <span>3</span>
          <div>
            <strong>Vul de koppelcode in</strong>
            <p>Deze code verschijnt alleen op de pc.</p>
          </div>
        </li>
      </ol>
      <div className="pairing-code" aria-label={`Koppelcode ${setup.pin}`}>
        <span>{setup.pin.slice(0, 3)}</span>
        <span>{setup.pin.slice(3)}</span>
      </div>
      <div className={cn("tablet-status", controllerCount > 0 && "connected")}>
        <span className={cn("status-dot", controllerCount > 0 && "live")} />
        {controllerCount > 0
          ? `${controllerCount} ${controllerCount === 1 ? "bediening verbonden" : "bedieningen verbonden"}`
          : "Wacht op je tablet"}
      </div>
    </section>
  );
}
