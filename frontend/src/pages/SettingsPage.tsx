import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting } from "../db";
import { api } from "../lib/api";
import { syncNow } from "../lib/sync";
import { useState } from "react";

export default function SettingsPage() {
  const navigate = useNavigate();
  const serverUrl = useLiveQuery(() => getSetting("server_url", ""), []);
  const lastSync = useLiveQuery(() => getSetting("last_sync_at", ""), []);
  const syncLog = useLiveQuery(() => db.sync_log.reverse().limit(20).toArray(), []);
  const categories = useLiveQuery(() => db.categories.orderBy("sort_order").toArray(), []);
  const [newCat, setNewCat] = useState("");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [catMsg, setCatMsg] = useState("");

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
