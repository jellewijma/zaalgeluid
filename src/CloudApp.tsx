import { useCallback, useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import { ArrowLeft, KeyRound, Link2, LoaderCircle, LogOut, Monitor, ShieldCheck, Smartphone } from "lucide-react";
import { Header, Home, PlayerConsole } from "./App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabletController } from "@/components/tablet-controller";
import { useCloudRoom } from "@/hooks/use-cloud-room";
import { appPath, appRoute } from "@/lib/paths";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const controllerKey = appPath("zaalgeluid-cloud-controller");

export default function CloudApp() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const [token, setToken] = useState(() => sessionStorage.getItem(controllerKey));
  const [notice, setNotice] = useState("");
  const route = appRoute();
  const disconnect = useCallback(() => {
    sessionStorage.removeItem(controllerKey);
    setToken(null);
  }, []);
  const sessionExpired = useCallback(() => {
    setNotice("Je sessie is verlopen. Meld je opnieuw aan.");
    void signOut().catch(() => setNotice("Je sessie is verlopen. Vernieuw de pagina om opnieuw aan te melden."));
  }, [signOut]);
  if (route === "/control") {
    return token
      ? <CloudController token={token} onDisconnect={disconnect} />
      : <CloudPairing onPaired={setToken} />;
  }
  if (route !== "/player") return <Home cloud />;
  if (isLoading) return <><Header cloud role="Afspeler" /><main className="setup-loading"><LoaderCircle className="spin" /><h1>Afspeler voorbereiden…</h1><p>Je aanmelding wordt gecontroleerd.</p></main></>;
  if (!isAuthenticated) return <OwnerLogin notice={notice} />;
  return <CloudPlayer onInvalidSession={sessionExpired} onPasswordChanged={() => setNotice("Je wachtwoord is gewijzigd. Meld je aan met je nieuwe wachtwoord.")} />;
}

function OwnerLogin({ notice }: { notice: string }) {
  const { signIn } = useAuthActions();
  const [username, setUsername] = useState("jelle");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await signIn("password", { email: username.trim(), password, flow: "signIn" });
    } catch {
      setError("Aanmelden is niet gelukt. Controleer je gebruikersnaam en wachtwoord, en probeer het opnieuw.");
    } finally { setBusy(false); }
  }
  return <>
    <Header cloud role="Afspeler" />
    <main className="pairing-page owner-login">
      <a href={appPath("/")} className="back-link"><ArrowLeft size={16} /> Terug</a>
      <div className="pairing-icon"><Monitor size={30} /></div>
      <div className="eyebrow">JOUW AFSPELER</div>
      <h1>Meld je aan op de pc.</h1>
      <p>Open je liedjes en effecten. Daarna koppel je de tablet met de code op het scherm.</p>
      {notice && <p className="account-notice" role="status">{notice}</p>}
      <form onSubmit={event => void submit(event)}>
        <div className="account-field"><label htmlFor="owner-username">Gebruikersnaam</label><Input id="owner-username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required maxLength={100} disabled={busy} /></div>
        <div className="account-field"><label htmlFor="owner-password">Wachtwoord</label><Input id="owner-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={200} disabled={busy} aria-describedby={error ? "login-error" : undefined} /></div>
        <Button className="pair-submit" type="submit" disabled={busy || !username.trim() || !password}>{busy ? <LoaderCircle className="spin" /> : <KeyRound />}{busy ? "Aanmelden…" : "Aanmelden"}</Button>
        {error && <p id="login-error" className="error-note" role="alert">{error}</p>}
      </form>
      <div className="pairing-hint"><Smartphone size={18} /><span>Gebruik op je tablet <a href={appPath("/control")}>de bediening</a>. Daar is alleen de koppelcode nodig.</span></div>
    </main>
  </>;
}

function CloudPairing({ onPaired }: { onPaired: (token: string) => void }) {
  const pair = useMutation(api.rooms.pair);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
      const result = await pair({ pin, token });
      if (!result.ok) {
        setError(result.error || "De koppelcode is onjuist of verlopen. Vernieuw de code op de pc en probeer het opnieuw.");
        return;
      }
      sessionStorage.setItem(controllerKey, token);
      onPaired(token);
    } catch {
      setError("Koppelen is niet gelukt. Controleer de code op de pc. Is de code verlopen? Vernieuw hem op de pc en probeer het opnieuw.");
    } finally { setBusy(false); }
  }
  return <>
    <Header cloud role="Bediening" />
    <main className="pairing-page">
      <a href={appPath("/")} className="back-link"><ArrowLeft size={16} /> Terug</a>
      <div className="pairing-icon"><Smartphone size={30} /></div>
      <div className="eyebrow">BEDIENING KOPPELEN</div>
      <h1>Neem de bediening over.</h1>
      <p>Vul de 6-cijferige koppelcode in die op het afspelerscherm van de pc staat.</p>
      <form onSubmit={event => void submit(event)}>
        <label htmlFor="pairing-code">Koppelcode</label>
        <Input id="pairing-code" className="pin-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} placeholder="000000" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} required autoFocus disabled={busy} aria-describedby={error ? "pair-error" : undefined} />
        <Button className="pair-submit" type="submit" disabled={pin.length !== 6 || busy}>{busy ? <LoaderCircle className="spin" /> : <Link2 />}{busy ? "Verbinden…" : "Verbind met de afspeler"}</Button>
        {error && <p className="error-note" id="pair-error" role="alert">{error}</p>}
      </form>
      <div className="pairing-hint"><ShieldCheck size={18} /><span>Houd de afspeler op de pc open. Beide apparaten hebben internet nodig.</span></div>
    </main>
  </>;
}

function CloudController({ token, onDisconnect }: { token: string; onDisconnect: () => void }) {
  const room = useCloudRoom({ role: "controller", token, onInvalidSession: onDisconnect });
  return <TabletController {...room} onDisconnect={onDisconnect} />;
}

function CloudPlayer({ onInvalidSession, onPasswordChanged }: { onInvalidSession: () => void; onPasswordChanged: () => void }) {
  const room = useCloudRoom({ role: "player", onInvalidSession });
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const finishUpload = useMutation(api.files.finishUpload);
  const remove = useMutation(api.files.remove);
  const revokeControllers = useMutation(api.rooms.revokeControllers);
  async function upload(files: File[], kind: "music" | "effect") {
    let completed = 0;
    for (const file of files) {
      try {
        const uploadUrl = await generateUploadUrl({});
        const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        if (!response.ok) throw new Error("Upload mislukt.");
        const { storageId } = await response.json() as { storageId: Id<"_storage"> };
        await finishUpload({ storageId, name: file.name.replace(/\.[^.]+$/, ""), filename: file.name, kind });
        completed++;
      } catch {
        throw new Error(`De toevoeging van ${file.name} kon niet worden bevestigd. ${completed > 0 ? `${completed} van de ${files.length} bestanden zijn al opgeslagen. ` : ""}Controleer de lijst en probeer de ontbrekende bestanden opnieuw.`);
      }
    }
  }
  async function removeTrack(id: string) {
    try { await remove({ trackId: id }); }
    catch { throw new Error("Verwijderen is niet gelukt. Haal het bestand uit de afspeellijst en wis de selectie, of stop het effect. Probeer het daarna opnieuw."); }
  }
  return <PlayerConsole {...room} token="" cloud onUpload={upload} onRemove={removeTrack} revokeControllers={async () => { await revokeControllers({}); }} account={<AccountControls onPasswordChanged={onPasswordChanged} />} />;
}

function AccountControls({ onPasswordChanged }: { onPasswordChanged: () => void }) {
  const { signOut } = useAuthActions();
  const changePassword = useAction(api.account.changePassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try { await signOut(); }
    catch { setError("Afmelden is niet gelukt. Probeer het opnieuw."); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (newPassword !== confirmation) { setError("De nieuwe wachtwoorden zijn niet hetzelfde."); return; }
    if (newPassword === currentPassword) { setError("Kies een ander wachtwoord dan je huidige wachtwoord."); return; }
    setBusy(true);
    let passwordChanged = false;
    try {
      await changePassword({ currentPassword, newPassword });
      passwordChanged = true;
      onPasswordChanged();
      await signOut();
    } catch { setError(passwordChanged ? "Je wachtwoord is gewijzigd. Vernieuw de pagina en meld je opnieuw aan." : "Het wachtwoord kon niet worden gewijzigd. Controleer je huidige wachtwoord en probeer het opnieuw."); }
    finally { setBusy(false); }
  }
  return <section className="account-panel" aria-label="Je account">
    <div className="account-heading"><span><ShieldCheck size={16} /> Aangemeld als Jelle</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => void logout()}><LogOut /> Afmelden</Button></div>
    <details><summary>Wachtwoord wijzigen</summary>
      <form onSubmit={event => void submit(event)}>
        <p className="account-help">Gebruik 12 tot 200 tekens. Je wordt daarna op alle apparaten afgemeld en de audio stopt.</p>
        <div className="account-field">
          <label htmlFor="current-password">Huidig wachtwoord</label>
          <Input id="current-password" type="password" autoComplete="current-password"
            value={currentPassword} onChange={event => setCurrentPassword(event.target.value)}
            required maxLength={200} disabled={busy} />
        </div>
        <div className="account-field">
          <label htmlFor="new-password">Nieuw wachtwoord</label>
          <Input id="new-password" type="password" autoComplete="new-password"
            value={newPassword} onChange={event => setNewPassword(event.target.value)}
            required minLength={12} maxLength={200} disabled={busy} />
        </div>
        <div className="account-field">
          <label htmlFor="confirm-password">Herhaal nieuw wachtwoord</label>
          <Input id="confirm-password" type="password" autoComplete="new-password"
            value={confirmation} onChange={event => setConfirmation(event.target.value)}
            required minLength={12} maxLength={200} disabled={busy} />
        </div>
        <Button type="submit" variant="outline" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <KeyRound />} Wachtwoord wijzigen</Button>
      </form>
    </details>
    {error && <p className="error-note" role="alert">{error}</p>}
  </section>;
}
