import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "@/components/error-boundary";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

// Register the service worker so Nebula can be installed as a PWA on the phone. It does no caching
// (network passthrough), so it can never serve a stale app shell.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* installability is best-effort */ });
  });
}
