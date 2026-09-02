import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./theme.css";
import App from "./App";
import LoginPage from "./pages/LoginPage";
import SitesPage from "./pages/SitesPage";
import SiteFormPage from "./pages/SiteFormPage";
import SiteDetailPage from "./pages/SiteDetailPage";
import SurveyPage from "./pages/SurveyPage";
import ExportPage from "./pages/ExportPage";
import SettingsPage from "./pages/SettingsPage";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting } from "./db";
import { useEffect, useState } from "react";
import { syncNow } from "./lib/sync";
import { registerSW } from "virtual:pwa-register";

// Register service worker with auto-update: on every page load, check
// for a new version. If found, the new SW activates immediately
// (skipWaiting + clientsClaim) and we reload the page to use it.
const updateSW = registerSW({
  onNeedRefresh() {
    // A new version is available — install it immediately and reload.
    updateSW(true).then(() => {
      window.location.reload();
    });
  },
  onOfflineReady() {
    // SW installed and ready for offline use — no action needed.
  },
});

function AuthGate() {
  const token = useLiveQuery(() => getSetting("auth_token", ""), []);
  const [checking, setChecking] = useState(true);
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    if (token === undefined) return; // still loading
    setHasToken(!!token);
    setChecking(false);
  }, [token]);

  // Auto-sync on launch + when coming online.
  useEffect(() => {
    if (!hasToken) return;
    syncNow();
    const onOnline = () => syncNow();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [hasToken]);

  if (checking) {
    return <div className="empty"><div className="big">…</div>Loading</div>;
  }
  if (!hasToken) {
    return <LoginPage onLoggedIn={() => setHasToken(true)} />;
  }

  return (
    <Routes>
      <Route path="/" element={<SitesPage />} />
      <Route path="/sites/new" element={<SiteFormPage />} />
      <Route path="/sites/:id/edit" element={<SiteFormPage />} />
      <Route path="/sites/:id" element={<SiteDetailPage />} />
      <Route path="/sites/:id/survey" element={<SurveyPage />} />
      <Route path="/sites/:id/export" element={<ExportPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App>
        <AuthGate />
      </App>
    </BrowserRouter>
  </React.StrictMode>
);
