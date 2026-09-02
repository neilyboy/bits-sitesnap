import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting } from "../db";
import { api } from "../lib/api";
import { syncNow } from "../lib/sync";
import { canSaveToCameraRoll } from "../lib/share";
import { useState } from "react";

export default function SettingsPage() {
  const navigate = useNavigate();
  const serverUrl = useLiveQuery(() => getSetting("server_url", ""), []);
  const lastSync = useLiveQuery(() => getSetting("last_sync_at", ""), []);
  const syncLog = useLiveQuery(() => db.sync_log.reverse().limit(20).toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy("sort_order").toArray(), []);
  const saveToGallery = useLiveQuery(() => getSetting("save_to_gallery", "0"), []);
  const [newCat, setNewCat] = useState("");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [catMsg, setCatMsg] = useState("");
  const [resyncMsg, setResyncMsg] = useState("");
  const [resyncing, setResyncing] = useState(false);

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

  return (
    <div>
      <div className="row between" style={{ marginBottom: 12 }}>
        <Link to="/" className="btn btn-ghost">‹ Sites</Link>
        <h2 style={{ margin: 0, fontSize: 18 }}>Settings</h2>
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
        <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={() => syncNow()}>Sync now</button>
        <button
          className="btn btn-danger"
          style={{ marginTop: 8, width: "100%" }}
          onClick={fullResync}
          disabled={resyncing}
        >
          {resyncing ? "Resyncing…" : "Full Resync (clear local & re-download)"}
        </button>
        {resyncMsg && (
          <div className="small" style={{ marginTop: 8, color: resyncMsg.startsWith("Error") || resyncMsg.startsWith("Resync failed") ? "var(--danger)" : "var(--success)" }}>
            {resyncMsg}
          </div>
        )}
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

      <button className="btn btn-block" onClick={logout}>Log out</button>
    </div>
  );
}
