import { createRoot } from "react-dom/client";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import App from "./App";
import CloudApp from "./CloudApp";
import { appPath } from "./lib/paths";
import "./index.css";

const cloud = import.meta.env.VITE_APP_MODE === "cloud";
const convexUrl = import.meta.env.VITE_CONVEX_URL;
let convex: ConvexReactClient | null = null;
if (cloud && convexUrl) {
  try { convex = new ConvexReactClient(convexUrl); }
  catch { /* Show a usable error page below when the deployment URL is invalid. */ }
}

createRoot(document.getElementById("root")!).render(
  !cloud ? <App /> : convex ? (
    <ConvexAuthProvider client={convex} storageNamespace={`${convexUrl}${appPath("/")}`}>
      <CloudApp />
    </ConvexAuthProvider>
  ) : (
    <main className="setup-loading" role="alert">
      <h1>De afspeler is nog niet beschikbaar.</h1>
      <p>De online verbinding is nog niet ingesteld. Probeer het later opnieuw.</p>
      <a href={appPath("/")}>Pagina opnieuw openen</a>
    </main>
  ),
);
