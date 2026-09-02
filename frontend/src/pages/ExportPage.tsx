import { Link, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { api } from "../lib/api";
import { useState } from "react";
import { IconChevronLeft, IconFileText, IconDownload, IconArchive } from "../components/Icons";

export default function ExportPage() {
  const { id } = useParams<{ id: string }>();
  const site = useLiveQuery(() => (id ? db.sites.get(id) : undefined), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

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
    </div>
  );
}
