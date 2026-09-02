import { useState } from "react";
import { api } from "../lib/api";
import { setSetting } from "../db";

export default function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api.login(pin);
      await setSetting("auth_token", res.token);
      onLoggedIn();
    } catch (e: any) {
      setError(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-wrap">
          <img src="/logo.svg" alt="SiteSnap" className="logo" style={{ filter: "brightness(0) invert(1)" }} />
        </div>
        <h1>SiteSnap</h1>
        <div className="sub">Fast offline site surveys</div>
        <div className="field">
          <label htmlFor="pin">PIN</label>
          <input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="Enter PIN"
            autoFocus
          />
        </div>
        {error && <div className="small" style={{ color: "var(--danger)", marginBottom: 10 }}>{error}</div>}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy || pin.length < 4}>
          {busy ? <><span className="spinner" /> Unlocking</> : "Unlock"}
        </button>
      </form>
    </div>
  );
}
