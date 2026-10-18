import { createRoot } from "react-dom/client";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import App from "./App";
import CloudApp from "./CloudApp";
import { OAuthCallback } from "./components/oauth-callback";
import { PrivacyPage } from "./components/privacy-page";
import { appPath, appRoute } from "./lib/paths";
import { initializePwa } from "./lib/pwa";
import "./index.css";

const cloud = import.meta.env.VITE_APP_MODE === "cloud";
const privacy = appRoute() === "/privacy";
const convexUrl = import.meta.env.VITE_CONVEX_BACKEND_URL || import.meta.env.VITE_CONVEX_URL;
// Keep the existing namespace when the same accounts move to another backend.
const authStorageNamespace = import.meta.env.VITE_AUTH_STORAGE_NAMESPACE || `${convexUrl}${appPath("/")}`;
let convex: ConvexReactClient | null = null;
if (cloud && convexUrl && !privacy) {
  try { convex = new ConvexReactClient(convexUrl); }
  catch { /* Show a usable error page below when the deployment URL is invalid. */ }
}

if (!initializePwa()) createRoot(document.getElementById("root")!).render(
  privacy ? <PrivacyPage /> : !cloud ? <App /> : convex ? (
    <ConvexAuthProvider client={convex} storageNamespace={authStorageNamespace} shouldHandleCode={false}>
      <OAuthCallback><CloudApp /></OAuthCallback>
    </ConvexAuthProvider>
  ) : (
    <main className="setup-loading" role="alert">
      <h1>De afspeler is nog niet beschikbaar.</h1>
      <p>De online verbinding is nog niet ingesteld. Probeer het later opnieuw.</p>
      <a href={appPath("/")}>Pagina opnieuw openen</a>
    </main>
  ),
);
