import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting } from "../db";
import { api } from "../lib/api";
import { syncNow, setAutoSyncEnabled } from "../lib/sync";
import { canSaveToCameraRoll } from "../lib/share";
import { useState, useRef } from "react";
import { IconChevronLeft, IconSync, IconRefreshCw, IconLogOut, IconCloud, IconCamera, IconDownload, IconArchive } from "../components/Icons";

export default function SettingsPage() {
  const navigate = useNavigate();
  const serverUrl = useLiveQuery(() => getSetting("server_url", ""), []);
  const lastSync = useLiveQuery(() => getSetting("last_sync_at", ""), []);
  const syncLog = useLiveQuery(() => db.sync_log.reverse().limit(20).toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy("sort_order").toArray(), []);
  const saveToGallery = useLiveQuery(() => getSetting("save_to_gallery", "0"), []);
  const autoSync = useLiveQuery(() => getSetting("auto_sync", "1"), []);
  const [newCat, setNewCat] = useState("");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [catMsg, setCatMsg] = useState("");
  const [resyncMsg, setResyncMsg] = useState("");
  const [resyncing, setResyncing] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState("");
  const importFileRef = useRef<HTMLInputElement>(null);

  async function saveServerUrl(v: string) {
    await setSetting("server_url", v.trim());
  }

  async function logout() {
    await setSetting("auth_token", "");
    navigate("/");
  }

  async function changePin(e: React.FormEvent) {
    e.preventDefault();
    setPinMsg("");
    try {
      const res = await api.changePin(oldPin, newPin);
      await setSetting("auth_token", res.token);
      setPinMsg("PIN changed.");
      setOldPin("");
      setNewPin("");
    } catch (e: any) {
      setPinMsg(e?.message ?? "Failed");
    }
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    setCatMsg("");
    if (!newCat.trim()) return;
    try {
      const sortOrder = (categories?.length ?? 0);
      await api.addCategory(newCat.trim(), sortOrder);
      setCatMsg("Added.");
      setNewCat("");
      await syncNow();
    } catch (e: any) {
      setCatMsg(e?.message ?? "Failed");
    }
  }

  async function fullResync() {
    if (!confirm(
      "Full Resync will DELETE all local data on this device and re-download everything from the server.\n\n" +
      "Any items that exist only on this device (never synced to the server) will be permanently lost.\n\n" +
      "Are you sure you want to continue?"
    )) return;
    setResyncing(true);
    setResyncMsg("Clearing local data…");
    try {
      // Clear all local data (but keep auth token + server URL)
      const token = await getSetting("auth_token", "");
      const surl = await getSetting("server_url", "");
      await db.sites.clear();
      await db.items.clear();
      await db.images.clear();
      await db.audio.clear();
      await db.categories.clear();
      await db.sync_log.clear();
      await setSetting("last_sync_at", "");
      // Restore auth
      await setSetting("auth_token", token);
      await setSetting("server_url", surl);

      setResyncMsg("Downloading from server…");
      // Now do a full sync (pull everything from server since last_sync_at is empty)
      const result = await syncNow();
      if (result.ok) {
        setResyncMsg("Full resync complete! All data downloaded from server.");
        setTimeout(() => setResyncMsg(""), 4000);
      } else {
        setResyncMsg(`Resync failed: ${result.detail}`);
      }
    } catch (e: any) {
      setResyncMsg(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setResyncing(false);
    }
  }

  async function downloadFullBackup() {
    setBackupBusy(true);
    setBackupMsg("");
    try {
      const blob = await api.backupFull();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "_");
      a.download = `sitesnap_backup_${ts}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupMsg("Full backup downloaded.");
    } catch (e: any) {
      setBackupMsg(e?.message ?? "Backup failed");
    } finally {
      setBackupBusy(false);
    }
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (importFileRef.current) importFileRef.current.value = "";

    const overwrite = confirm(
      "Import a backup file?\n\n" +
      "Click OK to OVERWRITE existing sites with the same ID (useful for restoring).\n" +
      "Click Cancel to SKIP sites that already exist (useful for merging).\n\n" +
      "After import, a full resync will be triggered to update this device."
    );

    setImportBusy(true);
    setBackupMsg("");
    try {
      const buf = await file.arrayBuffer();
      const result = await api.importBackup(buf, overwrite);
      setBackupMsg(
        `Imported: ${result.sites_imported} site(s), ${result.items_imported} item(s), ` +
        `${result.images_imported} image(s), ${result.audio_imported} audio clip(s)` +
        (result.sites_skipped ? `, ${result.sites_skipped} skipped` : "") +
        `, ${result.categories_added} new category(ies)`
      );
      // Trigger a full resync to pull the imported data to this device
      await syncNow();
    } catch (e: any) {
      setBackupMsg(e?.message ?? "Import failed");
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <Link to="/" className="btn btn-ghost">
          <IconChevronLeft size={20} />
          Sites
        </Link>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Settings</h2>
        <span />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Server</h3>
        <div className="field">
          <label>Server URL (blank = same origin)</label>
          <input
            value={serverUrl ?? ""}
            onChange={(e) => saveServerUrl(e.target.value)}
            placeholder="https://survey.example.com"
          />
        </div>
        <div className="small muted">Last sync: {lastSync || "never"}</div>
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => syncNow()}>
          <IconSync size={18} />
          Sync now
        </button>
        <button
          className="btn btn-danger"
          style={{ marginTop: 8, width: "100%" }}
          onClick={fullResync}
          disabled={resyncing}
        >
          <IconRefreshCw size={18} />
          {resyncing ? "Resyncing…" : "Full Resync"}
        </button>
        {resyncMsg && (
          <div className="small" style={{ marginTop: 8, color: resyncMsg.startsWith("Error") || resyncMsg.startsWith("Resync failed") ? "var(--danger)" : "var(--success)" }}>
            {resyncMsg}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Backup & Restore</h3>
        <div className="small muted" style={{ marginBottom: 12 }}>
          Download a full backup of all sites, items, photos, and audio as a single JSON file.
          Import a backup file to restore data on this or another server.
        </div>
        <button className="btn btn-primary btn-block" onClick={downloadFullBackup} disabled={backupBusy || importBusy}>
          {backupBusy ? <><span className="spinner" /> Creating backup…</> : <><IconDownload size={18} /> Download Full Backup</>}
        </button>
        <button
          className="btn btn-block"
          style={{ marginTop: 8 }}
          onClick={() => importFileRef.current?.click()}
          disabled={backupBusy || importBusy}
        >
          {importBusy ? <><span className="spinner dark" /> Importing…</> : <><IconArchive size={18} /> Import Backup</>}
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept=".json,application/json"
          className="hidden-file"
          onChange={onImportFile}
        />
        {backupMsg && (
          <div className="small" style={{ marginTop: 8, color: backupMsg.includes("failed") || backupMsg.includes("Import failed") ? "var(--danger)" : "var(--success)" }}>
            {backupMsg}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Sync</h3>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={autoSync === "1"}
            onChange={async (e) => {
              const enabled = e.target.checked;
              await setSetting("auto_sync", enabled ? "1" : "0");
              setAutoSyncEnabled(enabled);
            }}
            style={{ width: 20, height: 20 }}
          />
          <span>Auto-sync when online</span>
        </label>
        <div className="small muted" style={{ marginTop: 6 }}>
          When enabled, the app automatically syncs your changes a few seconds
          after you make them, whenever you're online. It also syncs when you
          come back online or return to the app. The manual Sync button above
          still works as a fallback.
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Photos</h3>
        {canSaveToCameraRoll() ? (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={saveToGallery === "1"}
                onChange={async (e) => {
                  await setSetting("save_to_gallery", e.target.checked ? "1" : "0");
                }}
                style={{ width: 20, height: 20 }}
              />
              <span>Also save photos to camera roll</span>
            </label>
            <div className="small muted" style={{ marginTop: 6 }}>
              When enabled, each photo you take will also be shared to your phone's
              Photos app via the share sheet. You'll need to tap "Save Image" each time
              (PWAs can't save silently). This is useful for keeping a backup in your camera roll.
            </div>
          </>
        ) : (
          <div className="small muted">
            Saving to camera roll is not supported on this device/browser.
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Categories</h3>
        <div className="col small">
          {(categories ?? []).map((c) => (
            <div key={c.slug} className="row between">
              <span>{c.name}</span>
              {c.is_default && <span className="badge badge-cat">default</span>}
            </div>
          ))}
        </div>
        <form onSubmit={addCategory} className="row" style={{ marginTop: 10 }}>
          <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" />
          <button className="btn btn-primary" type="submit">Add</button>
        </form>
        {catMsg && <div className="small muted" style={{ marginTop: 6 }}>{catMsg}</div>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Change PIN</h3>
        <form onSubmit={changePin}>
          <div className="field">
            <label>Current PIN</label>
            <input type="password" value={oldPin} onChange={(e) => setOldPin(e.target.value)} />
          </div>
          <div className="field">
            <label>New PIN</label>
            <input type="password" value={newPin} onChange={(e) => setNewPin(e.target.value)} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={oldPin.length < 4 || newPin.length < 4}>Change PIN</button>
          {pinMsg && <div className="small" style={{ marginTop: 8, color: pinMsg === "PIN changed." ? "var(--success)" : "var(--danger)" }}>{pinMsg}</div>}
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, fontSize: 15 }}>Sync Log</h3>
        {(syncLog ?? []).length === 0 ? (
          <div className="small muted">No sync activity yet.</div>
        ) : (
          <div className="col small">
            {(syncLog ?? []).map((l) => (
              <div key={l.id} className={l.ok ? "" : ""} style={{ color: l.ok ? "var(--text)" : "var(--danger)" }}>
                <span className="tiny muted">{new Date(l.at).toLocaleString()}</span>{" "}
                <strong>{l.direction}</strong> {l.detail}
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="btn btn-block" onClick={logout}>
        <IconLogOut size={18} />
        Log out
      </button>
    </div>
  );
}
