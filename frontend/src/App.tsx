import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting } from "./db";
import { isSyncing, pendingCount, subscribeSync, syncNow, initAutoSync, setAutoSyncEnabled } from "./lib/sync";
import { IconSettings, IconSync, IconCloud, IconCloudOff } from "./components/Icons";

export default function App({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const syncing = isSyncing();
  const pending = useLiveQuery(() => pendingCount(), []);
  const lastSync = useLiveQuery(() => getSetting("last_sync_at", ""), []);

  // Re-render when sync state changes.
  useEffect(() => {
    const unsub = subscribeSync(() => setTick((t) => t + 1));
    // Initialize auto-sync (periodic timer + online/visibility listeners)
    initAutoSync();
    // Respect saved auto-sync setting
    getSetting("auto_sync", "1").then((v) => {
      setAutoSyncEnabled(v !== "0");
    });
    return unsub;
  }, []);

  const isLogin = location.pathname === "/login";
  const isSurvey = location.pathname.endsWith("/survey");
  const isOnline = navigator.onLine;

  const pendingTotal = pending?.total ?? 0;

  async function handleSync() {
    const r = await syncNow();
    if (!r.ok && r.detail === "offline") {
      alert("You're offline. Sync will run automatically when you reconnect.");
    } else if (!r.ok) {
      alert("Sync failed: " + r.detail);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)" }}>
          <img src="/logo.svg" alt="SiteSnap" className="logo" style={{ filter: "brightness(0) invert(1)" }} />
        </Link>
        <div className="title">SiteSnap</div>
        {!isLogin && (
          <button className="icon-btn" onClick={() => navigate("/settings")} title="Settings">
            <IconSettings size={22} />
          </button>
        )}
      </header>

      <main className="app-main">{children}</main>

      {!isLogin && (
        <div className={`sync-bar ${pendingTotal === 0 ? "synced" : ""}`}>
          <div className="status">
            {isOnline ? <IconCloud size={18} /> : <IconCloudOff size={18} />}
            {syncing ? (
              <><span className="spinner" /> Syncing…</>
            ) : pendingTotal > 0 ? (
              <>{pendingTotal} pending</>
            ) : (
              <>Synced{lastSync ? ` · ${formatTime(lastSync)}` : ""}</>
            )}
          </div>
          <button className="sync-btn" onClick={handleSync} disabled={syncing}>
            <IconSync size={16} />
            Sync
          </button>
        </div>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
