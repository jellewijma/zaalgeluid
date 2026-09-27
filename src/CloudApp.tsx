import { useCallback, useRef, useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowLeft, KeyRound, Link2, LoaderCircle, LogOut, ShieldCheck, Smartphone, UserRound } from "lucide-react";
import { AlertDialog } from "radix-ui";
import { Header, Home, PlayerConsole } from "./App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabletController } from "@/components/tablet-controller";
import { useCloudRoom } from "@/hooks/use-cloud-room";
import { appPath, appRoute } from "@/lib/paths";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

// A tablet may control different accounts in the same browser. Never reuse one
// account's controller capability when opening another account's pairing link.
const roomId = new URLSearchParams(location.search).get("room") || undefined;
const controllerKey = appPath("zaalgeluid-cloud-controller") + (roomId ? `:${roomId}` : "");

function oauthError() {
  const params = new URLSearchParams(location.search);
  if (!params.has("error") && !params.has("error_description")) return "";
  return params.get("error") === "access_denied"
    ? "De Google-aanmelding is geannuleerd. Je kunt het opnieuw proberen."
    : "Aanmelden met Google is niet gelukt. Probeer het opnieuw.";
}

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
  if (isLoading) return <><Header cloud role="Afspeler" /><main className="setup-loading"><LoaderCircle className="spin" /><h1>Aanmelding controleren…</h1></main></>;
  if (!isAuthenticated) return <OwnerLogin notice={notice} />;
  return <CloudPlayer onInvalidSession={sessionExpired} onPasswordChanged={() => setNotice("Je wachtwoord is gewijzigd. Meld je aan met je nieuwe wachtwoord.")} />;
}

function OwnerLogin({ notice }: { notice: string }) {
  const { signIn } = useAuthActions();
  const methods = useQuery(api.account.authMethods, {});
  const [username, setUsername] = useState("jelle");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"google" | "password" | "guest" | null>(null);
  const loginPending = useRef(false);
  const [error, setError] = useState(oauthError);
  const [passwordExpanded, setPasswordExpanded] = useState(false);
  async function googleLogin() {
    if (loginPending.current || !methods?.google) return;
    loginPending.current = true;
    setBusy("google");
    setError("");
    const url = new URL(location.href);
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    try {
      const result = await signIn("google", { redirectTo: location.origin + appPath("/player") });
      if (!result.redirect) {
        setError("Aanmelden met Google is niet gelukt. Probeer het opnieuw.");
        loginPending.current = false;
        setBusy(null);
      }
    } catch {
      setError("Aanmelden met Google is niet gelukt. Controleer je internetverbinding en probeer het opnieuw.");
      loginPending.current = false;
      setBusy(null);
    }
  }
  async function guestLogin() {
    if (loginPending.current || !methods?.guest) return;
    loginPending.current = true;
    setBusy("guest");
    setError("");
    try {
      const result = await signIn("anonymous");
      if (!result.signingIn) throw new Error("Geen gastaanmelding ontvangen.");
    } catch {
      setError("Aanmelden als gast is niet gelukt. Controleer je internetverbinding en probeer het opnieuw.");
      loginPending.current = false;
      setBusy(null);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loginPending.current) return;
    loginPending.current = true;
    setBusy("password");
    setError("");
    try {
      await signIn("password", { email: username.trim(), password, flow: "signIn" });
    } catch {
      setError("Aanmelden is niet gelukt. Controleer je gebruikersnaam en wachtwoord, en probeer het opnieuw.");
    } finally { loginPending.current = false; setBusy(null); }
  }
  return <>
    <Header cloud role="Afspeler" />
    <main className="pairing-page owner-login">
      <a href={appPath("/")} className="back-link"><ArrowLeft size={16} /> Terug</a>
      <h1>Aanmelden</h1>
      {notice && <p className="account-notice" role="status">{notice}</p>}
      <div className="login-options">
        {methods === undefined ? <p className="login-method-status" role="status"><LoaderCircle size={16} className="spin" /> Aanmeldopties laden…</p> : methods.google ?
          <Button className="google-login" variant="outline" disabled={busy !== null} onClick={() => void googleLogin()} aria-describedby={error ? "login-error" : undefined}>
            {/* Asset: https://developers.google.com/identity/branding-guidelines */}
            <img src={appPath("/google-g.png")} alt="" width={20} height={20} />
            {busy === "google" ? "Google openen…" : "Doorgaan met Google"}
          </Button>
        : <p className="login-method-status" role="status">Google-aanmelding wordt nog ingesteld.</p>}
        {methods?.guest && <div className="guest-login-option">
          <Button className="guest-login" variant="outline" disabled={busy !== null} onClick={() => void guestLogin()} aria-describedby={error ? "guest-login-help login-error" : "guest-login-help"}>
            {busy === "guest" ? <LoaderCircle className="spin" /> : <UserRound />}
            {busy === "guest" ? "Gastafspeler openen…" : "Doorgaan als gast"}
          </Button>
          <p id="guest-login-help" className="login-method-help">De gastbibliotheek hoort bij deze browser. Na afmelden, wissen van browsergegevens of een verlopen sessie verlies je de toegang. Google heeft een aparte bibliotheek met blijvende toegang.</p>
        </div>}
        {error && <p id="login-error" className="error-note" role="alert">{error}</p>}
        {methods?.password && <details className="password-login" open={passwordExpanded || !methods.google} onToggle={event => setPasswordExpanded(event.currentTarget.open)}>
          <summary>Aanmelden met wachtwoord</summary>
          <form onSubmit={event => void submit(event)}>
            <div className="account-field"><label htmlFor="owner-username">Gebruikersnaam</label><Input id="owner-username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required maxLength={100} disabled={busy !== null} /></div>
            <div className="account-field"><label htmlFor="owner-password">Wachtwoord</label><Input id="owner-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required maxLength={200} disabled={busy !== null} aria-describedby={error ? "login-error" : undefined} /></div>
            <Button className="pair-submit" variant="outline" type="submit" disabled={busy !== null || !username.trim() || !password}>{busy === "password" ? <LoaderCircle className="spin" /> : <KeyRound />}{busy === "password" ? "Aanmelden…" : "Aanmelden"}</Button>
          </form>
        </details>}
      </div>
      <div className="pairing-hint"><Smartphone size={18} /><span>Koppel na aanmelden je tablet via de QR-code of tabletlink.</span></div>
      <p className="privacy-link"><a href={appPath("/privacy")}>Privacy en je gegevens</a></p>
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
      const result = await pair({ pin, token, ...(roomId ? { roomId } : {}) });
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
      <h1>Tablet koppelen</h1>
      <p>{roomId ? "Vul de 6-cijferige koppelcode van de pc in." : "Scan de QR-code op de pc, open de tabletlink of vul hieronder je koppelcode in."}</p>
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
  const account = useQuery(api.account.current, {});
  const changePassword = useAction(api.account.changePassword);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmGuestLogout, setConfirmGuestLogout] = useState(false);
  const logoutPending = useRef(false);
  async function logout() {
    if (logoutPending.current || busy) return;
    logoutPending.current = true;
    setBusy(true);
    setError("");
    try { await signOut(); }
    catch { setError("Afmelden is niet gelukt. Probeer het opnieuw."); }
    finally { logoutPending.current = false; setBusy(false); }
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
    <div className="account-heading"><span><ShieldCheck size={16} /><span>{account?.isGuest ? "Aangemeld als gast" : account ? `Aangemeld als ${account.name || account.email || "gebruiker"}` : "Aangemeld"}</span></span>
      {account?.isGuest ? <AlertDialog.Root open={confirmGuestLogout} onOpenChange={open => { if (!busy) setConfirmGuestLogout(open); }}>
        <AlertDialog.Trigger asChild><Button size="sm" variant="ghost" disabled={busy}><LogOut /> Afmelden</Button></AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="guest-logout-overlay" />
          <AlertDialog.Content className="guest-logout-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
            <AlertDialog.Title>Afmelden als gast?</AlertDialog.Title>
            <AlertDialog.Description>Je verliest de toegang tot deze gastbibliotheek en afspeler. Een volgende gastaanmelding begint met een lege bibliotheek.</AlertDialog.Description>
            {error && <p className="error-note" role="alert">{error}</p>}
            <div className="guest-logout-actions">
              <AlertDialog.Cancel asChild><Button variant="outline" disabled={busy}>Annuleren</Button></AlertDialog.Cancel>
              <AlertDialog.Action asChild><Button variant="destructive" disabled={busy} onClick={event => { event.preventDefault(); void logout(); }}>{busy && <LoaderCircle className="spin" />}{busy ? "Afmelden…" : "Afmelden als gast"}</Button></AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root> : <Button size="sm" variant="ghost" disabled={busy || !account} onClick={() => void logout()}><LogOut /> Afmelden</Button>}
    </div>
    {account?.isGuest && <p className="account-help">De gastbibliotheek hoort bij deze browser. Na afmelden, wissen van browsergegevens of een verlopen sessie verlies je de toegang.</p>}
    {account?.canChangePassword && !account.isGuest && <details><summary>Wachtwoord wijzigen</summary>
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
    </details>}
    {error && !confirmGuestLogout && <p className="error-note" role="alert">{error}</p>}
  </section>;
}
