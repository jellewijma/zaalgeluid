import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AudioLines,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  Headphones,
  Link2,
  LoaderCircle,
  Monitor,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Square,
  SkipBack,
  SkipForward,
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
import { useRoom, type Connection } from "@/hooks/use-room";
import { TabletController } from "@/components/tablet-controller";
import { AudioLibrary } from "@/components/audio-library";
import { appPath, appRoute } from "@/lib/paths";
import { cn, formatTime } from "@/lib/utils";
import type { Command, Playback, RoomState, Setup, Track } from "../shared/protocol";

const labels: Record<Playback["status"], string> = {
  idle: "Klaar voor een fragment",
  loading: "Fragment laden",
  playing: "Speelt af",
  paused: "Gepauzeerd",
  stopped: "Gestopt",
  ended: "Afgelopen",
  error: "Audio controleren",
};
const isPlayer = appRoute() === "/player";
const isControl = appRoute() === "/control";

export function Header({ connected, role, cloud = false }: { connected?: boolean; role?: string; cloud?: boolean }) {
  return (
    <header className="app-header">
      <div className="header-inner">
        <a href={appPath("/")} className="brand" aria-label="Zaalgeluid startpagina">
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
            <ShieldCheck size={15} /> {cloud ? "Privé verbonden" : "Lokaal netwerk"}
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

export function Home({ cloud = false }: { cloud?: boolean }) {
  return (
    <>
      <Header cloud={cloud} />
      <main className="welcome page-width">
        <div className="eyebrow">VANAF DE ZAAL, RECHTSTREEKS NAAR DE PA</div>
        <h1>
          Het juiste geluid.
          <br />
          Op jouw moment.
        </h1>
        <p className="lead">
          {cloud ? "Open de afspeler op de pc en bedien vanaf je tablet." : "Je pc speelt af. Jij bedient vanaf je tablet."}
          <br />
          {cloud ? "Jouw liedjes en effecten, altijd bij de hand." : "Alles blijft op je eigen netwerk."}
        </p>
        <div className="role-options">
          <a className="role-option" href={appPath("/player")}>
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
          <a className="role-option" href={appPath("/control")}>
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
          <Link2 size={17} /> {cloud ? "Meld je aan op de pc. Koppel je tablet met de code op het scherm." : "Verbind beide apparaten met hetzelfde netwerk."}
        </p>
      </main>
      <Footer cloud={cloud} />
    </>
  );
}

export function Footer({ cloud = false }: { cloud?: boolean }) {
  return (
    <footer className="footer page-width">
      <span>
        <AudioLines size={14} /> Zaalgeluid
      </span>
      <span>Audio op de pc. Bediening in de zaal.</span>
      {cloud && <a href={appPath("/privacy")}>Privacy</a>}
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
      const data = await fetch(appPath("/api/pair"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      }).then(responseData<{ token: string }>);
      sessionStorage.setItem(appPath("zaalgeluid-controller"), data.token);
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
        <a href={appPath("/")} className="back-link">
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
    sessionStorage.getItem(appPath("zaalgeluid-controller")),
  );
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!isPlayer) return;
    let cancelled = false;
    fetch(appPath("/api/setup"), { signal: AbortSignal.timeout(5000) })
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
      sessionStorage.removeItem(appPath("zaalgeluid-controller"));
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
                <a href={`http://localhost:${location.port || "3000"}${appPath('/player')}`}>
                  localhost:{location.port || "3000"}{appPath('/player')}
                </a>
                .
              </p>
              <Button
                variant="outline"
                onClick={() => setGeneration((value) => value + 1)}
              >
                Opnieuw proberen
              </Button>
              <a className="back-link" href={appPath("/control")}>
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
  if (!isPlayer) {
    return (
      <TabletController
        state={state}
        connection={connection}
        command={command}
        error={error}
        clearError={clearError}
        onDisconnect={onInvalidSession}
      />
    );
  }
  return <PlayerConsole {...{ state, connection, command, enable, error, clearError, token, setup }} />;
}

interface PlayerConsoleProps {
  state: RoomState;
  connection: Connection;
  command: (command: Command) => void;
  enable: () => Promise<void>;
  error: string | null;
  clearError: () => void;
  token: string;
  setup: (Setup & { pinExpiresAt?: number }) | null;
  cloud?: boolean;
  takeover?: () => Promise<void>;
  refreshPin?: () => Promise<void>;
  revokeControllers?: () => Promise<void>;
  account?: ReactNode;
  onUpload?: (files: File[], kind: "music" | "effect") => Promise<void>;
  onRemove?: (id: string) => Promise<void>;
}

export function PlayerConsole({
  state, connection, command, enable, error, clearError, token, setup,
  cloud = false, takeover, refreshPin, revokeControllers, account, onUpload, onRemove,
}: PlayerConsoleProps) {
  const [activating, setActivating] = useState(false);
  const [takingOver, setTakingOver] = useState(false);
  const [actionError, setActionError] = useState("");
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
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Audio activeren is niet gelukt.");
    } finally {
      setActivating(false);
    }
  }
  async function takeOver() {
    if (!takeover || takingOver) return;
    setTakingOver(true);
    setActionError("");
    try { await takeover(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Overnemen is niet gelukt."); }
    finally { setTakingOver(false); }
  }

  return (
    <>
      <Header connected={online} role="Afspeler" cloud={cloud} />
      <main className="page-width workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              AFSPELER · PA-PC
            </div>
            <h1>
              Klaar voor jouw moment.
            </h1>
            <p>
              Kies je liedjes, zet effecten klaar en bedien het geluid vanuit de zaal.
            </p>
          </div>
          <div className="player-heading-actions">
            <Button variant="outline" asChild disabled={cloud && !setup}>
              <a href={cloud ? setup?.urls[0] : appPath("/control")} aria-disabled={cloud && !setup} target="_blank" rel="noreferrer">
                <Smartphone /> Bediening openen <ArrowUpRight />
              </a>
            </Button>
          </div>
        </div>
        {connection === "busy" ? (
          <div className="notice warning" role="alert">
            <Monitor />
            <div>
              <strong>Er is al een afspeler actief.</strong>
              <p>
                {cloud ? "Gebruik de actieve pc of neem hier de afspeler over. Het geluid op de andere pc stopt zodra die de overname ontvangt." : "Gebruik het andere afspelertabblad op deze pc, of sluit dat tabblad en vernieuw deze pagina."}
              </p>
            </div>
            <Button variant="outline" disabled={takingOver} onClick={takeover ? () => void takeOver() : () => location.reload()}>
              {takeover ? takingOver ? "Overnemen…" : "Afspeler overnemen" : "Opnieuw proberen"}
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
                  {cloud ? "De verbinding wordt hersteld. De bediening is tijdelijk uitgeschakeld." : "Audio is gestopt. Na herstel kun je de audio opnieuw activeren."}
                </p>
              </div>
              <LoaderCircle className="spin" />
            </div>
          )
        )}
        {(actionError || error || state.playback.error) && (
          <div className="notice error" role="alert">
            <CircleHelp />
            <p>{actionError || error || state.playback.error}</p>
            {(actionError || error) && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { setActionError(""); clearError(); }}
                aria-label="Melding sluiten"
              >
                <X />
              </Button>
            )}
          </div>
        )}
        <div className="console-grid">
          <div className="main-column">
            {!state.playback.ready && connection !== "busy" && (
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
              canStop={online && state.playerOnline && (!!current || !!state.playback.effectTrackId)}
              reason={reason}
              command={command}
            />
            <AudioLibrary
              tracks={state.tracks}
              playback={state.playback}
              token={token}
              ready={ready}
              online={online}
              command={command}
              cloud={cloud}
              onUpload={onUpload}
              onRemove={onRemove}
            />
          </div>
          {(setup || account) && (
            <aside className="side-column">
              {setup && <ConnectionPanel
                setup={setup}
                controllerCount={state.controllerCount}
                cloud={cloud}
                refreshPin={refreshPin}
                revokeControllers={revokeControllers}
              />}
              {account}
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
            <ShieldCheck size={14} /> {cloud ? "Privé verbonden met je account" : "Blijft op je lokale netwerk"}
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
  canStop,
  reason,
  command,
}: {
  playback: Playback;
  current?: Track;
  ready: boolean;
  canStop: boolean;
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
  const queueIndex = playback.trackId ? playback.queue.indexOf(playback.trackId) : -1;
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
      {playback.queue.length > 0 && <div className="playlist-transport">
        <Button variant="ghost" size="sm" disabled={!ready || queueIndex <= 0} aria-label="Vorig liedje" onClick={() => command({ action: 'previous' })}><SkipBack /> Vorige</Button>
        <span>{queueIndex >= 0 ? `${queueIndex + 1} van ${playback.queue.length}` : `${playback.queue.length} liedjes klaar`}<small>Afspeellijst · speelt automatisch door</small></span>
        <Button variant="ghost" size="sm" disabled={!ready || queueIndex >= playback.queue.length - 1} aria-label="Volgend liedje" onClick={() => command({ action: 'next' })}>Volgende <SkipForward /></Button>
      </div>}
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
          disabled={!canStop}
          onClick={() => command({ action: "stop" })}
          title="Stopt de muziek en het geluidseffect"
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
          <label id="volume-label">Muziekvolume</label>
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

function ConnectionPanel({
  setup,
  controllerCount,
  cloud = false,
  refreshPin,
  revokeControllers,
}: {
  setup: Setup & { pinExpiresAt?: number };
  controllerCount: number;
  cloud?: boolean;
  refreshPin?: () => Promise<void>;
  revokeControllers?: () => Promise<void>;
}) {
  const [selectedUrl, setSelectedUrl] = useState(setup.urls[0] || "");
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [now, setNow] = useState(Date.now);
  const urlInput = useRef<HTMLInputElement>(null);
  const activeUrl = selectedUrl || setup.urls[0] || "";
  useEffect(() => {
    if (!cloud) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cloud]);
  const remainingSeconds = setup.pinExpiresAt ? Math.max(0, Math.ceil((setup.pinExpiresAt - now) / 1000)) : null;
  async function refresh() {
    if (!refreshPin || refreshing) return;
    setRefreshing(true);
    setRefreshError("");
    try { await refreshPin(); }
    catch (cause) { setRefreshError(cause instanceof Error ? cause.message : "Code vernieuwen is niet gelukt."); }
    finally { setRefreshing(false); }
  }
  async function revoke() {
    if (!revokeControllers || revoking) return;
    setRevoking(true);
    setRefreshError("");
    try { await revokeControllers(); }
    catch { setRefreshError("Ontkoppelen is niet gelukt. Probeer het opnieuw."); }
    finally { setRevoking(false); }
  }
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
            <strong>{cloud ? "Verbind met internet" : "Hetzelfde netwerk"}</strong>
            <p>{cloud ? "Zorg dat de pc en tablet online zijn." : "Verbind je tablet met de wifi van deze pc."}</p>
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
      {cloud && <div className="pairing-expiry">
        <p>{remainingSeconds === null ? "De code is tijdelijk geldig." : remainingSeconds === 0 ? "Deze code is verlopen. Vernieuw de code om te koppelen." : `Nog ${formatTime(remainingSeconds)} geldig`}</p>
        <Button variant="ghost" size="sm" disabled={refreshing || !refreshPin} onClick={() => void refresh()}>
          {refreshing ? <LoaderCircle className="spin" /> : <RotateCcw />}{refreshing ? "Vernieuwen…" : "Vernieuw code"}
        </Button>
        {refreshError && <p className="error-note" role="alert">{refreshError}</p>}
      </div>}
      <div className={cn("tablet-status", controllerCount > 0 && "connected")}>
        <span className={cn("status-dot", controllerCount > 0 && "live")} />
        {controllerCount > 0
          ? `${controllerCount} ${controllerCount === 1 ? "bediening verbonden" : "bedieningen verbonden"}`
          : "Wacht op je tablet"}
      </div>
      {cloud && revokeControllers && <Button className="revoke-controllers" variant="ghost" size="sm" disabled={revoking} onClick={() => void revoke()}><Link2 />{revoking ? "Ontkoppelen…" : "Alle tablets ontkoppelen"}</Button>}
    </section>
  );
}
