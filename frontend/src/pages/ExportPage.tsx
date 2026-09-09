import { Link, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting } from "../db";
import { api } from "../lib/api";
import { useState } from "react";
import { IconChevronLeft, IconFileText, IconDownload, IconArchive, IconLink, IconCopy, IconTrash, IconCheck } from "../components/Icons";

export default function ExportPage() {
  const { id } = useParams<{ id: string }>();
  const site = useLiveQuery(() => (id ? db.sites.get(id) : undefined), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function download(kind: "pdf" | "html" | "zip") {
    if (!site?.id) {
      setError("Site must be synced before exporting. Tap Sync now.");
      return;
    }
    setBusy(kind);
    setError("");
    try {
      let blob: Blob;
      let filename: string;
      if (kind === "pdf") {
        blob = await api.exportPdf(site.id);
        filename = `${site.business_name || "site"}_report.pdf`;
      } else if (kind === "html") {
        blob = await api.exportHtml(site.id);
        filename = `${site.business_name || "site"}_report.html`;
      } else {
        blob = await api.exportZip(site.id);
        filename = `${site.business_name || "site"}_images.zip`;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function createShareLink() {
    if (!site?.id) return;
    setShareBusy(true);
    setError("");
    try {
      const { share_token } = await api.createShareLink(site.id);
      let base = await getSetting("server_url", "");
      base = base ? base.replace(/\/$/, "") : window.location.origin;
      setShareUrl(`${base}/api/share/${share_token}`);
      setCopied(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to create share link");
    } finally {
      setShareBusy(false);
    }
  }

  async function revokeShareLink() {
    if (!site?.id) return;
    setShareBusy(true);
    setError("");
    try {
      await api.revokeShareLink(site.id);
      setShareUrl("");
      setCopied(false);
    } catch (e: any) {
      setError(e?.message ?? "Failed to revoke share link");
    } finally {
      setShareBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text
      const input = document.getElementById("share-url-input") as HTMLInputElement;
      if (input) {
        input.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  }

  if (!site) return <div className="empty">Loading…</div>;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <Link to={`/sites/${site.client_uuid}`} className="btn btn-ghost">
          <IconChevronLeft size={20} />
          Back
        </Link>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Export</h2>
        <span />
      </div>

      <div className="card">
        <strong style={{ fontSize: 17 }}>{site.business_name || "Untitled"}</strong>
        <div className="small muted" style={{ marginTop: 4 }}>{site.survey_date}</div>
        {site.sync_status === "pending" && (
          <div className="small" style={{ color: "var(--warning)", marginTop: 10 }}>
            This site has unsynced changes. Sync before exporting to include the latest data.
          </div>
        )}
      </div>

      <div className="export-btns">
        <button className="btn btn-primary btn-lg" onClick={() => download("pdf")} disabled={!!busy}>
          {busy === "pdf" ? <><span className="spinner" /> Generating PDF…</> : (<><IconFileText size={20} /> Download PDF Report</>)}
        </button>
        <button className="btn btn-lg" onClick={() => download("html")} disabled={!!busy}>
          {busy === "html" ? <><span className="spinner dark" /> Generating HTML…</> : (<><IconFileText size={20} /> Download HTML Report</>)}
        </button>
        <button className="btn btn-lg" onClick={() => download("zip")} disabled={!!busy}>
          {busy === "zip" ? <><span className="spinner dark" /> Generating ZIP…</> : (<><IconArchive size={20} /> Download ZIP (images + text overlay)</>)}
        </button>
      </div>

      {error && <div className="small" style={{ color: "var(--danger)", marginTop: 12 }}>{error}</div>}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="small" style={{ color: "var(--text-secondary)" }}>
          <strong style={{ color: "var(--text)" }}>PDF</strong> — formatted report with cover, summary table, and items grouped by category. Print-ready.
        </div>
        <div className="small" style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          <strong style={{ color: "var(--text)" }}>HTML</strong> — single self-contained file with embedded images. Click any photo to zoom.
        </div>
        <div className="small" style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          <strong style={{ color: "var(--text)" }}>ZIP</strong> — every image with its notes overlaid in a solid bar at the bottom, plus manifest.csv. Extract to your network share.
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <IconLink size={18} />
          <strong style={{ fontSize: 15 }}>Public Share Link</strong>
        </div>
        <div className="small muted" style={{ marginBottom: 12 }}>
          Generate a public URL that anyone can open to view this report in their browser — no login required. The link shows the current report at the time it was generated. Revoke it anytime to disable access.
        </div>
        {!shareUrl ? (
          <button className="btn btn-primary" onClick={createShareLink} disabled={shareBusy || !site.id}>
            {shareBusy ? <><span className="spinner" /> Creating…</> : <><IconLink size={16} /> Create Share Link</>}
          </button>
        ) : (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                id="share-url-input"
                type="text"
                readOnly
                value={shareUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                style={{
                  flex: 1,
                  minWidth: 200,
                  padding: "8px 10px",
                  borderRadius: "var(--radius-xs)",
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--text)",
                  fontSize: 13,
                  fontFamily: "monospace",
                }}
              />
              <button className="btn" onClick={copyLink} title="Copy to clipboard">
                {copied ? <><IconCheck size={16} /> Copied</> : <><IconCopy size={16} /> Copy</>}
              </button>
              <button className="btn" onClick={() => window.open(shareUrl, "_blank")} title="Open in new tab">
                Open
              </button>
              <button className="btn btn-danger" onClick={revokeShareLink} disabled={shareBusy} title="Disable the share link">
                {shareBusy ? <><span className="spinner" /> …</> : <><IconTrash size={16} /> Revoke</>}
              </button>
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              Anyone with this link can view the report. No login needed.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
