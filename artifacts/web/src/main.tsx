import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initPortalMode } from "./lib/portal-mode";

// Before anything renders: is this tab the VS2000 Writers app?
initPortalMode();

// Register Service Worker for PWA
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js")
      .then((reg) => console.log("Service Worker registered successfully:", reg.scope))
      .catch((err) => console.error("Service Worker registration failed:", err));
  });
}

createRoot(document.getElementById("root")!).render(<App />);
