import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { useState } from "react";
import { IconPlus, IconMapPin, IconCalendar, IconImage, IconBuilding } from "../components/Icons";
import SiteLogo from "../components/SiteLogo";

export default function SitesPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const sites = useLiveQuery(() => db.sites.toArray().then((all) =>
    all.filter((s) => !s.deleted).sort((a, b) => (b.survey_date || "").localeCompare(a.survey_date || ""))
  ), []);
  const itemCounts = useLiveQuery(async () => {
    const items = await db.items.toArray();
    const m = new Map<string, number>();
    for (const it of items) {
      if (!it.deleted) m.set(it.site_client_uuid, (m.get(it.site_client_uuid) ?? 0) + 1);
    }
    return m;
  }, []);

  const filtered = (sites ?? []).filter((s) =>
    !q || s.business_name.toLowerCase().includes(q.toLowerCase())
      || s.address_line1.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Sites</h2>
        <button className="btn btn-primary" onClick={() => navigate("/sites/new")}>
          <IconPlus size={18} />
          New Site
        </button>
      </div>

      <div className="field">
        <input
          type="search"
          placeholder="Search sites…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="big"><IconBuilding size={48} /></div>
          <div>No sites yet.</div>
          <div className="small" style={{ marginTop: 8 }}>
            Tap <strong>New Site</strong> to start a survey.
          </div>
        </div>
      ) : (
        filtered.map((s) => (
          <Link
            key={s.client_uuid}
            to={`/sites/${s.client_uuid}`}
            className="site-card"
            style={{ display: "flex", alignItems: "flex-start", gap: 12, textDecoration: "none", color: "inherit" }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row between">
                <div className="site-name">{s.business_name || "Untitled Site"}</div>
                {s.sync_status === "pending" && <span className="badge badge-pending">pending</span>}
              </div>
              <div className="site-meta">
                <IconCalendar size={14} />
                <span>{s.survey_date || "no date"}</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <IconImage size={14} />
                <span>{itemCounts?.get(s.client_uuid) ?? 0} items</span>
              </div>
              {s.address_line1 && (
                <div className="site-meta">
                  <IconMapPin size={14} />
                  <span>{s.address_line1}{s.city ? `, ${s.city}` : ""}</span>
                </div>
              )}
            </div>
            {(s.logo_blob || s.logo_url) && (
              <SiteLogo blob={s.logo_blob} url={s.logo_url} size={56} />
            )}
          </Link>
        ))
      )}
    </div>
  );
}
